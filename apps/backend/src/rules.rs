//! The active rule set: the numbers the product owner can change without a release.

use serde::Deserialize;
use sqlx::MySqlPool;

use crate::error::AppError;

#[derive(Deserialize)]
pub struct LevelTitle {
    #[serde(rename = "fromLevel")]
    pub from_level: i32,
    pub key: String,
}

/// Only the fields this part reads. The configuration holds many more.
#[derive(Deserialize)]
pub struct Rules {
    pub min_age_years: i32,
    pub level_titles: Vec<LevelTitle>,
}

impl Rules {
    // ponytail: read from the database on every call (one indexed row). Cache it in the process
    // when a profile shows it, and refresh the cache when a rule set is activated.
    pub async fn active(db: &MySqlPool) -> Result<Self, AppError> {
        let config = sqlx::query_scalar!("SELECT config FROM rule_sets WHERE status = 'ACTIVE'")
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::internal("no active rule set: run `backend seed`"))?;
        serde_json::from_str(&config)
            .map_err(|e| AppError::internal(format!("active rule set: {e}")))
    }

    /// The translation key of the title held at `level`: the last one whose first level is reached.
    pub fn level_title_key(&self, level: i32) -> &str {
        self.level_titles
            .iter()
            .rfind(|title| level >= title.from_level)
            .or(self.level_titles.first())
            .map_or("", |title| title.key.as_str())
    }
}
