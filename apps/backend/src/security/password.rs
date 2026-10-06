//! Argon2id password hashing and the password policy.

use std::sync::Arc;

use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use tokio::sync::Semaphore;

use crate::error::AppError;

pub const MIN_LENGTH: usize = 10;
pub const MAX_LENGTH: usize = 128;

/// The 100,000 most common passwords (SecLists, MIT licence), lower-cased, 10 characters or more.
static COMMON: &str = include_str!("../../assets/common-passwords.txt");

const DUMMY_PASSWORD: &str = "fitness-league-timing-equaliser";

pub struct Passwords {
    argon: Argon2<'static>,
    /// Each hash takes 19 MiB and a core for tens of milliseconds: cap how many run at once, so a burst
    /// of logins cannot exhaust memory.
    slots: Semaphore,
    /// Verified when the account does not exist, so the response time does not reveal which emails do.
    dummy_hash: String,
}

impl Passwords {
    pub fn new() -> Result<Self, String> {
        // OWASP minimum for Argon2id: 19 MiB, 2 passes, 1 lane.
        let params = Params::new(19_456, 2, 1, None).map_err(|e| e.to_string())?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let dummy_hash = argon.hash_password(DUMMY_PASSWORD.as_bytes()).map_err(|e| e.to_string())?.to_string();
        let slots = std::thread::available_parallelism().map_or(2, |n| n.get());
        Ok(Self { argon, slots: Semaphore::new(slots), dummy_hash })
    }

    pub async fn hash(self: &Arc<Self>, password: String) -> Result<String, AppError> {
        let _slot = self.slots.acquire().await.map_err(AppError::internal)?;
        let this = Arc::clone(self);
        tokio::task::spawn_blocking(move || this.argon.hash_password(password.as_bytes()).map(|hash| hash.to_string()))
            .await
            .map_err(AppError::internal)?
            .map_err(AppError::internal)
    }

    /// `stored = None` (no such account) costs one full verification and always answers `false`.
    pub async fn verify(self: &Arc<Self>, stored: Option<String>, password: String) -> bool {
        let Ok(_slot) = self.slots.acquire().await else { return false };
        let this = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let known = stored.is_some();
            let phc = stored.unwrap_or_else(|| this.dummy_hash.clone());
            let matches = PasswordHash::new(&phc).is_ok_and(|parsed| this.argon.verify_password(password.as_bytes(), &parsed).is_ok());
            matches && known
        })
        .await
        .unwrap_or(false)
    }
}

/// Why a new password is refused, as a field code, or `None` when it is acceptable.
/// Length is what matters (NIST 800-63B): there are no composition rules.
pub fn password_problem(password: &str, email: &str, username: &str) -> Option<&'static str> {
    let length = password.chars().count();
    if length < MIN_LENGTH {
        return Some("MINLENGTH");
    }
    if length > MAX_LENGTH {
        return Some("MAXLENGTH");
    }
    let lower = password.to_lowercase();
    if lower == email.to_lowercase() || lower == username.to_lowercase() || COMMON.lines().any(|line| line == lower) {
        return Some("TOO_COMMON");
    }
    None
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[tokio::test]
    async fn a_hash_verifies_only_its_own_password() {
        let passwords = Arc::new(Passwords::new().unwrap());
        let hash = passwords.hash("correct horse battery".into()).await.unwrap();
        assert!(hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{hash}");
        assert!(passwords.verify(Some(hash.clone()), "correct horse battery".into()).await);
        assert!(!passwords.verify(Some(hash), "correct horse batterz".into()).await);
    }

    #[tokio::test]
    async fn two_hashes_of_one_password_differ() {
        let passwords = Arc::new(Passwords::new().unwrap());
        assert_ne!(passwords.hash("same password 123".into()).await.unwrap(), passwords.hash("same password 123".into()).await.unwrap());
    }

    #[tokio::test]
    async fn an_unknown_account_or_a_corrupt_hash_never_verifies() {
        let passwords = Arc::new(Passwords::new().unwrap());
        // No stored hash: the dummy hash is checked instead, and the answer is always no,
        // even for the password the dummy hash was made from.
        assert!(!passwords.verify(None, "anything at all".into()).await);
        assert!(!passwords.verify(None, DUMMY_PASSWORD.into()).await);
        assert!(!passwords.verify(Some("not-a-phc-string".into()), "anything at all".into()).await);
        assert!(!passwords.verify(Some(String::new()), String::new()).await);
    }

    #[test]
    fn the_policy_is_length_then_the_common_list() {
        let ok = |p: &str| password_problem(p, "ahmed@example.tn", "ahmed_fit");
        assert_eq!(ok("123456789"), Some("MINLENGTH"));
        assert_eq!(ok(&"x".repeat(129)), Some("MAXLENGTH"));
        assert_eq!(ok(&"x7#".repeat(42)), None, "126 characters is allowed");
        assert_eq!(ok("1234567890"), Some("TOO_COMMON"));
        assert_eq!(ok("QwErTyUiOp"), Some("TOO_COMMON"), "the list is matched without regard to case");
        assert_eq!(ok("Ahmed@Example.tn"), Some("TOO_COMMON"), "the email is not a password");
        assert_eq!(password_problem("ahmed_fit_", "a@b.tn", "ahmed_fit_"), Some("TOO_COMMON"), "nor is the username");
        assert_eq!(ok("river-stone-42-kite"), None);
    }

    #[test]
    fn length_is_counted_in_characters() {
        // Ten Arabic letters are twenty bytes but ten characters: long enough.
        assert_eq!(password_problem(&"ب".repeat(10), "a@b.tn", "ahmed"), None);
        assert_eq!(password_problem(&"ب".repeat(9), "a@b.tn", "ahmed"), Some("MINLENGTH"));
    }
}
