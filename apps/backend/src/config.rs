//! Environment → typed configuration. The process refuses to start when this does not validate.

use std::{collections::HashMap, fmt, net::IpAddr, str::FromStr};

use base64::{Engine, engine::general_purpose::STANDARD};
use ipnet::IpNet;
use secrecy::SecretString;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Test,
    Production,
}

#[derive(Clone)]
pub struct Config {
    pub env: AppEnv,
    pub port: u16,
    pub log_level: String,
    pub app_name: String,
    pub app_link_base_url: String,
    pub business_utc_offset_minutes: i32,
    pub database_url: SecretString,
    pub redis_url: SecretString,
    pub jwt_private_key_pem: SecretString,
    /// `(key id, public key PEM)`. The first entry belongs to the signing key.
    pub jwt_public_keys: Vec<(String, String)>,
    pub jwt_issuer: String,
    pub access_token_ttl_s: u64,
    pub refresh_token_ttl_days: i64,
    pub app_hmac_secret: SecretString,
    pub cors_origins: Vec<String>,
    pub trusted_proxies: Vec<IpNet>,
    pub smtp_url: Option<SecretString>,
    pub mail_from: String,
    pub rate_limit_enabled: bool,
}

/// Secrets print as `[REDACTED]` through `SecretString`; keys print as their ids only.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("env", &self.env)
            .field("port", &self.port)
            .field("log_level", &self.log_level)
            .field("app_link_base_url", &self.app_link_base_url)
            .field("database_url", &self.database_url)
            .field("redis_url", &self.redis_url)
            .field("jwt_key_ids", &self.jwt_public_keys.iter().map(|(kid, _)| kid).collect::<Vec<_>>())
            .field("jwt_issuer", &self.jwt_issuer)
            .field("cors_origins", &self.cors_origins)
            .field("trusted_proxies", &self.trusted_proxies)
            .field("smtp_url", &self.smtp_url)
            .field("rate_limit_enabled", &self.rate_limit_enabled)
            .finish_non_exhaustive()
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::from_map(&std::env::vars().collect())
    }

    /// Every problem is reported at once, one per line.
    pub fn from_map(vars: &HashMap<String, String>) -> Result<Self, String> {
        let mut r = Reader { vars, problems: Vec::new() };

        let env = match r.get("APP_ENV").unwrap_or("development") {
            "development" => AppEnv::Development,
            "test" => AppEnv::Test,
            "production" => AppEnv::Production,
            other => {
                r.problems.push(format!("APP_ENV: unknown value {other:?}"));
                AppEnv::Development
            }
        };

        let database_url = r.required("DATABASE_URL");
        if !database_url.is_empty() && !database_url.starts_with("mysql://") {
            r.problems.push("DATABASE_URL: must start with mysql://".into());
        }
        let redis_url = r.required("REDIS_URL");
        if !redis_url.is_empty() && !redis_url.starts_with("redis://") && !redis_url.starts_with("rediss://") {
            r.problems.push("REDIS_URL: must start with redis:// or rediss://".into());
        }

        let jwt_private_key_pem = r.pem("JWT_PRIVATE_KEY_B64");
        let mut jwt_public_keys = vec![(r.or("JWT_KEY_ID", "k1"), r.pem("JWT_PUBLIC_KEY_B64"))];
        for pair in r.list("JWT_EXTRA_PUBLIC_KEYS") {
            match pair.split_once(':').and_then(|(kid, b64)| decode_pem(b64).map(|pem| (kid.to_owned(), pem))) {
                Some(key) => jwt_public_keys.push(key),
                None => r.problems.push("JWT_EXTRA_PUBLIC_KEYS: expected kid:base64(PEM)[,…]".into()),
            }
        }

        let app_hmac_secret = r.required("APP_HMAC_SECRET");
        if !app_hmac_secret.is_empty() && app_hmac_secret.len() < 32 {
            r.problems.push("APP_HMAC_SECRET: at least 32 characters".into());
        }

        let mut trusted_proxies = Vec::new();
        for item in r.list("TRUSTED_PROXIES") {
            match item.parse::<IpNet>().ok().or_else(|| item.parse::<IpAddr>().ok().map(IpNet::from)) {
                Some(net) => trusted_proxies.push(net),
                None => r.problems.push(format!("TRUSTED_PROXIES: {item} is not an address or a network")),
            }
        }

        let rate_limit_enabled = match r.get("RATE_LIMIT_ENABLED") {
            None | Some("true") => true,
            Some("false") => false,
            Some(_) => {
                r.problems.push("RATE_LIMIT_ENABLED: expected true or false".into());
                true
            }
        };

        let cfg = Config {
            env,
            port: r.number("PORT", 3000u16, 1, u16::MAX),
            log_level: r.or("LOG_LEVEL", "info"),
            app_name: r.or("APP_NAME", "Fitness League"),
            app_link_base_url: r.or("APP_LINK_BASE_URL", "https://app.fitnessleague.app"),
            business_utc_offset_minutes: r.number("BUSINESS_UTC_OFFSET_MINUTES", 60i32, -720, 840),
            database_url: database_url.into(),
            redis_url: redis_url.into(),
            jwt_private_key_pem: jwt_private_key_pem.into(),
            jwt_public_keys,
            jwt_issuer: r.or("JWT_ISSUER", "fitness-league"),
            access_token_ttl_s: r.number("ACCESS_TOKEN_TTL_S", 900u64, 60, 3600),
            refresh_token_ttl_days: r.number("REFRESH_TOKEN_TTL_DAYS", 30i64, 1, 90),
            app_hmac_secret: app_hmac_secret.into(),
            cors_origins: r.list("CORS_ORIGINS"),
            trusted_proxies,
            smtp_url: r.get("SMTP_URL").map(|s| s.to_owned().into()),
            mail_from: r.or("MAIL_FROM", "Fitness League <no-reply@fitnessleague.app>"),
            rate_limit_enabled,
        };

        if cfg.env == AppEnv::Production {
            if !cfg.rate_limit_enabled {
                r.problems.push("RATE_LIMIT_ENABLED: cannot be false in production".into());
            }
            if cfg.cors_origins.iter().any(|o| o == "*") {
                r.problems.push("CORS_ORIGINS: * is not allowed in production".into());
            }
            if cfg.smtp_url.is_none() {
                r.problems.push("SMTP_URL: required in production".into());
            }
            if !cfg.app_link_base_url.starts_with("https://") {
                r.problems.push("APP_LINK_BASE_URL: must be https in production".into());
            }
        }

        if r.problems.is_empty() {
            Ok(cfg)
        } else {
            Err(format!("Invalid environment configuration:\n  - {}", r.problems.join("\n  - ")))
        }
    }
}

