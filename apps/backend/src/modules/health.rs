use std::time::Duration;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use tokio::time::timeout;

use crate::{http::Api, state::AppState};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/health", health)
        .get("/api/v1/ready", ready)
}

/// The process is up. Used by a load balancer's liveness check.
async fn health() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

/// The pool waits up to 30 s for a connection: far too long for a check whose point is a quick answer.
const DATABASE_DEADLINE: Duration = Duration::from_secs(2);

/// The process can serve: its database and Redis both answer, and in time.
async fn ready(State(state): State<AppState>) -> Response {
    let select = sqlx::query("SELECT 1").execute(&state.db);
    let database = matches!(timeout(DATABASE_DEADLINE, select).await, Ok(Ok(_)));
    let mut connection = state.redis.clone();
    let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut connection).await;
    let cache = pong.is_ok();
    let word = |up: bool| if up { "up" } else { "down" };
    let ok = database && cache;
    let body = json!({"status": if ok { "ready" } else { "unavailable" }, "checks": {"database": word(database), "redis": word(cache)}});
    (
        if ok {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(body),
    )
        .into_response()
}
