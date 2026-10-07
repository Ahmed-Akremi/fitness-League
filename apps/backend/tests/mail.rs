#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use backend::{config::Config, devkeys, mail::Mailer};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

/// Just enough SMTP to accept one message. Returns what the client sent after `DATA`.
async fn one_message(listener: TcpListener) -> String {
    let (socket, _) = listener.accept().await.unwrap();
    let (read, mut write) = socket.into_split();
    let mut lines = BufReader::new(read).lines();
    write.write_all(b"220 test server\r\n").await.unwrap();
    let mut message = String::new();
    let mut in_data = false;
    while let Some(line) = lines.next_line().await.unwrap() {
        if in_data {
            if line == "." {
                in_data = false;
                write.write_all(b"250 queued\r\n").await.unwrap();
            } else {
                message.push_str(&line);
                message.push('\n');
            }
            continue;
        }
        let verb = line.to_ascii_uppercase();
        if verb.starts_with("DATA") {
            in_data = true;
            write.write_all(b"354 go on\r\n").await.unwrap();
        } else if verb.starts_with("QUIT") {
            write.write_all(b"221 bye\r\n").await.unwrap();
            break;
        } else {
            write.write_all(b"250 ok\r\n").await.unwrap();
        }
    }
    message
}

fn config(smtp_url: &str) -> Config {
    let (private, public) = devkeys::generate().unwrap();
    let vars: HashMap<String, String> = [
        ("APP_ENV", "test"),
        ("DATABASE_URL", "mysql://unused"),
        ("REDIS_URL", "redis://unused"),
        ("JWT_PRIVATE_KEY_B64", private.as_str()),
        ("JWT_PUBLIC_KEY_B64", public.as_str()),
        ("APP_HMAC_SECRET", "0123456789abcdef0123456789abcdef"),
        ("SMTP_URL", smtp_url),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    Config::from_map(&vars).unwrap()
}

#[tokio::test]
async fn a_mail_goes_out_over_smtp() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("smtp://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(one_message(listener));

    let mailer = Mailer::from_config(&config(&url)).unwrap();
    mailer
        .send(
            "athlete@example.com",
            "Fitness League: confirm your email",
            "Welcome!\n\nhttps://app.example/verify-email?token=abc\n",
        )
        .await
        .unwrap();

    let message = server.await.unwrap();
    assert!(message.contains("To: athlete@example.com"), "{message}");
    assert!(
        // The library writes the display name in quotes, which is the same header.
        message.contains(r#"From: "Fitness League" <no-reply@fitnessleague.app>"#),
        "{message}"
    );
    assert!(
        message.contains("Subject: Fitness League: confirm your email"),
        "{message}"
    );
    assert!(message.contains("verify-email?token"), "{message}");
    assert!(
        mailer.sent().is_empty(),
        "nothing is kept when mails really leave"
    );
}

#[tokio::test]
async fn a_refusal_is_reported_without_the_address() {
    // Nothing listens on this port once the listener is dropped.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("smtp://{}", listener.local_addr().unwrap());
    drop(listener);
    let mailer = Mailer::from_config(&config(&url)).unwrap();
    let cause = mailer
        .send("athlete@example.com", "Subject", "Text")
        .await
        .unwrap_err();
    assert!(cause.starts_with("smtp:"), "{cause}");
    assert!(!cause.contains("athlete"), "{cause}");
}
