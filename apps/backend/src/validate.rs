//! Validation at the trust boundary: a body is parsed strictly, then checked field by field.
//! Unknown fields are refused, which is also what stops a client from sending its own points.

use axum::{
    body::Bytes,
    extract::{FromRequest, FromRequestParts, Query, Request},
    http::{StatusCode, header, request::Parts},
};
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::error::{AppError, FieldError};

/// Collects field errors so the client sees every problem in one answer.
#[derive(Default)]
pub struct Check {
    errors: Vec<FieldError>,
}

impl Check {
    pub fn fail(&mut self, field: &str, code: &str) {
        self.errors.push(FieldError {
            field: field.to_owned(),
            code: code.to_owned(),
        });
    }

    pub fn ensure(&mut self, field: &str, ok: bool, code: &str) {
        if !ok {
            self.fail(field, code);
        }
    }

    /// Length in characters, not bytes: an Arabic name of 80 letters is 80 long.
    pub fn length(&mut self, field: &str, value: &str, min: usize, max: usize) {
        let n = value.chars().count();
        if n < min {
            self.fail(field, "MINLENGTH");
        } else if n > max {
            self.fail(field, "MAXLENGTH");
        }
    }

    pub fn range(&mut self, field: &str, value: i64, min: i64, max: i64) {
        if value < min {
            self.fail(field, "MIN");
        } else if value > max {
            self.fail(field, "MAX");
        }
    }

    pub fn finish(self) -> Result<(), AppError> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(AppError::validation(self.errors))
        }
    }
}

/// The rules of one request body. Structs that deserialize a body also derive
/// `#[serde(deny_unknown_fields)]`.
pub trait Validate {
    fn validate(&self, check: &mut Check);
}

/// A JSON body that was parsed strictly and passed its rules.
pub struct ValidJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Validate,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, AppError> {
        let is_json = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(';').next())
            .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"));
        if !is_json {
            return Err(AppError::new(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "UNSUPPORTED_MEDIA_TYPE",
                "Content-Type must be application/json",
            ));
        }
        let bytes = Bytes::from_request(req, state).await.map_err(|rejection| {
            if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                AppError::new(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "PAYLOAD_TOO_LARGE",
                    "Request body too large",
                )
            } else {
                AppError::new(
                    StatusCode::BAD_REQUEST,
                    "VALIDATION_FAILED",
                    "Unreadable request body",
                )
            }
        })?;
        let value: T = parse(&bytes)?;
        let mut check = Check::default();
        value.validate(&mut check);
        check.finish()?;
        Ok(Self(value))
    }
}

/// Strict JSON → `T`. A syntax error is a 400; anything wrong with the data is a 422 naming the field.
pub fn parse<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, AppError> {
    // A request body is always a JSON object. Left to itself, serde would also accept an array holding
    // the fields in order.
    if bytes.iter().find(|byte| !byte.is_ascii_whitespace()) != Some(&b'{') {
        return Err(
            match serde_json::from_slice::<serde::de::IgnoredAny>(bytes) {
                Ok(_) => AppError::field("body", "INVALID"),
                Err(_) => AppError::new(
                    StatusCode::BAD_REQUEST,
                    "VALIDATION_FAILED",
                    "Malformed JSON",
                ),
            },
        );
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    serde_path_to_error::deserialize(&mut de).map_err(|e| {
        let path = e.path().to_string();
        let inner = e.into_inner();
        if !inner.is_data() {
            return AppError::new(
                StatusCode::BAD_REQUEST,
                "VALIDATION_FAILED",
                "Malformed JSON",
            );
        }
        let message = inner.to_string();
        let quoted = |prefix: &str| {
            message
                .strip_prefix(prefix)
                .and_then(|rest| rest.split('`').next())
                .map(str::to_owned)
        };
        let join = |name: &str| {
            if path == "." {
                name.to_owned()
            } else {
                format!("{path}.{name}")
            }
        };
        if let Some(name) = quoted("unknown field `") {
            // Depending on the serde_path_to_error version, the path may already end with the unknown key.
            let field = if path == name || path.ends_with(&format!(".{name}")) {
                path.clone()
            } else {
                join(&name)
            };
            return AppError::field(&field, "UNKNOWN_FIELD");
        }
        if let Some(name) = quoted("missing field `") {
            return AppError::field(&join(&name), "REQUIRED");
        }
        AppError::field(if path == "." { "body" } else { &path }, "INVALID")
    })
}

/// A query string parsed into `T`. Query structs keep their fields as `Option<String>` and check them
/// with the helpers below, so a bad value names its field.
pub struct ValidQuery<T>(pub T);

impl<S, T> FromRequestParts<S> for ValidQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|_| AppError::field("query", "INVALID"))
    }
}