struct Reader<'a> {
    vars: &'a HashMap<String, String>,
    problems: Vec<String>,
}

impl<'a> Reader<'a> {
    /// A variable that is set but blank counts as missing.
    fn get(&self, key: &str) -> Option<&'a str> {
        self.vars.get(key).map(|v| v.trim()).filter(|v| !v.is_empty())
    }

    fn required(&mut self, key: &str) -> String {
        match self.get(key) {
            Some(v) => v.to_owned(),
            None => {
                self.problems.push(format!("{key}: required"));
                String::new()
            }
        }
    }

    fn or(&self, key: &str, default: &str) -> String {
        self.get(key).unwrap_or(default).to_owned()
    }

    fn list(&self, key: &str) -> Vec<String> {
        self.get(key)
            .map(|v| v.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default()
    }

    fn number<T: FromStr + PartialOrd + fmt::Display + Copy>(&mut self, key: &str, default: T, min: T, max: T) -> T {
        let Some(raw) = self.get(key) else { return default };
        match raw.parse::<T>() {
            Ok(n) if n >= min && n <= max => n,
            _ => {
                self.problems.push(format!("{key}: expected a number between {min} and {max}"));
                default
            }
        }
    }

    fn pem(&mut self, key: &str) -> String {
        let raw = self.required(key);
        if raw.is_empty() {
            return raw;
        }
        decode_pem(&raw).unwrap_or_else(|| {
            self.problems.push(format!("{key}: expected a base64-encoded PEM key"));
            String::new()
        })
    }
}

