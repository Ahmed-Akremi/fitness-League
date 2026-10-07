//! Short-lived EdDSA access tokens, and opaque random tokens of which only the SHA-256 is stored
//! (refresh tokens, email links).

use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, errors::ErrorKind};
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{config::Config, error::AppError, types::Role};

/// App tokens and admin-panel tokens are never interchangeable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audience {
    App,
    Admin,
}

impl Audience {
    pub fn as_str(self) -> &'static str {
        match self {
            Audience::App => "app",
            Audience::Admin => "admin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccessClaims {
    pub user_id: Uuid,
    pub role: Role,
    /// Compared with `users.session_version` on every request.
    pub session_version: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenError {
    Expired,
    Invalid,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    role: Role,
    sv: i32,
    aud: String,
    iss: String,
    iat: u64,
    exp: u64,
}

pub struct Tokens {
    encoding: EncodingKey,
    signing_key_id: String,
    /// Key id → verification key. Several during a key rotation.
    decoding: HashMap<String, DecodingKey>,
    issuer: String,
    ttl_s: u64,
}

fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

impl Tokens {
    pub fn new(cfg: &Config) -> Result<Self, String> {
        let encoding = EncodingKey::from_ed_pem(cfg.jwt_private_key_pem.expose_secret().as_bytes())
            .map_err(|e| format!("JWT_PRIVATE_KEY_B64: {e}"))?;
        let signing_key_id = cfg
            .jwt_public_keys
            .first()
            .map(|(kid, _)| kid.clone())
            .ok_or("JWT_PUBLIC_KEY_B64: required")?;
        let mut decoding = HashMap::new();
        for (kid, pem) in &cfg.jwt_public_keys {
            let key = DecodingKey::from_ed_pem(pem.as_bytes())
                .map_err(|e| format!("JWT public key {kid}: {e}"))?;
            if decoding.insert(kid.clone(), key).is_some() {
                return Err(format!(
                    "JWT key id {kid} is listed twice: every key needs its own id"
                ));
            }
        }
        let tokens = Self {
            encoding,
            signing_key_id,
            decoding,
            issuer: cfg.jwt_issuer.clone(),
            ttl_s: cfg.access_token_ttl_s,
        };
        // A pair that does not match would start cleanly and then refuse every token it signs.
        let (probe, _) = tokens
            .sign_access(Uuid::nil(), Role::User, 0, Audience::App)
            .map_err(|_| "JWT_PRIVATE_KEY_B64: cannot sign with this key".to_owned())?;
        tokens.verify_access(&probe, Audience::App).map_err(|_| {
            "JWT_PUBLIC_KEY_B64 is not the public half of JWT_PRIVATE_KEY_B64".to_owned()
        })?;
        Ok(tokens)
    }

    /// Returns the token and the number of seconds until it expires.
    pub fn sign_access(
        &self,
        user_id: Uuid,
        role: Role,
        session_version: i32,
        audience: Audience,
    ) -> Result<(String, u64), AppError> {
        self.sign_at(now_s(), user_id, role, session_version, audience)
    }

    fn sign_at(
        &self,
        issued_at: u64,
        user_id: Uuid,
        role: Role,
        session_version: i32,
        audience: Audience,
    ) -> Result<(String, u64), AppError> {
        let mut header = Header::new(Algorithm::EdDSA);
        header.kid = Some(self.signing_key_id.clone());
        let claims = Claims {
            sub: user_id.to_string(),
            role,
            sv: session_version,
            aud: audience.as_str().to_owned(),
            iss: self.issuer.clone(),
            iat: issued_at,
            exp: issued_at + self.ttl_s,
        };
        let token =
            jsonwebtoken::encode(&header, &claims, &self.encoding).map_err(AppError::internal)?;
        Ok((token, self.ttl_s))
    }

    /// The algorithm, issuer and audience are pinned; the key is chosen by the key id of the header.
    pub fn verify_access(
        &self,
        token: &str,
        audience: Audience,
    ) -> Result<AccessClaims, TokenError> {
        let header = jsonwebtoken::decode_header(token).map_err(|_| TokenError::Invalid)?;
        let key = header
            .kid
            .as_deref()
            .and_then(|kid| self.decoding.get(kid))
            .ok_or(TokenError::Invalid)?;
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_audience(&[audience.as_str()]);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
        validation.leeway = 0;
        let data = jsonwebtoken::decode::<Claims>(token, key, &validation).map_err(|e| match e
            .kind()
        {
            ErrorKind::ExpiredSignature => TokenError::Expired,
            _ => TokenError::Invalid,
        })?;
        let user_id = Uuid::parse_str(&data.claims.sub).map_err(|_| TokenError::Invalid)?;
        Ok(AccessClaims {
            user_id,
            role: data.claims.role,
            session_version: data.claims.sv,
        })
    }
}

/// A fresh 256-bit token from the operating system's generator, and the hash to store.
pub fn new_opaque() -> Result<(String, [u8; 32]), AppError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(AppError::internal)?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let hash = hash_opaque(&token);
    Ok((token, hash))
}

pub fn hash_opaque(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use std::collections::HashMap;

    use base64::engine::general_purpose::STANDARD;

    use super::*;
    use crate::devkeys;

    fn config(private: &str, public: &str, extra: &str) -> Config {
        let vars: HashMap<String, String> = [
            ("APP_ENV", "test"),
            ("DATABASE_URL", "mysql://unused"),
            ("REDIS_URL", "redis://unused"),
            ("JWT_PRIVATE_KEY_B64", private),
            ("JWT_PUBLIC_KEY_B64", public),
            ("JWT_EXTRA_PUBLIC_KEYS", extra),
            ("APP_HMAC_SECRET", "0123456789abcdef0123456789abcdef"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
        Config::from_map(&vars).unwrap()
    }

    fn tokens() -> Tokens {
        let (private, public) = devkeys::generate().unwrap();
        Tokens::new(&config(&private, &public, "")).unwrap()
    }

    fn user() -> Uuid {
        Uuid::now_v7()
    }

    #[test]
    fn a_signed_token_verifies_with_its_claims() {
        let (tokens, id) = (tokens(), user());
        let (token, expires_in) = tokens
            .sign_access(id, Role::GymAdmin, 3, Audience::App)
            .unwrap();
        assert_eq!(expires_in, 900);
        assert_eq!(
            tokens.verify_access(&token, Audience::App),
            Ok(AccessClaims {
                user_id: id,
                role: Role::GymAdmin,
                session_version: 3
            })
        );
    }

    #[test]
    fn an_app_token_is_refused_by_the_admin_audience_and_the_reverse() {
        let tokens = tokens();
        let (app, _) = tokens
            .sign_access(user(), Role::Admin, 1, Audience::App)
            .unwrap();
        let (admin, _) = tokens
            .sign_access(user(), Role::Admin, 1, Audience::Admin)
            .unwrap();
        assert_eq!(
            tokens.verify_access(&app, Audience::Admin),
            Err(TokenError::Invalid)
        );
        assert_eq!(
            tokens.verify_access(&admin, Audience::App),
            Err(TokenError::Invalid)
        );
    }

    #[test]
    fn an_expired_token_is_reported_as_expired() {
        let tokens = tokens();
        let (old, _) = tokens
            .sign_at(now_s() - 901, user(), Role::User, 1, Audience::App)
            .unwrap();
        assert_eq!(
            tokens.verify_access(&old, Audience::App),
            Err(TokenError::Expired)
        );
        let (fresh, _) = tokens
            .sign_at(now_s() - 890, user(), Role::User, 1, Audience::App)
            .unwrap();
        assert!(tokens.verify_access(&fresh, Audience::App).is_ok());
    }

    #[test]
    fn a_tampered_or_foreign_token_is_invalid() {
        let tokens = tokens();
        let (token, _) = tokens
            .sign_access(user(), Role::User, 1, Audience::App)
            .unwrap();

        // Swap the payload for one claiming another role, keeping the signature.
        let parts: Vec<&str> = token.split('.').collect();
        let forged_payload = URL_SAFE_NO_PAD.encode(
            String::from_utf8(URL_SAFE_NO_PAD.decode(parts[1]).unwrap())
                .unwrap()
                .replace("\"USER\"", "\"SUPER_ADMIN\""),
        );
        assert_eq!(
            tokens.verify_access(
                &format!("{}.{forged_payload}.{}", parts[0], parts[2]),
                Audience::App
            ),
            Err(TokenError::Invalid)
        );

        // Signed by somebody else's key, with our key id.
        let (foreign, _) = self::tokens()
            .sign_access(user(), Role::User, 1, Audience::App)
            .unwrap();
        assert_eq!(
            tokens.verify_access(&foreign, Audience::App),
            Err(TokenError::Invalid)
        );

        for garbage in ["", "abc", "a.b.c", "..", &token[..token.len() - 2]] {
            assert_eq!(
                tokens.verify_access(garbage, Audience::App),
                Err(TokenError::Invalid),
                "{garbage:?}"
            );
        }
    }

    #[test]
    fn only_eddsa_is_accepted() {
        let (private, public) = devkeys::generate().unwrap();
        let tokens = Tokens::new(&config(&private, &public, "")).unwrap();
        let claims = Claims {
            sub: user().to_string(),
            role: Role::SuperAdmin,
            sv: 1,
            aud: "app".into(),
            iss: "fitness-league".into(),
            iat: now_s(),
            exp: now_s() + 600,
        };

        // "alg: none": no signature at all.
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT","kid":"k1"}"#);
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_string(&claims).unwrap());
        assert_eq!(
            tokens.verify_access(&format!("{header}.{payload}."), Audience::App),
            Err(TokenError::Invalid)
        );

        // Algorithm confusion: HS256 keyed with our public key, which an attacker can know.
        let public_pem = STANDARD.decode(public).unwrap();
        let mut hs256 = Header::new(Algorithm::HS256);
        hs256.kid = Some("k1".into());
        let confused =
            jsonwebtoken::encode(&hs256, &claims, &EncodingKey::from_secret(&public_pem)).unwrap();
        assert_eq!(
            tokens.verify_access(&confused, Audience::App),
            Err(TokenError::Invalid)
        );
    }

    #[test]
    fn a_rotated_out_key_still_verifies_while_it_is_listed() {
        let (old_private, old_public) = devkeys::generate().unwrap();
        let (new_private, new_public) = devkeys::generate().unwrap();
        let before = Tokens::new(&config(&old_private, &old_public, "")).unwrap();
        let (token, _) = before
            .sign_access(user(), Role::User, 1, Audience::App)
            .unwrap();

        // After the rotation the new key signs as `k2`; the old key stays listed as `k1` until its tokens expire.
        let mut rotated = config(&new_private, &new_public, "");
        rotated.jwt_public_keys = vec![
            ("k2".into(), rotated.jwt_public_keys[0].1.clone()),
            (
                "k1".into(),
                String::from_utf8(STANDARD.decode(&old_public).unwrap()).unwrap(),
            ),
        ];
        let after = Tokens::new(&rotated).unwrap();
        assert!(
            after.verify_access(&token, Audience::App).is_ok(),
            "a token of the old key is still accepted"
        );
        let (fresh, _) = after
            .sign_access(user(), Role::User, 1, Audience::App)
            .unwrap();
        assert!(after.verify_access(&fresh, Audience::App).is_ok());
        assert_eq!(
            before.verify_access(&fresh, Audience::App),
            Err(TokenError::Invalid),
            "a key id nobody listed is refused"
        );
    }

    #[test]
    fn opaque_tokens_are_random_and_stored_as_a_hash() {
        let (a, hash_a) = new_opaque().unwrap();
        let (b, _) = new_opaque().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43, "32 random bytes in unpadded base64url");
        assert_eq!(hash_opaque(&a), hash_a);
        assert_ne!(hash_opaque(&a), hash_opaque(&b));
    }

    #[test]
    fn a_key_pair_that_does_not_match_is_refused_at_start() {
        let (private, _) = devkeys::generate().unwrap();
        let (_, other_public) = devkeys::generate().unwrap();
        let err = Tokens::new(&config(&private, &other_public, ""))
            .err()
            .unwrap();
        assert!(err.contains("not the public half"), "{err}");
    }

    #[test]
    fn two_keys_with_the_same_id_are_refused_at_start() {
        let (private, public) = devkeys::generate().unwrap();
        let (_, retired) = devkeys::generate().unwrap();
        // The retired key was given the id of the signing key: it would take its place.
        let err = Tokens::new(&config(&private, &public, &format!("k1:{retired}")))
            .err()
            .unwrap();
        assert!(err.contains("listed twice"), "{err}");
    }
}
