//! The HTTP shell: one route table and one middleware stack for the whole API.

pub mod auth;
pub mod rate_limit;

use std::{
    any::Any,
    time::{Duration, Instant},
};

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    handler::Handler,
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{self, MethodRouter},
};
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::{AllowOrigin, CorsLayer},
};
use tracing::Instrument;
use uuid::Uuid;

use crate::{
    config::{AppEnv, Config},
    error::{AppError, REQUEST_ID},
    modules,
    state::AppState,
};

pub const MAX_BODY_BYTES: usize = 256 * 1024;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Every route is added through this builder, so the whole route table can be listed and tested.
pub struct Api {
    router: Router<AppState>,
    table: Vec<(Method, &'static str)>,
}

impl Api {
    fn new() -> Self {
        Self {
            router: Router::new(),
            table: Vec::new(),
        }
    }

    pub fn get<H, T>(self, path: &'static str, handler: H) -> Self
    where
        H: Handler<T, AppState>,
        T: 'static,
    {
        self.add(Method::GET, path, routing::get(handler))
    }

    pub fn post<H, T>(self, path: &'static str, handler: H) -> Self
    where
        H: Handler<T, AppState>,
        T: 'static,
    {
        self.add(Method::POST, path, routing::post(handler))
    }

    pub fn put<H, T>(self, path: &'static str, handler: H) -> Self
    where
        H: Handler<T, AppState>,
        T: 'static,
    {
        self.add(Method::PUT, path, routing::put(handler))
    }

    pub fn patch<H, T>(self, path: &'static str, handler: H) -> Self
    where
        H: Handler<T, AppState>,
        T: 'static,
    {
        self.add(Method::PATCH, path, routing::patch(handler))
    }

    pub fn delete<H, T>(self, path: &'static str, handler: H) -> Self
    where
        H: Handler<T, AppState>,
        T: 'static,
    {
        self.add(Method::DELETE, path, routing::delete(handler))
    }

    fn add(mut self, method: Method, path: &'static str, route: MethodRouter<AppState>) -> Self {
        self.table.push((method, path));
        self.router = self.router.route(path, route);
        self
    }
}

/// The one place where modules join the API.
fn api() -> Api {
    let api = modules::health::routes(Api::new());
    let api = modules::reference::routes(api);
    let api = modules::auth::routes(api);
    let api = modules::admin_auth::routes(api);
    modules::me::routes(api)
}

/// `(method, path)` of every registered route.
pub fn route_table() -> Vec<(Method, &'static str)> {
    api().table
}

pub fn app(state: AppState) -> Router {
    // A request crosses the layers from the last `.layer` to the first: request context, panic catcher,
    // security headers, CORS, timeout, the per-address rate limit, and then the route.
    api()
        .router
        .fallback(|| async { AppError::not_found("Route") })
        .method_not_allowed_fallback(|| async {
            AppError::new(
                StatusCode::METHOD_NOT_ALLOWED,
                "METHOD_NOT_ALLOWED",
                "Method not allowed",
            )
        })
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit::global,
        ))
        .layer(middleware::from_fn(timeout))
        .layer(cors(&state.cfg))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security_headers,
        ))
        .layer(CatchPanicLayer::custom(panic_response))
        .layer(middleware::from_fn(request_context))
        .with_state(state)
}

/// Gives the request an id, makes it available to error rendering, and writes one access-log line.
/// The line never contains a body, a header or a query string.
async fn request_context(req: Request, next: Next) -> Response {
    let id = Uuid::now_v7().to_string();
    let span = tracing::info_span!("request", request_id = %id, method = %req.method(), path = req.uri().path(), user_id = tracing::field::Empty);
    let started = Instant::now();
    let mut res = REQUEST_ID
        .scope(id.clone(), next.run(req))
        .instrument(span.clone())
        .await;
    span.in_scope(|| {
        tracing::info!(
            status = res.status().as_u16(),
            ms = started.elapsed().as_millis() as u64,
            "request"
        )
    });
    if let Ok(value) = HeaderValue::from_str(&id) {
        res.headers_mut()
            .insert(HeaderName::from_static("x-request-id"), value);
    }
    res
}

fn panic_response(_panic: Box<dyn Any + Send + 'static>) -> Response {
    AppError::internal("a handler panicked").into_response()
}

async fn security_headers(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    // Nothing is cached unless a handler says so (only the public reference lists do).
    if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    if state.cfg.env == AppEnv::Production {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        );
    }
    res
}

/// Only the listed origins (the admin panel) may call the API from a browser. No cookies are used,
/// so credentials are never allowed.
fn cors(cfg: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = cfg
        .cors_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::ACCEPT_LANGUAGE,
            header::IF_MATCH,
            HeaderName::from_static("idempotency-key"),
        ])
        .max_age(Duration::from_secs(600))
}

async fn timeout(req: Request, next: Next) -> Response {
    match tokio::time::timeout(REQUEST_TIMEOUT, next.run(req)).await {
        Ok(res) => res,
        Err(_) => AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "TIMEOUT",
            "Request timed out",
        )
        .into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use axum::{body::Body, routing::get};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    async fn call(router: Router) -> (StatusCode, serde_json::Value) {
        let res = router
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        (
            status,
            serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap(),
        )
    }

    #[tokio::test]
    async fn a_panicking_handler_becomes_a_500_without_details() {
        async fn boom() -> &'static str {
            panic!("secret internal state")
        }
        let (status, body) = call(
            Router::new()
                .route("/", get(boom))
                .layer(CatchPanicLayer::custom(panic_response)),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["code"], "INTERNAL");
        assert!(!body.to_string().contains("secret"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_handler_is_cut_off() {
        async fn slow() -> &'static str {
            tokio::time::sleep(REQUEST_TIMEOUT * 2).await;
            "late"
        }
        let (status, body) = call(
            Router::new()
                .route("/", get(slow))
                .layer(middleware::from_fn(timeout)),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "TIMEOUT");
    }
}
