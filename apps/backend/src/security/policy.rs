//! Pure rules of the account flows. No I/O, so each is tested directly.

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};

pub const MAX_FAILED_LOGINS: u32 = 5;
const BASE_LOCK_MINUTES: u32 = 15;
const MAX_LOCK_MINUTES: u32 = 24 * 60;

/// Every fifth consecutive failure locks the account: 15 minutes, then 30, 60… capped at 24 hours.
/// `None` when this failure does not trigger a lock.
pub fn lock_minutes(failed_count: u32) -> Option<u32> {
    if failed_count < MAX_FAILED_LOGINS || failed_count % MAX_FAILED_LOGINS != 0 {
        return None;
    }
    let doublings = failed_count / MAX_FAILED_LOGINS - 1;
    let minutes = 2u32.checked_pow(doublings).and_then(|factor| BASE_LOCK_MINUTES.checked_mul(factor));
    Some(minutes.map_or(MAX_LOCK_MINUTES, |m| m.min(MAX_LOCK_MINUTES)))
}

/// Completed years on `today`.
pub fn age_in_years(date_of_birth: NaiveDate, today: NaiveDate) -> i32 {
    let had_birthday = (today.month(), today.day()) >= (date_of_birth.month(), date_of_birth.day());
    today.year() - date_of_birth.year() - i32::from(!had_birthday)
}

/// The only form in which an age ever leaves the API. The date of birth itself is never returned.
pub fn age_bracket(age: i32) -> Option<&'static str> {
    match age {
        i32::MIN..=17 => None,
        18..=24 => Some("18-24"),
        25..=34 => Some("25-34"),
        _ => Some("35+"),
    }
}

/// The calendar day in the business time zone (Tunisia is UTC+1, with no daylight saving).
pub fn business_today(now: DateTime<Utc>, utc_offset_minutes: i32) -> NaiveDate {
    (now + Duration::minutes(i64::from(utc_offset_minutes))).date_naive()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::TimeZone;

    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn every_fifth_failure_locks_and_the_lock_doubles() {
        assert_eq!([1, 4, 6, 9, 11].map(lock_minutes), [None; 5]);
        assert_eq!([5, 10, 15, 20].map(lock_minutes), [Some(15), Some(30), Some(60), Some(120)]);
    }

    #[test]
    fn the_lock_is_capped_at_a_day_however_absurd_the_count() {
        assert_eq!(lock_minutes(35), Some(960));
        assert_eq!(lock_minutes(40), Some(1440));
        assert_eq!(lock_minutes(500), Some(1440));
        assert_eq!(lock_minutes(u32::MAX - u32::MAX % 5), Some(1440));
    }

    #[test]
    fn age_counts_completed_years() {
        let born = date(2008, 10, 7);
        assert_eq!(age_in_years(born, date(2026, 10, 6)), 17);
        assert_eq!(age_in_years(born, date(2026, 10, 7)), 18);
        // Born on 29 February: the birthday falls on 1 March in a common year.
        assert_eq!(age_in_years(date(2008, 2, 29), date(2026, 2, 28)), 17);
        assert_eq!(age_in_years(date(2008, 2, 29), date(2026, 3, 1)), 18);
    }

    #[test]
    fn brackets_never_reveal_a_minor_or_an_exact_age() {
        assert_eq!([17, 18, 24, 25, 34, 35, 80].map(age_bracket), [None, Some("18-24"), Some("18-24"), Some("25-34"), Some("25-34"), Some("35+"), Some("35+")]);
    }

    #[test]
    fn the_business_day_follows_the_configured_offset() {
        let late = Utc.with_ymd_and_hms(2026, 10, 6, 23, 30, 0).unwrap();
        assert_eq!(business_today(late, 60), date(2026, 10, 7));
        assert_eq!(business_today(late, 0), date(2026, 10, 6));
        assert_eq!(business_today(late, -720), date(2026, 10, 6));
    }
}
