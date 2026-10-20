//! Pure rules of the account flows. No I/O, so each is tested directly.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};

pub const MAX_FAILED_LOGINS: u32 = 5;
const BASE_LOCK_MINUTES: u32 = 15;
const MAX_LOCK_MINUTES: u32 = 24 * 60;

/// Every fifth consecutive failure locks the account: 15 minutes, then 30, 60… capped at 24 hours.
/// `None` when this failure does not trigger a lock.
pub fn lock_minutes(failed_count: u32) -> Option<u32> {
    if failed_count < MAX_FAILED_LOGINS || !failed_count.is_multiple_of(MAX_FAILED_LOGINS) {
        return None;
    }
    let doublings = failed_count / MAX_FAILED_LOGINS - 1;
    let minutes = 2u32
        .checked_pow(doublings)
        .and_then(|factor| BASE_LOCK_MINUTES.checked_mul(factor));
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

/// The instant the business week holding `at` began: Monday 00:00 local, written in UTC.
pub fn week_start(at: DateTime<Utc>, utc_offset_minutes: i32) -> DateTime<Utc> {
    let day = business_day_start(at, utc_offset_minutes);
    let since_monday = business_today(at, utc_offset_minutes)
        .weekday()
        .num_days_from_monday();
    day - Duration::days(i64::from(since_monday))
}

/// The first instants of the calendar quarter holding `at` and of the next one, in business time:
/// a season's bounds.
pub fn quarter_bounds(
    at: DateTime<Utc>,
    utc_offset_minutes: i32,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let today = business_today(at, utc_offset_minutes);
    let first = today.month0() / 3 * 3 + 1;
    let start = NaiveDate::from_ymd_opt(today.year(), first, 1);
    let end = if first == 10 {
        NaiveDate::from_ymd_opt(today.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(today.year(), first + 3, 1)
    };
    let at_midnight = |date: Option<NaiveDate>| {
        date.unwrap_or(today).and_time(NaiveTime::MIN).and_utc()
            - Duration::minutes(i64::from(utc_offset_minutes))
    };
    (at_midnight(start), at_midnight(end))
}

/// The instant the business day holding `at` began: local midnight, written in UTC.
pub fn business_day_start(at: DateTime<Utc>, utc_offset_minutes: i32) -> DateTime<Utc> {
    let offset = Duration::minutes(i64::from(utc_offset_minutes));
    business_today(at, utc_offset_minutes)
        .and_time(NaiveTime::MIN)
        .and_utc()
        - offset
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
    fn weeks_and_quarters() {
        let at = |m, d, h, min| Utc.with_ymd_and_hms(2026, m, d, h, min, 0).unwrap();
        // Monday 2026-10-19 00:00 in Tunis is 2026-10-18 23:00Z.
        assert_eq!(week_start(at(10, 20, 10, 0), 60), at(10, 18, 23, 0));
        assert_eq!(week_start(at(10, 18, 23, 30), 60), at(10, 18, 23, 0));
        assert_eq!(week_start(at(10, 18, 22, 30), 60), at(10, 11, 23, 0));
        assert_eq!(
            quarter_bounds(at(10, 20, 10, 0), 60),
            (at(9, 30, 23, 0), at(12, 31, 23, 0))
        );
    }

    #[test]
    fn every_fifth_failure_locks_and_the_lock_doubles() {
        assert_eq!([1, 4, 6, 9, 11].map(lock_minutes), [None; 5]);
        assert_eq!(
            [5, 10, 15, 20].map(lock_minutes),
            [Some(15), Some(30), Some(60), Some(120)]
        );
    }

    #[test]
    fn the_lock_is_capped_at_a_day_however_absurd_the_count() {
        assert_eq!(lock_minutes(35), Some(960));
        assert_eq!(lock_minutes(40), Some(1440));
        assert_eq!(lock_minutes(500), Some(1440));
        assert_eq!(lock_minutes(u32::MAX), Some(1440));
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
        assert_eq!(
            [17, 18, 24, 25, 34, 35, 80].map(age_bracket),
            [
                None,
                Some("18-24"),
                Some("18-24"),
                Some("25-34"),
                Some("25-34"),
                Some("35+"),
                Some("35+")
            ]
        );
    }

    #[test]
    fn the_business_day_follows_the_configured_offset() {
        let late = Utc.with_ymd_and_hms(2026, 10, 6, 23, 30, 0).unwrap();
        assert_eq!(business_today(late, 60), date(2026, 10, 7));
        assert_eq!(business_today(late, 0), date(2026, 10, 6));
        assert_eq!(business_today(late, -720), date(2026, 10, 6));
    }

    #[test]
    fn the_business_day_starts_at_local_midnight() {
        let utc = |d, h, m| Utc.with_ymd_and_hms(2026, 10, d, h, m, 0).unwrap();
        // 23:30 UTC is already 00:30 the next day in Tunis.
        assert_eq!(business_day_start(utc(18, 23, 30), 60), utc(18, 23, 0));
        assert_eq!(business_day_start(utc(18, 22, 30), 60), utc(17, 23, 0));
        assert_eq!(business_day_start(utc(18, 12, 0), 0), utc(18, 0, 0));
    }
}
