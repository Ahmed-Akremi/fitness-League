use std::process::ExitCode;

const USAGE: &str = "usage: backend <keys>";

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