/// An optional id from the query string. Malformed is an error; absent is `None`.
pub fn uuid_param(field: &str, value: Option<&str>) -> Result<Option<Uuid>, AppError> {
    value
        .map(|raw| Uuid::parse_str(raw).map_err(|_| AppError::field(field, "ISUUID")))
        .transpose()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use axum::{Router, body::Body, extract::DefaultBodyLimit, routing::post};
    use http_body_util::BodyExt;
    use serde::Deserialize;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Consents {
        terms: bool,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct Signup {
        full_name: String,
        age: i64,
        consents: Consents,
    }

    impl Validate for Signup {
        fn validate(&self, check: &mut Check) {
            check.length("fullName", &self.full_name, 2, 80);
            check.range("age", self.age, 18, 120);
            check.ensure("consents.terms", self.consents.terms, "EQUALS");
        }
    }

    const JSON: Option<&str> = Some("application/json");

    async fn call(content_type: Option<&str>, body: String) -> (StatusCode, Value) {
        let app = Router::new()
            .route(
                "/",
                post(|ValidJson(s): ValidJson<Signup>| async move { s.full_name }),
            )
            .layer(DefaultBodyLimit::max(1024));
        let mut req = Request::builder().method("POST").uri("/");
        if let Some(ct) = content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        let res = app
            .oneshot(req.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    fn signup(full_name: &str) -> String {
        json!({"fullName": full_name, "age": 30, "consents": {"terms": true}}).to_string()
    }

    #[tokio::test]
    async fn accepts_a_valid_body_with_or_without_a_charset() {
        assert_eq!(
            call(JSON, signup("Ahmed Ben Salah")).await.0,
            StatusCode::OK
        );
        assert_eq!(
            call(Some("application/json; charset=utf-8"), signup("Ahmed"))
                .await
                .0,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn counts_characters_not_bytes() {
        // 80 Arabic letters are 160 bytes: allowed by an 80-character limit.
        assert_eq!(call(JSON, signup(&"ب".repeat(80))).await.0, StatusCode::OK);
        let (status, body) = call(JSON, signup(&"ب".repeat(81))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body["errors"],
            json!([{"field": "fullName", "code": "MAXLENGTH"}])
        );
    }

    #[tokio::test]
    async fn refuses_unknown_fields_at_any_depth() {
        let top = json!({"fullName": "Ahmed", "age": 30, "consents": {"terms": true}, "xp": 9999})
            .to_string();
        let (status, body) = call(JSON, top).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body["errors"],
            json!([{"field": "xp", "code": "UNKNOWN_FIELD"}])
        );

        let nested =
            json!({"fullName": "Ahmed", "age": 30, "consents": {"terms": true, "extra": 1}})
                .to_string();
        assert_eq!(
            call(JSON, nested).await.1["errors"],
            json!([{"field": "consents.extra", "code": "UNKNOWN_FIELD"}])
        );
    }

    #[tokio::test]
    async fn names_missing_and_mistyped_fields() {
        let missing = json!({"fullName": "Ahmed", "consents": {"terms": true}}).to_string();
        assert_eq!(
            call(JSON, missing).await.1["errors"],
            json!([{"field": "age", "code": "REQUIRED"}])
        );

        let mistyped =
            json!({"fullName": "Ahmed", "age": "thirty", "consents": {"terms": true}}).to_string();
        assert_eq!(
            call(JSON, mistyped).await.1["errors"],
            json!([{"field": "age", "code": "INVALID"}])
        );

        let nested =
            json!({"fullName": "Ahmed", "age": 30, "consents": {"terms": "yes"}}).to_string();
        assert_eq!(
            call(JSON, nested).await.1["errors"],
            json!([{"field": "consents.terms", "code": "INVALID"}])
        );

        assert_eq!(
            call(JSON, "[1, 2]".into()).await.1["errors"],
            json!([{"field": "body", "code": "INVALID"}])
        );
    }

    #[tokio::test]
    async fn refuses_a_body_that_is_not_an_object() {
        // serde would accept the fields as an array, in order. The API does not.
        let positional = json!(["Ahmed Ben Salah", 30, {"terms": true}]).to_string();
        for body in [
            positional,
            "[1, 2]".into(),
            "42".into(),
            "\"text\"".into(),
            "null".into(),
        ] {
            let (status, answer) = call(JSON, body.clone()).await;
            let expected = json!([{"field": "body", "code": "INVALID"}]);
            assert_eq!(
                (status, &answer["errors"]),
                (StatusCode::UNPROCESSABLE_ENTITY, &expected),
                "{body}"
            );
        }
    }

    #[tokio::test]
    async fn reports_every_broken_rule_at_once() {
        let bad = json!({"fullName": "A", "age": 5, "consents": {"terms": false}}).to_string();
        let (status, body) = call(JSON, bad).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body["errors"],
            json!([
                {"field": "fullName", "code": "MINLENGTH"},
                {"field": "age", "code": "MIN"},
                {"field": "consents.terms", "code": "EQUALS"}
            ])
        );
    }

    #[tokio::test]
    async fn refuses_malformed_json_wrong_media_types_and_oversized_bodies() {
        let (status, body) = call(JSON, "{\"fullName\": ".into()).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::BAD_REQUEST, Some("VALIDATION_FAILED"))
        );

        assert_eq!(
            call(None, signup("Ahmed")).await.1["code"],
            "UNSUPPORTED_MEDIA_TYPE"
        );
        assert_eq!(
            call(Some("text/plain"), signup("Ahmed")).await.0,
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );

        let (status, body) = call(JSON, signup(&"x".repeat(2000))).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::PAYLOAD_TOO_LARGE, Some("PAYLOAD_TOO_LARGE"))
        );
    }

    #[test]
    fn a_uuid_parameter_is_optional_but_never_malformed() {
        let id = uuid::Uuid::now_v7();
        assert_eq!(uuid_param("sportId", None).unwrap(), None);
        assert_eq!(
            uuid_param("sportId", Some(&id.to_string())).unwrap(),
            Some(id)
        );
        for bad in [
            "",
            "42",
            "' OR 1=1 --",
            "018f0000-0000-7000-8000-00000000000",
        ] {
            let err = uuid_param("sportId", Some(bad)).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "{bad:?}");
        }
    }
}