fn decode_pem(b64: &str) -> Option<String> {
    let text = String::from_utf8(STANDARD.decode(b64.trim()).ok()?).ok()?;
    text.contains("-----BEGIN").then_some(text)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn pem_b64(label: &str) -> String {
        STANDARD.encode(format!("-----BEGIN {label}-----\nAAAA\n-----END {label}-----\n"))
    }

    fn valid() -> HashMap<String, String> {
        [
            ("DATABASE_URL", "mysql://fl_app:db-pass-1234@localhost:3307/fitness_league".to_owned()),
            ("REDIS_URL", "redis://:redis-pass-1234@localhost:6379".to_owned()),
            ("JWT_PRIVATE_KEY_B64", pem_b64("PRIVATE KEY")),
            ("JWT_PUBLIC_KEY_B64", pem_b64("PUBLIC KEY")),
            ("APP_HMAC_SECRET", "0123456789abcdef0123456789abcdef".to_owned()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect()
    }

    fn with(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        let mut vars = valid();
        for (k, v) in pairs {
            vars.insert((*k).to_owned(), (*v).to_owned());
        }
        vars
    }

    #[test]
    fn loads_a_valid_environment_with_defaults() {
        let cfg = Config::from_map(&valid()).unwrap();
        assert_eq!(cfg.env, AppEnv::Development);
        assert_eq!(cfg.port, 3000);
        assert_eq!(cfg.access_token_ttl_s, 900);
        assert_eq!(cfg.refresh_token_ttl_days, 30);
        assert!(cfg.rate_limit_enabled);
        assert_eq!(cfg.jwt_public_keys.len(), 1);
        assert_eq!(cfg.jwt_public_keys[0].0, "k1");
        assert!(cfg.cors_origins.is_empty() && cfg.trusted_proxies.is_empty());
    }

    #[test]
    fn reports_every_missing_secret_at_once() {
        let err = Config::from_map(&HashMap::new()).unwrap_err();
        for key in ["DATABASE_URL", "REDIS_URL", "JWT_PRIVATE_KEY_B64", "JWT_PUBLIC_KEY_B64", "APP_HMAC_SECRET"] {
            assert!(err.contains(&format!("{key}: required")), "{key} missing from: {err}");
        }
    }

    #[test]
    fn a_blank_value_counts_as_missing() {
        let err = Config::from_map(&with(&[("APP_HMAC_SECRET", "   "), ("REDIS_URL", "")])).unwrap_err();
        assert!(err.contains("APP_HMAC_SECRET: required"));
        assert!(err.contains("REDIS_URL: required"));
    }

    #[test]
    fn refuses_weak_or_malformed_values() {
        let err = Config::from_map(&with(&[
            ("APP_HMAC_SECRET", "too-short"),
            ("DATABASE_URL", "postgres://x"),
            ("JWT_PUBLIC_KEY_B64", "not base64 pem"),
            ("PORT", "70000"),
            ("TRUSTED_PROXIES", "10.0.0.0/8, nonsense"),
        ]))
        .unwrap_err();
        for part in ["APP_HMAC_SECRET: at least 32", "DATABASE_URL: must start with mysql://", "JWT_PUBLIC_KEY_B64: expected", "PORT: expected", "TRUSTED_PROXIES: nonsense"] {
            assert!(err.contains(part), "{part} missing from: {err}");
        }
    }

    #[test]
    fn reads_lists_and_extra_verification_keys() {
        let extra = format!("old:{}", pem_b64("PUBLIC KEY"));
        let cfg = Config::from_map(&with(&[
            ("CORS_ORIGINS", " http://localhost:5173 , http://localhost:8081 "),
            ("TRUSTED_PROXIES", "10.0.0.0/8,192.168.1.7"),
            ("JWT_EXTRA_PUBLIC_KEYS", &extra),
            ("JWT_KEY_ID", "k2"),
        ]))
        .unwrap();
        assert_eq!(cfg.cors_origins, ["http://localhost:5173", "http://localhost:8081"]);
        assert_eq!(cfg.trusted_proxies.len(), 2);
        assert_eq!(cfg.jwt_public_keys.iter().map(|(kid, _)| kid.as_str()).collect::<Vec<_>>(), ["k2", "old"]);
    }

    #[test]
    fn production_refuses_unsafe_settings() {
        let err = Config::from_map(&with(&[
            ("APP_ENV", "production"),
            ("RATE_LIMIT_ENABLED", "false"),
            ("CORS_ORIGINS", "*"),
            ("APP_LINK_BASE_URL", "http://app.example"),
        ]))
        .unwrap_err();
        for part in ["RATE_LIMIT_ENABLED", "CORS_ORIGINS", "SMTP_URL: required in production", "APP_LINK_BASE_URL"] {
            assert!(err.contains(part), "{part} missing from: {err}");
        }
        let ok = with(&[("APP_ENV", "production"), ("SMTP_URL", "smtps://user:pw@mail.example:465")]);
        assert_eq!(Config::from_map(&ok).unwrap().env, AppEnv::Production);
    }

    #[test]
    fn debug_output_never_shows_a_secret() {
        let printed = format!("{:?}", Config::from_map(&with(&[("SMTP_URL", "smtp://user:smtp-pass-1234@mail")])).unwrap());
        for secret in ["db-pass-1234", "redis-pass-1234", "0123456789abcdef0123456789abcdef", "smtp-pass-1234", "AAAA"] {
            assert!(!printed.contains(secret), "secret {secret} leaked in: {printed}");
        }
    }
}
