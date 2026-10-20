//! The league (docs §5.5, §5.10): the weekly score, League Points, seasons and leaderboards.

pub mod engine;
pub mod seasons;
pub mod weekly;

use crate::http::Api;

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me/weekly-scores/current", weekly::current)
}
