//! One error type for the whole API, rendered as RFC 9457 problem+json.
//! Clients translate the stable `code`; `title` is a developer hint. A 5xx never tells the client why.

use std::fmt::Display;

use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::{Map, Value, json};

tokio::task_local! {
    /// Set by the outermost middleware; read when an error is rendered, so every problem carries its trace id.
    pub static REQUEST_ID: String;
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FieldError {
    pub field: String,
    pub code: String,
}

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub code: &'static str,
    pub title: String,
    /// The rarely used parts sit behind one pointer, so a `Result<T, AppError>` stays small.
    more: Box<More>,
}

#[derive(Debug, Default)]
struct More {
    detail: Option<&'static str>,
    errors: Vec<FieldError>,
    extra: Map<String, Value>,
    retry_after_s: Option<u64>,
    /// Logged for a 5xx, never sent.
    cause: Option<String>,
}

impl AppError {
    pub fn new(status: StatusCode, code: &'static str, title: &str) -> Self {
        Self {
            status,
            code,
            title: title.to_owned(),
            more: Box::default(),
        }
    }

    pub fn detail(mut self, detail: &'static str) -> Self {
        self.more.detail = Some(detail);
        self
    }

    /// Adds a field to the problem body (e.g. `lockedUntil`). Reserved fields always win over extras.
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.more.extra.insert(key.to_owned(), value.into());
        self
    }

    pub fn retry_after(mut self, seconds: u64) -> Self {
        self.more.retry_after_s = Some(seconds);
        self
    }

    pub fn validation(errors: Vec<FieldError>) -> Self {
        let mut e = Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_FAILED",
            "Validation failed",
        )
        .detail("One or more fields are invalid.");
        e.more.errors = errors;
        e
    }

    pub fn field(field: &str, code: &str) -> Self {
        Self::validation(vec![FieldError {
            field: field.to_owned(),
            code: code.to_owned(),
        }])
    }

    pub fn unauthenticated(code: &'static str, title: &str) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, code, title)
    }

    pub fn forbidden() -> Self {
        Self::new(StatusCode::FORBIDDEN, "FORBIDDEN", "Forbidden")
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            &format!("{what} not found"),
        )
    }

    pub fn conflict(code: &'static str) -> Self {
        Self::new(StatusCode::CONFLICT, code, "Conflict")
    }

    pub fn internal(cause: impl Display) -> Self {
        let mut e = Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            "Internal error",
        );
        e.more.cause = Some(cause.to_string());
        e
    }

    pub fn unavailable(cause: impl Display) -> Self {
        let mut e = Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "Service temporarily unavailable",
        );
        e.more.cause = Some(cause.to_string());
        e
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        Self::internal(e)
    }
}

impl From<redis::RedisError> for AppError {
    fn from(e: redis::RedisError) -> Self {
        Self::internal(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if self.status.is_server_error() {
            tracing::error!(
                code = self.code,
                cause = self.more.cause.as_deref().unwrap_or(""),
                "request failed"
            );
        }
        // Extras go in first, so they can never overwrite the reserved fields written after them.
        let more = *self.more;
        let mut body = more.extra;
        body.insert(
            "type".into(),
            json!(format!(
                "https://errors.fitnessleague.app/{}",
                self.code.to_lowercase().replace('_', "-")
            )),
        );
        body.insert("title".into(), json!(self.title));
        body.insert("status".into(), json!(self.status.as_u16()));
        body.insert("code".into(), json!(self.code));
        if let Some(detail) = more.detail {
            body.insert("detail".into(), json!(detail));
        }
        if !more.errors.is_empty() {
            body.insert("errors".into(), json!(more.errors));
        }
        if let Ok(id) = REQUEST_ID.try_with(Clone::clone) {
            body.insert("traceId".into(), json!(id));
        }
        let mut res = (self.status, Json(Value::Object(body))).into_response();
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        if let Some(seconds) = more.retry_after_s {
            res.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(seconds));
        }
        res
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use http_body_util::BodyExt;

    use super::*;

    async fn body(res: Response) -> Value {
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    async fn renders_problem_json_with_a_stable_code() {
        let res = AppError::conflict("EMAIL_TAKEN").into_response();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(
            res.headers()[header::CONTENT_TYPE],
            "application/problem+json"
        );
        let b = body(res).await;
        assert_eq!(b["code"], "EMAIL_TAKEN");
        assert_eq!(b["status"], 409);
        assert_eq!(b["type"], "https://errors.fitnessleague.app/email-taken");
        assert!(b.get("traceId").is_none());
    }

    #[tokio::test]
    async fn extras_cannot_overwrite_reserved_fields() {
        let res = AppError::forbidden()
            .with("status", 200)
            .with("code", "OK")
            .with("suspendedUntil", "2026-11-01T00:00:00.000Z")
            .into_response();
        let b = body(res).await;
        assert_eq!(b["status"], 403);
        assert_eq!(b["code"], "FORBIDDEN");
        assert_eq!(b["suspendedUntil"], "2026-11-01T00:00:00.000Z");
    }

    #[tokio::test]
    async fn a_server_error_never_carries_its_cause() {
        let res = AppError::internal("connection to 10.0.0.5:3306 refused: SELECT * FROM users")
            .into_response();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let text = body(res).await.to_string();
        assert!(
            !text.contains("10.0.0.5") && !text.contains("SELECT"),
            "{text}"
        );
    }

    #[tokio::test]
    async fn carries_the_request_id_and_retry_after() {
        let res = REQUEST_ID
            .scope("req-123".to_owned(), async {
                AppError::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    "RATE_LIMITED",
                    "Too many requests",
                )
                .retry_after(42)
                .into_response()
            })
            .await;
        assert_eq!(res.headers()[header::RETRY_AFTER], "42");
        assert_eq!(body(res).await["traceId"], "req-123");
    }

    #[tokio::test]
    async fn validation_errors_list_every_field() {
        let res = AppError::validation(vec![
            FieldError {
                field: "email".into(),
                code: "ISEMAIL".into(),
            },
            FieldError {
                field: "consents.terms".into(),
                code: "EQUALS".into(),
            },
        ])
        .into_response();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let b = body(res).await;
        assert_eq!(b["code"], "VALIDATION_FAILED");
        assert_eq!(
            b["errors"],
            serde_json::json!([{"field": "email", "code": "ISEMAIL"}, {"field": "consents.terms", "code": "EQUALS"}])
        );
    }
}
