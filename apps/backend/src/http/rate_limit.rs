//! Rate limits: sliding-window counters in Redis, one atomic script per check.
//! The limits of the spec are declared here and nowhere else.

use std::{
    collections::HashMap,
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        LazyLock, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use ipnet::IpNet;
use secrecy::ExposeSecret;
use sha2::Sha256;

use crate::{error::AppError, state::AppState};

pub struct Rule {
    /// Part of the Redis key: two rules must never share a name.
    pub name: &'static str,
    pub limit: u32,
    pub window_s: u64,
    /// When Redis does not answer: `true` refuses the request (routes that create or prove an identity,
    /// and the two whose every use is costly), `false` keeps serving and counts in this process instead.
    pub fail_closed: bool,
}

const fn rule(name: &'static str, limit: u32, window_s: u64, fail_closed: bool) -> Rule {
    Rule {
        name,
        limit,
        window_s,
        fail_closed,
    }
}

pub const GLOBAL_IP: Rule = rule("global-ip", 300, 60, false);
pub const GLOBAL_USER: Rule = rule("global-user", 120, 60, false);
pub const LOGIN_IP: Rule = rule("login-ip", 10, 60, true);
pub const LOGIN_ACCOUNT: Rule = rule("login-account", 5, 900, true);
pub const REGISTER_IP: Rule = rule("register", 5, 3600, true);
pub const REFRESH_IP: Rule = rule("refresh", 30, 60, true);
pub const FORGOT_IP: Rule = rule("forgot-ip", 10, 3600, true);
pub const FORGOT_ACCOUNT: Rule = rule("forgot-account", 3, 3600, true);
pub const RESET_IP: Rule = rule("reset", 10, 3600, true);
pub const VERIFY_IP: Rule = rule("email-verify", 20, 3600, true);
pub const RESEND_USER: Rule = rule("email-resend", 3, 3600, true);
pub const EXPORT_USER: Rule = rule("export", 3, 86_400, true);

/// Sliding-window counter: the previous fixed window counts in proportion to how much of it still
/// overlaps the last `window` seconds. KEYS: current window, previous window. ARGV: limit, window
/// length, seconds elapsed in the current window. Returns 1 when the request is allowed.
static SCRIPT: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r"
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2] * 2) end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local weight = (ARGV[2] - ARGV[3]) / ARGV[2]
if previous * weight + current > tonumber(ARGV[1]) then return 0 end
return 1
",
    )
});

/// `(index of the fixed window containing now, seconds elapsed in it)`.
fn window(now_s: u64, window_s: u64) -> (u64, u64) {
    (now_s / window_s, now_s % window_s)
}

/// Addresses and emails never appear in Redis: keys carry a keyed hash of the subject.
fn subject_hash(secret: &[u8], subject: &str) -> String {
    #[allow(clippy::expect_used)] // HMAC accepts a key of any length; this cannot fail.
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(b"ratelimit:");
    mac.update(subject.as_bytes());
    URL_SAFE_NO_PAD.encode(&mac.finalize().into_bytes()[..16])
}

fn unix_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

/// What this process counts while Redis does not answer, so that an outage does not lift the two
/// general limits: key → (window index, requests seen in it). It is an approximation, on purpose: it
/// starts from zero, knows nothing of what Redis had counted, uses a fixed window, and every instance
/// counts alone. A client can so get a few times the limit around an outage, never an unlimited
/// number. The rules where that matters (identity, export, resend) do not use it: they refuse.
static LOCAL: LazyLock<Mutex<HashMap<String, (u64, u32)>>> = LazyLock::new(Mutex::default);

/// ponytail: one map behind one lock, emptied when it holds this many subjects (about 15 MB). It is
/// only used while Redis is away; shard it if an outage under a flood ever shows contention.
const LOCAL_CAPACITY: usize = 100_000;

fn local_allows(key: String, index: u64, limit: u32) -> bool {
    let mut counts = LOCAL.lock().unwrap_or_else(PoisonError::into_inner);
    if counts.len() >= LOCAL_CAPACITY && !counts.contains_key(&key) {
        counts.clear();
    }
    let entry = counts.entry(key).or_insert((index, 0));
    if entry.0 != index {
        *entry = (index, 0);
    }
    entry.1 = entry.1.saturating_add(1);
    entry.1 <= limit
}

