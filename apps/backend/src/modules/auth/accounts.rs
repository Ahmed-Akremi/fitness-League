//! Accounts: who may sign in, and what the answer is when they may not.

use axum::http::StatusCode;
use chrono::NaiveDateTime;

use crate::{error::AppError, types::iso};

/// A banned account, or one suspended for now, is refused wherever it proves who it is: at sign-in,
/// at refresh, and on every request.
pub fn refuse_if_barred(
    status: &str,
    suspended_until: Option<NaiveDateTime>,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    match status {
        "BANNED" => Err(AppError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_BANNED",
            "Account banned",
        )),
        // No end date means until a moderator lifts it.
        "SUSPENDED" if suspended_until.is_none_or(|until| until > now) => Err(AppError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_SUSPENDED",
            "Account suspended",
        )
        .with("suspendedUntil", suspended_until.map(iso))),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::{Duration, Utc};

    use super::*;

    #[test]
    fn only_a_ban_or_a_running_suspension_refuses() {
        let now = Utc::now().naive_utc();
        let code = |status, until| refuse_if_barred(status, until, now).err().map(|e| e.code);
        assert_eq!(code("ACTIVE", None), None);
        assert_eq!(code("BANNED", None), Some("ACCOUNT_BANNED"));
        assert_eq!(code("SUSPENDED", None), Some("ACCOUNT_SUSPENDED"));
        assert_eq!(
            code("SUSPENDED", Some(now + Duration::minutes(1))),
            Some("ACCOUNT_SUSPENDED")
        );
        assert_eq!(code("SUSPENDED", Some(now - Duration::minutes(1))), None);
    }
}
