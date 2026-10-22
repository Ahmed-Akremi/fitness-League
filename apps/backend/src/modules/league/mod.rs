//! The league (docs §5.5, §5.10): the weekly score, League Points, seasons and leaderboards.

pub mod boards;
pub mod engine;
pub mod jobs;
pub mod seasons;
pub mod weekly;

use crate::http::Api;

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me/weekly-scores/current", weekly::current)
        .get("/api/v1/me/lp", seasons::my_lp)
        .get("/api/v1/me/ranks", boards::my_ranks)
        .get("/api/v1/leaderboards/national", boards::national)
        .get("/api/v1/leaderboards/national/me", boards::national_me)
        .get(
            "/api/v1/leaderboards/governorates/{id}",
            boards::governorate,
        )
        .get(
            "/api/v1/leaderboards/governorates/{id}/me",
            boards::governorate_me,
        )
        .get("/api/v1/leaderboards/friends", boards::friends)
        .get("/api/v1/leaderboards/friends/me", boards::friends_me)
        .get("/api/v1/leaderboards/gyms/{id}", boards::gym)
        .get("/api/v1/leaderboards/gyms/{id}/me", boards::gym_me)
}