/// At most one line a second: during an outage every request comes through here.
fn warn_outage(rule: &Rule, cause: &str) {
    static LAST_S: AtomicU64 = AtomicU64::new(0);
    let now = unix_s();
    if LAST_S.swap(now, Ordering::Relaxed) != now {
        tracing::warn!(
            rule = rule.name,
            cause,
            "rate limiter unavailable; counting in this process"
        );
    }
}

/// What a check means, given what Redis answered. `local` is asked only when Redis gave no answer and
/// the rule keeps serving. Pure, so the outage rule is tested without an outage.
fn decide(
    rule: &Rule,
    outcome: Result<i64, String>,
    retry_after_s: u64,
    local: impl FnOnce() -> bool,
) -> Result<(), AppError> {
    let refused = || {
        AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many requests",
        )
        .retry_after(retry_after_s)
    };
    match outcome {
        Ok(1) => Ok(()),
        Ok(_) => Err(refused()),
        Err(cause) if rule.fail_closed => {
            Err(AppError::unavailable(format!("rate limiter: {cause}")))
        }
        Err(cause) => {
            warn_outage(rule, &cause);
            if local() { Ok(()) } else { Err(refused()) }
        }
    }
}

/// Counts one request by `subject` (an address, a user id or an email) against `rule`.
pub async fn check(state: &AppState, rule: &Rule, subject: &str) -> Result<(), AppError> {
    if !state.cfg.rate_limit_enabled {
        return Ok(());
    }
    let (index, elapsed) = window(unix_s(), rule.window_s);
    let hash = subject_hash(
        state.cfg.app_hmac_secret.expose_secret().as_bytes(),
        subject,
    );
    let counter = format!("{}rl:{}:{}", state.redis_prefix, rule.name, hash);
    let key = |i: u64| format!("{counter}:{i}");
    let mut connection = state.redis.clone();
    let outcome: Result<i64, String> = SCRIPT
        .key(key(index))
        .key(key(index.saturating_sub(1)))
        .arg(rule.limit)
        .arg(rule.window_s)
        .arg(elapsed)
        .invoke_async(&mut connection)
        .await
        .map_err(|e: redis::RedisError| e.to_string());
    decide(rule, outcome, rule.window_s - elapsed, || {
        local_allows(counter.clone(), index, rule.limit)
    })
}

/// The address a request really comes from. `X-Forwarded-For` is believed only when the peer is a
/// trusted proxy, and then the rightmost address that is not itself a trusted proxy is the client:
/// everything to its left was written by the client and may be forged.
pub fn client_ip(peer: IpAddr, forwarded_for: Option<&str>, trusted: &[IpNet]) -> IpAddr {
    let peer = peer.to_canonical();
    let is_trusted = |ip: &IpAddr| trusted.iter().any(|net| net.contains(ip));
    if !is_trusted(&peer) {
        return peer;
    }
    for entry in forwarded_for
        .into_iter()
        .flat_map(|value| value.rsplit(','))
    {
        match parse_forwarded(entry) {
            Some(ip) if is_trusted(&ip) => {}
            Some(ip) => return ip,
            // An entry this parser cannot read ends the walk. Skipping it would let the client choose
            // its address, by writing one of its own further left.
            None => return peer,
        }
    }
    peer
}

/// One `X-Forwarded-For` entry: an address, possibly in brackets or with a port
/// (`1.2.3.4`, `1.2.3.4:5678`, `[2001:db8::1]`, `[2001:db8::1]:443`).
fn parse_forwarded(entry: &str) -> Option<IpAddr> {
    let entry = entry.trim();
    let bare = entry
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(entry);
    bare.parse::<IpAddr>()
        .ok()
        .or_else(|| entry.parse::<SocketAddr>().ok().map(|socket| socket.ip()))
        .map(|ip| ip.to_canonical())
}

/// The counter an address falls into. An IPv6 customer usually holds a whole /64 and could use a new
/// address for every request, so IPv6 is counted per /64 network. An IPv4-mapped address counts as IPv4.
pub fn ip_subject(ip: IpAddr) -> String {
    match ip.to_canonical() {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => {
            let s = v6.segments();
            format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
        }
    }
}

