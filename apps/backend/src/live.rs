//! The live socket (docs §4.5): socket.io at the `/ws` namespace, where each athlete's sockets join
//! `user:<id>`, and the tail that turns new notification rows into `notification.new` events. Events
//! cross processes through the notifications table (plan 3c ruling 7): whoever wrote the row, the API
//! or the worker, every API process finds it and tells its own sockets.

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use serde::Deserialize;
use serde_json::{Value, json};
use socketioxide::{
    SocketIo, TransportType,
    extract::{Extension, SocketRef, TryData},
    handler::ConnectHandler,
    layer::SocketIoLayer,
};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{error::AppError, http::auth, state::AppState};

const TICK: Duration = Duration::from_secs(1);

#[derive(Deserialize)]
struct Auth {
    token: String,
}

/// The socket.io layer for the router, and the handle the tail emits through. WebSocket only, as the
/// app connects (plan 3c ruling 8).
pub fn socket(state: AppState) -> (SocketIoLayer, SocketIo) {
    let (layer, io) = SocketIo::builder()
        .transports([TransportType::Websocket])
        .build_layer();
    // A refusal is socket.io's connect error: the socket never joins a room.
    let authenticate = move |s: SocketRef, TryData(auth): TryData<Auth>| {
        let state = state.clone();
        async move {
            let token = auth.map_err(|_| "UNAUTHENTICATED")?.token;
            let user = auth::app_user(&state, &token)
                .await
                .map_err(|_| "UNAUTHENTICATED")?;
            s.extensions.insert(user.id);
            Ok::<(), &'static str>(())
        }
    };
    io.ns("/ws", join.with(authenticate));
    (layer, io)
}

async fn join(s: SocketRef, Extension(user): Extension<Uuid>) {
    s.join(format!("user:{user}"));
}

/// Emits the notifications of the last 30 seconds, by the database's clock, that `seen` does not
/// hold yet, each to its athlete's room with their unread count. The window catches a transaction
/// that commits late; `seen` keeps the window's ids. Gives how many it emitted.
pub async fn tail_once(
    io: &SocketIo,
    db: &MySqlPool,
    seen: &mut HashSet<Uuid>,
) -> Result<usize, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", user_id AS "user_id: Uuid", type AS kind, payload FROM notifications
           WHERE created_at >= UTC_TIMESTAMP(6) - INTERVAL 30 SECOND ORDER BY id"#
    )
    .fetch_all(db)
    .await?;
    let fresh: Vec<_> = rows.iter().filter(|n| !seen.contains(&n.id)).collect();
    let mut unread = HashMap::new();
    for n in &fresh {
        if !unread.contains_key(&n.user_id) {
            let count = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL",
                n.user_id
            )
            .fetch_one(db)
            .await?;
            unread.insert(n.user_id, count);
        }
    }
    if let Some(ns) = io.of("/ws") {
        for n in &fresh {
            let payload: Value = serde_json::from_str(&n.payload).map_err(AppError::internal)?;
            let data = json!({"id": n.id, "type": n.kind, "payload": payload, "unread": unread.get(&n.user_id)});
            if let Err(cause) = ns
                .clone()
                .to(format!("user:{}", n.user_id))
                .emit("notification.new", &data)
                .await
            {
                tracing::warn!(%cause, "a live notification could not be sent");
            }
        }
    }
    *seen = rows.iter().map(|n| n.id).collect();
    Ok(fresh.len())
}

/// The tail, once a second, for as long as the API runs. A failed tick is logged and the next one
/// tries again; the window brings back what it missed.
pub async fn tail(io: SocketIo, db: MySqlPool) {
    let mut seen = HashSet::new();
    loop {
        if let Err(cause) = tail_once(&io, &db, &mut seen).await {
            tracing::error!(?cause, "the live tail could not read the notifications");
        }
        tokio::time::sleep(TICK).await;
    }
}
