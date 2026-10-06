//! Loads the reference catalog and the first rule set from `infra/seed-data`.
//! Every statement is an upsert keyed by a stable code, so running it again changes nothing, and
//! running it after a failure finishes the job.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use sqlx::MySqlPool;
use uuid::Uuid;

#[derive(Deserialize)]
struct I18n {
    fr: String,
    en: String,
    ar: String,
}

#[derive(Deserialize)]
struct Tunisia {
    country: Country,
    governorates: Vec<Governorate>,
}

#[derive(Deserialize)]
struct Country {
    code: String,
    name: I18n,
}

#[derive(Deserialize)]
struct Governorate {
    code: String,
    name: I18n,
    /// `[French name, Arabic name]`.
    cities: Vec<(String, String)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    metric_types: Vec<MetricType>,
    sports: Vec<Sport>,
    exercises: Vec<Exercise>,
}

#[derive(Deserialize)]
struct MetricType {
    code: String,
    unit: String,
    direction: String,
    name: I18n,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sport {
    code: String,
    category: String,
    logging_mode: String,
    icon: Option<String>,
    name: I18n,
}

#[derive(Deserialize)]
struct Exercise {
    code: String,
    /// A sport code, or `null` for an exercise shared by every strength and functional sport.
    sport: Option<String>,
    equipment: Option<String>,
    bodyweight: bool,
    metrics: Vec<String>,
    plausibility: Value,
    name: I18n,
    group: Option<String>,
    description: Option<I18n>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleSetFile {
    version: i32,
    change_note: String,
    config: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Summary {
    pub governorates: usize,
    pub cities: usize,
    pub sports: usize,
    pub metric_types: usize,
    pub exercises: usize,
}

pub async fn run(db: &MySqlPool, dir: &Path) -> Result<Summary, String> {
    let tunisia: Tunisia = read(dir, "tunisia.json")?;
    let catalog: Catalog = read(dir, "catalog.json")?;
    let rules: RuleSetFile = read(dir, "ruleset-v2.json")?;

    // Check the cross-references before writing anything.
    let sports: HashSet<&str> = catalog.sports.iter().map(|s| s.code.as_str()).collect();
    let metrics: HashSet<&str> = catalog.metric_types.iter().map(|m| m.code.as_str()).collect();
    for exercise in &catalog.exercises {
        if let Some(sport) = exercise.sport.as_deref().filter(|code| !sports.contains(code)) {
            return Err(format!("catalog.json: exercise {} names the unknown sport {sport}", exercise.code));
        }
        if let Some(metric) = exercise.metrics.iter().find(|code| !metrics.contains(code.as_str())) {
            return Err(format!("catalog.json: exercise {} names the unknown metric {metric}", exercise.code));
        }
    }

    write(db, &tunisia, &catalog, &rules).await.map_err(|e| format!("seed failed: {e}"))
}

fn read<T: DeserializeOwned>(dir: &Path, name: &str) -> Result<T, String> {
    let path = dir.join(name);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Lower-case ASCII with dashes, as used in city codes (`TN-32-ain-draham`).
pub fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.to_lowercase().chars() {
        let mapped = match c {
            'à' | 'â' | 'ä' => 'a',
            'ç' => 'c',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        // One dash between words, none at the start.
        if mapped == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(mapped);
    }
    out.trim_end_matches('-').to_owned()
}

async fn write(db: &MySqlPool, tunisia: &Tunisia, catalog: &Catalog, rules: &RuleSetFile) -> Result<Summary, sqlx::Error> {
    let country = &tunisia.country;
    sqlx::query!(
        "INSERT INTO countries (code, name_fr, name_en, name_ar) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name_fr = VALUES(name_fr), name_en = VALUES(name_en), name_ar = VALUES(name_ar)",
        country.code,
        country.name.fr,
        country.name.en,
        country.name.ar
    )
    .execute(db)
    .await?;

    let mut cities = 0;
    for g in &tunisia.governorates {
        // On a second run the new id is discarded: the row found by its unique code keeps its own.
        sqlx::query!(
            "INSERT INTO governorates (id, country_code, code, name_fr, name_en, name_ar) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name_fr = VALUES(name_fr), name_en = VALUES(name_en), name_ar = VALUES(name_ar)",
            Uuid::now_v7(),
            country.code,
            g.code,
            g.name.fr,
            g.name.en,
            g.name.ar
        )
        .execute(db)
        .await?;
        let governorate_id = sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM governorates WHERE code = ?"#, g.code).fetch_one(db).await?;

        for (french, arabic) in &g.cities {
            // The seed file gives a French and an Arabic name; English uses the French spelling.
            sqlx::query!(
                "INSERT INTO cities (id, governorate_id, code, name_fr, name_en, name_ar) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name_fr = VALUES(name_fr), name_en = VALUES(name_en), name_ar = VALUES(name_ar)",
                Uuid::now_v7(),
                governorate_id,
                format!("{}-{}", g.code, slugify(french)),
                french,
                french,
                arabic
            )
            .execute(db)
            .await?;
            cities += 1;
        }
    }

    let mut metric_ids = HashMap::new();
    for m in &catalog.metric_types {
        sqlx::query!(
            "INSERT INTO metric_types (id, code, unit, direction, name_fr, name_en, name_ar) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE unit = VALUES(unit), direction = VALUES(direction),
                 name_fr = VALUES(name_fr), name_en = VALUES(name_en), name_ar = VALUES(name_ar)",
            Uuid::now_v7(),
            m.code,
            m.unit,
            m.direction,
            m.name.fr,
            m.name.en,
            m.name.ar
        )
        .execute(db)
        .await?;
        let id = sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM metric_types WHERE code = ?"#, m.code).fetch_one(db).await?;
        metric_ids.insert(m.code.as_str(), id);
    }

    let mut sport_ids = HashMap::new();
    for s in &catalog.sports {
        sqlx::query!(
            "INSERT INTO sports (id, code, category, logging_mode, icon, name_fr, name_en, name_ar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE category = VALUES(category), logging_mode = VALUES(logging_mode), icon = VALUES(icon),
                 name_fr = VALUES(name_fr), name_en = VALUES(name_en), name_ar = VALUES(name_ar)",
            Uuid::now_v7(),
            s.code,
            s.category,
            s.logging_mode,
            s.icon,
            s.name.fr,
            s.name.en,
            s.name.ar
        )
        .execute(db)
        .await?;
        let id = sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM sports WHERE code = ?"#, s.code).fetch_one(db).await?;
        sport_ids.insert(s.code.as_str(), id);
    }

    for x in &catalog.exercises {
        let sport_id = x.sport.as_deref().and_then(|code| sport_ids.get(code)).copied();
        let (description_fr, description_en, description_ar) = match &x.description {
            Some(d) => (Some(d.fr.as_str()), Some(d.en.as_str()), Some(d.ar.as_str())),
            None => (None, None, None),
        };
        // Unchanged values leave `updated_at` alone, so a delta sync only sees real changes.
        sqlx::query!(
            "INSERT INTO exercises (id, sport_id, code, name_fr, name_en, name_ar, equipment, is_bodyweight, exercise_group,
                                    description_fr, description_en, description_ar, plausibility)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE sport_id = VALUES(sport_id), name_fr = VALUES(name_fr), name_en = VALUES(name_en),
                 name_ar = VALUES(name_ar), equipment = VALUES(equipment), is_bodyweight = VALUES(is_bodyweight),
                 exercise_group = VALUES(exercise_group), description_fr = VALUES(description_fr),
                 description_en = VALUES(description_en), description_ar = VALUES(description_ar),
                 plausibility = VALUES(plausibility)",
            Uuid::now_v7(),
            sport_id,
            x.code,
            x.name.fr,
            x.name.en,
            x.name.ar,
            x.equipment,
            x.bodyweight,
            x.group,
            description_fr,
            description_en,
            description_ar,
            x.plausibility.to_string()
        )
        .execute(db)
        .await?;
        let exercise_id = sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM exercises WHERE code = ?"#, x.code).fetch_one(db).await?;

        sqlx::query!("DELETE FROM exercise_metrics WHERE exercise_id = ?", exercise_id).execute(db).await?;
        for (position, code) in x.metrics.iter().enumerate() {
            // Every code was checked in `run`, so the lookup always succeeds.
            let Some(metric_id) = metric_ids.get(code.as_str()) else { continue };
            sqlx::query!(
                "INSERT INTO exercise_metrics (exercise_id, metric_type_id, position) VALUES (?, ?, ?)",
                exercise_id,
                metric_id,
                position as i16
            )
            .execute(db)
            .await?;
        }
    }

    // The first rule set only. Later versions are drafted and activated from the admin panel.
    let existing = sqlx::query_scalar!("SELECT COUNT(*) FROM rule_sets").fetch_one(db).await?;
    if existing == 0 {
        sqlx::query!(
            "INSERT INTO rule_sets (id, version, status, config, change_note, activated_at) VALUES (?, ?, 'ACTIVE', ?, ?, UTC_TIMESTAMP(6))",
            Uuid::now_v7(),
            rules.version,
            rules.config.to_string(),
            rules.change_note
        )
        .execute(db)
        .await?;
    }

    Ok(Summary {
        governorates: tunisia.governorates.len(),
        cities,
        sports: catalog.sports.len(),
        metric_types: catalog.metric_types.len(),
        exercises: catalog.exercises.len(),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn city_names_become_stable_ascii_codes() {
        assert_eq!(slugify("La Goulette"), "la-goulette");
        assert_eq!(slugify("Aïn Draham"), "ain-draham");
        assert_eq!(slugify("Béja"), "beja");
        assert_eq!(slugify("Gaâfour"), "gaafour");
        assert_eq!(slugify("Medjez el-Bab"), "medjez-el-bab");
        assert_eq!(slugify("  Sidi  Bou Saïd! "), "sidi-bou-said");
        // A letter outside the known set separates rather than disappearing silently.
        assert_eq!(slugify("Añb"), "a-b");
    }
}
