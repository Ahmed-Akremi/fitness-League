use std::process::ExitCode;

use secrecy::ExposeSecret;

const USAGE: &str = "usage: backend <serve|migrate|seed [dir]|keys>";

#[tokio::main]
async fn main() -> ExitCode {
    // A `.env` file only exists on a developer machine; release builds read the real environment only.
    // It overrides what is already set, so the API runs as `fl_app` and not with the tooling account of
    // `.cargo/config.toml`.
    if cfg!(debug_assertions) && dotenvy::dotenv_override().is_err() {
        eprintln!("warning: no .env file in this directory; using the environment as it is");
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("serve") => serve().await,
        Some("migrate") => migrate().await,
        Some("seed") => seed(args.get(1)).await,
        Some("keys") => keys(),
        _ => Err(USAGE.to_owned()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn keys() -> Result<(), String> {
    let (private, public) = backend::devkeys::generate()?;
    println!("JWT_PRIVATE_KEY_B64={private}\nJWT_PUBLIC_KEY_B64={public}");
    Ok(())
}

/// Applies the migrations with the schema-owning account, which nothing else ever uses.
async fn migrate() -> Result<(), String> {
    let url = std::env::var("MIGRATE_DATABASE_URL")
        .map_err(|_| "MIGRATE_DATABASE_URL: required".to_owned())?;
    let pool = backend::db::connect(&url, 1)
        .await
        .map_err(|e| format!("database: {e}"))?;
    backend::db::MIGRATOR
        .run(&pool)
        .await
        .map_err(|e| format!("migration failed: {e}"))?;
    println!("migrations applied");
    Ok(())
}

async fn serve() -> Result<(), String> {
    let cfg = backend::config::Config::from_env()?;
    init_logging(&cfg.log_level);
    if cfg.env == backend::config::AppEnv::Production {
        for name in cfg.plaintext_backends() {
            tracing::warn!(backend = name, "reached without TLS");
        }
    }
    let state = backend::state::AppState::connect(cfg).await?;
    let address = std::net::SocketAddr::from(([0, 0, 0, 0], state.cfg.port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|e| format!("cannot listen on {address}: {e}"))?;
    tracing::info!(%address, "listening");
    // The peer address is attached to every request: rate limiting needs it.
    axum::serve(
        listener,
        backend::http::app(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .map_err(|e| e.to_string())
}

/// JSON lines on standard output, at the configured level.
fn init_logging(level: &str) {
    let filter = tracing_subscriber::EnvFilter::try_new(level)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .init();
}

/// Loads the reference catalog with the application account: it only needs to write rows.
async fn seed(dir: Option<&String>) -> Result<(), String> {
    let cfg = backend::config::Config::from_env()?;
    let pool = backend::db::connect(cfg.database_url.expose_secret(), 1)
        .await
        .map_err(|e| format!("database: {e}"))?;
    let dir = dir.map_or("infra/seed-data", String::as_str);
    let summary = backend::seed::run(&pool, std::path::Path::new(dir)).await?;
    println!("seeded: {summary:?}");
    Ok(())
}
