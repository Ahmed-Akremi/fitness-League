#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The live socket: socket.io at `/ws`, refused without a session, and `notification.new` for the
//! athlete it concerns. The tests speak socket.io's text protocol over a plain WebSocket.
mod common;

use std::{collections::HashSet, net::SocketAddr, time::Duration};

use axum::http::{Method, StatusCode};
use backend::{
    live,
    modules::notifications::{self, Kind},
    security::tokens::Audience,
    types::Role,
};
use common::{TestApp, create_user, open_session, seeded, workouts::athlete};
use futures_util::{SinkExt, StreamExt};
use secrecy::ExposeSecret;
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};
use uuid::Uuid;

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// The API on a real port, and its socket handle.
async fn serve(app: &TestApp) -> (SocketAddr, socketioxide::SocketIo) {
    let (router, io) = backend::http::app_live(app.state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    (address, io)
}

/// The next text frame within `wait`, the engine.io pings answered on the way; `None` if none came.
async fn frame_within(ws: &mut Socket, wait: Duration) -> Option<String> {
    loop {
        let message = tokio::time::timeout(wait, ws.next()).await.ok()??.unwrap();
        if let Message::Text(text) = message {
            if text.as_str() == "2" {
                ws.send(Message::Text("3".into())).await.unwrap();
                continue;
            }
            return Some(text.to_string());
        }
    }
}

async fn frame(ws: &mut Socket) -> String {
    frame_within(ws, Duration::from_secs(5))
        .await
        .expect("a frame in time")
}

/// Opens a WebSocket, then asks to join the `/ws` namespace with `auth`; the server's answer.
async fn connect(address: SocketAddr, auth: Option<Value>) -> (Socket, String) {
    let url = format!("ws://{address}/socket.io/?EIO=4&transport=websocket");
    let (mut ws, _) = connect_async(url).await.unwrap();
    let open = frame(&mut ws).await;
    assert!(open.starts_with('0'), "{open}");
    let packet = auth.map_or("40/ws,".to_owned(), |auth| format!("40/ws,{auth}"));
    ws.send(Message::Text(packet.into())).await.unwrap();
    let answer = frame(&mut ws).await;
    (ws, answer)
}

/// A token signed with the application's key whose life ended a minute ago.
fn expired_token(app: &TestApp, user: Uuid) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::EdDSA);
    header.kid = Some("k1".to_owned());
    let claims = json!({"sub": user.to_string(), "role": "USER", "sv": 1, "aud": "app",
                        "iss": "fitness-league", "iat": now - 960, "exp": now - 60});
    let key = jsonwebtoken::EncodingKey::from_ed_pem(
        app.state.cfg.jwt_private_key_pem.expose_secret().as_bytes(),
    )
    .unwrap();
    jsonwebtoken::encode(&header, &claims, &key).unwrap()
}

#[sqlx::test]
async fn a_socket_needs_a_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (address, _io) = serve(&app).await;
    let (user, token) = athlete(&app, "live").await;
    let judge = create_user(&app, "judge", Role::Judge).await;
    let judge_token = open_session(&app, judge, Role::Judge, Audience::App).await["accessToken"]
        .as_str()
        .unwrap()
        .to_owned();

    for auth in [
        None,
        Some(json!({"token": "forged"})),
        Some(json!({"token": expired_token(&app, user)})),
        Some(json!({"token": judge_token})),
    ] {
        let (_, answer) = connect(address, auth.clone()).await;
        assert!(answer.starts_with("44/ws,"), "{auth:?}: {answer}");
        assert!(answer.contains("UNAUTHENTICATED"), "{auth:?}: {answer}");
    }
    let (_, answer) = connect(address, Some(json!({"token": token}))).await;
    assert!(answer.starts_with("40/ws,"), "{answer}");
    assert!(answer.contains("\"sid\""), "{answer}");
}

#[sqlx::test]
async fn notifications_reach_their_athlete_live(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (address, io) = serve(&app).await;
    let (a, a_token) = athlete(&app, "anis").await;
    let (b, b_token) = athlete(&app, "bilel").await;
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(b)
        .execute(&app.db)
        .await
        .unwrap();
    let (mut a_socket, answer) = connect(address, Some(json!({"token": a_token}))).await;
    assert!(answer.starts_with("40/ws,"), "{answer}");
    let (mut b_socket, answer) = connect(address, Some(json!({"token": b_token}))).await;
    assert!(answer.starts_with("40/ws,"), "{answer}");

    let asked = app
        .call(
            Method::POST,
            "/api/v1/friends/requests",
            Some(&b_token),
            Some(json!({"userId": a})),
        )
        .await;
    assert_eq!(asked.status, StatusCode::CREATED, "{}", asked.json);
    let mut seen = HashSet::new();
    assert_eq!(live::tail_once(&io, &app.db, &mut seen).await.unwrap(), 1);

    let event = frame(&mut a_socket).await;
    let body: Value = serde_json::from_str(event.strip_prefix("42/ws,").expect(&event)).unwrap();
    assert_eq!(body[0], "notification.new");
    let id: Uuid = sqlx::query_scalar("SELECT id FROM notifications WHERE user_id = ?")
        .bind(a)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(body[1]["id"], json!(id));
    assert_eq!(body[1]["type"], "FRIEND_REQUEST");
    assert!(body[1]["payload"].is_object(), "{body}");
    assert_eq!(body[1]["unread"], 1);
    let other = frame_within(&mut b_socket, Duration::from_millis(300)).await;
    assert_eq!(other, None);
    assert_eq!(live::tail_once(&io, &app.db, &mut seen).await.unwrap(), 0);

    // A notification whose transaction is rolled back never becomes an event.
    let mut tx = app.db.begin().await.unwrap();
    notifications::notify(&mut tx, a, Kind::FriendAccepted, json!({}))
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(live::tail_once(&io, &app.db, &mut seen).await.unwrap(), 0);
}
