//! Keyset pagination: a page holds `limit` rows and, when more exist, the cursor of the next page.
//! The cursor is the last row's sort key, signed so that a client cannot forge a position
//! (docs/ARCHITECTURE.md §4.2). Its format is the old API's: `base64url(JSON).signature`.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use secrecy::{ExposeSecret, SecretString};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::Sha256;

use crate::error::AppError;

pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_LIMIT: u32 = 100;
pub const MAX_CURSOR_CHARS: usize = 512;
/// The old API kept the first 22 base64url characters (132 bits) of the HMAC.
const SIGNATURE_CHARS: usize = 22;

fn signature(secret: &SecretString, body: &str) -> String {
    #[allow(clippy::expect_used)] // HMAC accepts a key of any length; this cannot fail.
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.expose_secret().as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(b"cursor:");
    mac.update(body.as_bytes());
    let mut full = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    full.truncate(SIGNATURE_CHARS);
    full
}

pub fn encode(secret: &SecretString, key: &impl Serialize) -> Result<String, AppError> {
    let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(key).map_err(AppError::internal)?);
    let signature = signature(secret, &body);
    Ok(format!("{body}.{signature}"))
}

pub fn decode<T: DeserializeOwned>(secret: &SecretString, cursor: &str) -> Result<T, AppError> {
    let invalid = || AppError::field("cursor", "INVALID_CURSOR");
    if cursor.len() > MAX_CURSOR_CHARS {
        return Err(AppError::field("cursor", "MAXLENGTH"));
    }
    let (body, given) = cursor.split_once('.').ok_or_else(invalid)?;
    let expected = signature(secret, body);
    // In constant time: how much of a forged signature was right must not show in the timing.
    let same = expected.len() == given.len()
        && expected
            .bytes()
            .zip(given.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0;
    if !same {
        return Err(invalid());
    }
    let bytes = URL_SAFE_NO_PAD.decode(body).map_err(|_| invalid())?;
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

/// The `limit` of a list: 20 when absent, 1 to 100 otherwise.
pub fn limit(raw: Option<&str>) -> Result<u32, AppError> {
    let Some(raw) = raw else {
        return Ok(DEFAULT_LIMIT);
    };
    let n: i64 = raw
        .trim()
        .parse()
        .map_err(|_| AppError::field("limit", "ISINT"))?;
    if n < 1 {
        return Err(AppError::field("limit", "MIN"));
    }
    u32::try_from(n)
        .ok()
        .filter(|n| *n <= MAX_LIMIT)
        .ok_or_else(|| AppError::field("limit", "MAX"))
}

/// `{data, page: {nextCursor, hasMore}}`, the envelope of every list.
pub fn page(data: Vec<Value>, next: Option<String>) -> Value {
    json!({"data": data, "page": {"hasMore": next.is_some(), "nextCursor": next}})
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Key {
        p: String,
        id: String,
    }

    fn secret(text: &str) -> SecretString {
        text.to_owned().into()
    }

    fn key() -> Key {
        Key {
            p: "2026-10-18T07:30:00.000Z".into(),
            id: "0199".into(),
        }
    }

    fn code(e: AppError) -> String {
        e.summary()["errors"][0]["code"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn a_cursor_comes_back() {
        let s = secret("test-hmac-secret-0123456789abcdef");
        let cursor = encode(&s, &key()).unwrap();
        assert_eq!(decode::<Key>(&s, &cursor).unwrap(), key());
    }

    #[test]
    fn a_changed_character_is_refused() {
        let s = secret("test-hmac-secret-0123456789abcdef");
        let cursor = encode(&s, &key()).unwrap();
        let (body, sig) = cursor.split_once('.').unwrap();
        // The position moved, the signature kept: refused.
        let forged = format!(
            "{}.{sig}",
            URL_SAFE_NO_PAD.encode(br#"{"p":"2030-01-01","id":"0"}"#)
        );
        assert_eq!(
            code(decode::<Key>(&s, &forged).unwrap_err()),
            "INVALID_CURSOR"
        );
        let mut flipped = sig.to_owned().into_bytes();
        flipped[0] = if flipped[0] == b'A' { b'B' } else { b'A' };
        let flipped = format!("{body}.{}", String::from_utf8(flipped).unwrap());
        assert_eq!(
            code(decode::<Key>(&s, &flipped).unwrap_err()),
            "INVALID_CURSOR"
        );
        assert_eq!(
            code(decode::<Key>(&s, "no-dot").unwrap_err()),
            "INVALID_CURSOR"
        );
        assert_eq!(
            code(decode::<Key>(&s, &"x".repeat(513)).unwrap_err()),
            "MAXLENGTH"
        );
    }

    #[test]
    fn another_secret_is_refused() {
        let cursor = encode(&secret("test-hmac-secret-0123456789abcdef"), &key()).unwrap();
        let other = secret("another-secret-0123456789abcdefgh");
        assert_eq!(
            code(decode::<Key>(&other, &cursor).unwrap_err()),
            "INVALID_CURSOR"
        );
    }

    #[test]
    fn limits() {
        assert_eq!(limit(None).unwrap(), 20);
        assert_eq!(limit(Some("100")).unwrap(), 100);
        assert_eq!(code(limit(Some("0")).unwrap_err()), "MIN");
        assert_eq!(code(limit(Some("101")).unwrap_err()), "MAX");
        assert_eq!(code(limit(Some("99999999999")).unwrap_err()), "MAX");
        assert_eq!(code(limit(Some("x")).unwrap_err()), "ISINT");
    }

    #[test]
    fn the_envelope() {
        assert_eq!(
            page(vec![json!(1)], Some("c".into())),
            json!({"data": [1], "page": {"hasMore": true, "nextCursor": "c"}})
        );
        assert_eq!(
            page(vec![], None),
            json!({"data": [], "page": {"hasMore": false, "nextCursor": null}})
        );
    }
}