/// The client address of the current request. The address itself stays private: a limit keyed by it
/// would be one an IPv6 client steps around.
pub struct ClientIp(IpAddr);

impl ClientIp {
    /// What every per-address rule counts by. Never the raw address: see `ip_subject`.
    pub fn subject(&self) -> String {
        ip_subject(self.0)
    }
}

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Infallible> {
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |info| info.0.ip());
        // A proxy may append its entry as a second header line: read them all, in order. A line holding
        // a byte that is not text is read too: dropping it would drop the address the proxy appended to it.
        let lines: Vec<_> = parts
            .headers
            .get_all("x-forwarded-for")
            .iter()
            .map(|v| String::from_utf8_lossy(v.as_bytes()))
            .collect();
        let forwarded = (!lines.is_empty()).then(|| lines.join(","));
        Ok(Self(client_ip(
            peer,
            forwarded.as_deref(),
            &state.cfg.trusted_proxies,
        )))
    }
}

/// Applies the per-address limit to every request.
pub async fn global(
    State(state): State<AppState>,
    client: ClientIp,
    req: Request,
    next: Next,
) -> Response {
    match check(&state, &GLOBAL_IP, &client.subject()).await {
        Ok(()) => next.run(req).await,
        Err(refused) => refused.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn a_window_is_identified_by_its_index_and_the_seconds_elapsed() {
        assert_eq!(window(125, 60), (2, 5));
        assert_eq!(window(120, 60), (2, 0));
        assert_eq!(window(3599, 3600), (0, 3599));
    }

    #[test]
    fn subjects_are_hashed_with_the_secret() {
        let a = subject_hash(b"secret-one-0123456789abcdef0123456", "9.9.9.9");
        assert_eq!(
            a,
            subject_hash(b"secret-one-0123456789abcdef0123456", "9.9.9.9")
        );
        assert_ne!(
            a,
            subject_hash(b"secret-one-0123456789abcdef0123456", "9.9.9.8")
        );
        assert_ne!(
            a,
            subject_hash(b"secret-two-0123456789abcdef0123456", "9.9.9.9")
        );
        assert!(!a.contains("9.9.9.9"));
    }

    #[test]
    fn forwarded_for_is_ignored_unless_the_peer_is_a_trusted_proxy() {
        let trusted: Vec<IpNet> = vec!["10.0.0.0/8".parse().unwrap()];
        // A client connecting directly can write anything in the header: it is not believed.
        assert_eq!(
            client_ip(ip("203.0.113.7"), Some("1.2.3.4"), &trusted),
            ip("203.0.113.7")
        );
        assert_eq!(
            client_ip(ip("203.0.113.7"), Some("1.2.3.4"), &[]),
            ip("203.0.113.7")
        );
        // Behind the proxy, the header is believed.
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("1.2.3.4"), &trusted),
            ip("1.2.3.4")
        );
        assert_eq!(client_ip(ip("10.0.0.1"), None, &trusted), ip("10.0.0.1"));
    }

    #[test]
    fn only_the_rightmost_untrusted_address_counts() {
        let trusted: Vec<IpNet> = vec!["10.0.0.0/8".parse().unwrap()];
        // The client put 6.6.6.6 in front; the proxy appended the address it really saw.
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, 1.2.3.4"), &trusted),
            ip("1.2.3.4")
        );
        // Two proxies in a row: both are skipped.
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, 1.2.3.4, 10.0.0.2"), &trusted),
            ip("1.2.3.4")
        );
        // An unreadable entry ends the walk: the peer is used.
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("not-an-ip, 10.0.0.3"), &trusted),
            ip("10.0.0.1")
        );
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("2001:db8::1"), &trusted),
            ip("2001:db8::1")
        );
    }

    #[test]
    fn a_redis_outage_closes_identity_routes_and_counts_the_rest_in_this_process() {
        let down = || Err("connection refused".to_owned());
        let closed = decide(&LOGIN_IP, down(), 10, || true).unwrap_err();
        assert_eq!(closed.status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(decide(&GLOBAL_IP, down(), 10, || true).is_ok());
        let over = decide(&GLOBAL_IP, down(), 10, || false).unwrap_err();
        assert_eq!(over.status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn the_local_count_holds_the_limit_and_starts_again_with_each_window() {
        let key = || "unit-test:local:a".to_owned();
        assert!((0..3).all(|_| local_allows(key(), 7, 3)));
        assert!(!local_allows(key(), 7, 3));
        assert!(
            local_allows("unit-test:local:b".to_owned(), 7, 3),
            "another subject is not affected"
        );
        assert!(local_allows(key(), 8, 3), "a new window starts from zero");
    }

    #[test]
    fn a_refusal_is_a_429_and_an_allowance_passes() {
        assert!(decide(&LOGIN_IP, Ok(1), 10, || false).is_ok());
        let refused = decide(&LOGIN_IP, Ok(0), 10, || true).unwrap_err();
        assert_eq!(
            (refused.status, refused.code),
            (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED")
        );
    }

    #[test]
    fn the_table_matches_the_spec() {
        let table = [
            (&GLOBAL_IP, 300, 60, false),
            (&GLOBAL_USER, 120, 60, false),
            (&LOGIN_IP, 10, 60, true),
            (&LOGIN_ACCOUNT, 5, 900, true),
            (&REGISTER_IP, 5, 3600, true),
            (&REFRESH_IP, 30, 60, true),
            (&FORGOT_IP, 10, 3600, true),
            (&FORGOT_ACCOUNT, 3, 3600, true),
            (&RESET_IP, 10, 3600, true),
            (&VERIFY_IP, 20, 3600, true),
            (&RESEND_USER, 3, 3600, true),
            (&EXPORT_USER, 3, 86_400, true),
        ];
        for (rule, limit, window_s, fail_closed) in table {
            assert_eq!(
                (rule.limit, rule.window_s, rule.fail_closed),
                (limit, window_s, fail_closed),
                "{}",
                rule.name
            );
        }
        let mut names: Vec<&str> = table.iter().map(|(rule, ..)| rule.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(
            names.len(),
            table.len(),
            "two rules sharing a name would share their counters"
        );
    }

    #[test]
    fn an_unreadable_forwarded_entry_ends_the_walk() {
        let trusted: Vec<IpNet> = vec!["10.0.0.0/8".parse().unwrap()];
        // The proxy wrote something this parser cannot read. Walking past it would let the client choose
        // its own address (6.6.6.6 is whatever it typed), so the proxy's address is used instead.
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, garbage"), &trusted),
            ip("10.0.0.1")
        );
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, "), &trusted),
            ip("10.0.0.1")
        );
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, unknown, 10.0.0.2"), &trusted),
            ip("10.0.0.1")
        );
    }

    #[test]
    fn a_forwarded_entry_may_carry_a_port_or_brackets() {
        let trusted: Vec<IpNet> = vec!["10.0.0.0/8".parse().unwrap()];
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, 203.0.113.7:51234"), &trusted),
            ip("203.0.113.7")
        );
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, [2001:db8::7]:443"), &trusted),
            ip("2001:db8::7")
        );
        assert_eq!(
            client_ip(ip("10.0.0.1"), Some("6.6.6.6, [2001:db8::7]"), &trusted),
            ip("2001:db8::7")
        );
        // A proxy reached over an IPv4-mapped IPv6 socket is still the trusted proxy.
        assert_eq!(
            client_ip(ip("::ffff:10.0.0.1"), Some("1.2.3.4"), &trusted),
            ip("1.2.3.4")
        );
    }

    #[test]
    fn ipv6_is_counted_per_64_network_and_mapped_ipv4_as_ipv4() {
        assert_eq!(ip_subject(ip("203.0.113.7")), "203.0.113.7");
        assert_eq!(ip_subject(ip("::ffff:203.0.113.7")), "203.0.113.7");
        assert_eq!(
            ip_subject(ip("2001:db8:1:2:aaaa:bbbb:cccc:dddd")),
            ip_subject(ip("2001:db8:1:2::1"))
        );
        assert_ne!(
            ip_subject(ip("2001:db8:1:2::1")),
            ip_subject(ip("2001:db8:1:3::1"))
        );
        assert_ne!(
            ip_subject(ip("2001:db8:1:2::1")),
            ip_subject(ip("203.0.113.7"))
        );
    }
}
