#![allow(clippy::unwrap_used, clippy::expect_used)]

use backend::types::Role;
use serde_json::{Value, json};
use sqlx::{
    AssertSqlSafe, MySqlPool,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};
use uuid::Uuid;

async fn insert_user(db: &MySqlPool, email: &str, username: &str) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, email, username, date_of_birth) VALUES (?, ?, ?, '1995-05-05')",
    )
    .bind(id)
    .bind(email)
    .bind(username)
    .execute(db)
    .await?;
    Ok(id)
}

async fn insert_rule_set(
    db: &MySqlPool,
    version: i32,
    status: &str,
    config: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO rule_sets (id, version, status, config, change_note) VALUES (?, ?, ?, ?, 'test')")
        .bind(Uuid::now_v7())
        .bind(version)
        .bind(status)
        .bind(config)
        .execute(db)
        .await
        .map(|_| ())
}

async fn insert_audit(db: &MySqlPool) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO audit_log (id, action, entity_type) VALUES (?, 'TEST', 'user')")
        .bind(id)
        .execute(db)
        .await?;
    Ok(id)
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .is_some_and(|d| d.is_unique_violation())
}

#[sqlx::test]
async fn connections_run_in_utc_strict_mode_and_read_committed(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    let (zone, isolation, mode): (String, String, String) = sqlx::query_as(
        "SELECT @@session.time_zone, @@session.transaction_isolation, @@session.sql_mode",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(zone, "+00:00");
    assert_eq!(isolation, "READ-COMMITTED");
    assert!(mode.contains("STRICT_ALL_TABLES"), "{mode}");
}

#[sqlx::test]
async fn emails_and_usernames_ignore_case_but_not_accents(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    insert_user(&db, "rene@example.tn", "rene").await.unwrap();

    assert!(is_unique_violation(
        &insert_user(&db, "RENE@example.tn", "other1")
            .await
            .unwrap_err()
    ));
    assert!(is_unique_violation(
        &insert_user(&db, "other@example.tn", "RENE")
            .await
            .unwrap_err()
    ));
    // An accent makes a different person: the two accounts must never merge.
    insert_user(&db, "rené@example.tn", "other2").await.unwrap();
}

#[sqlx::test]
async fn too_long_values_are_refused_not_truncated(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    assert!(
        insert_user(&db, "long@example.tn", &"u".repeat(21))
            .await
            .is_err()
    );
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(users, 0);
}

#[sqlx::test]
async fn a_profile_cannot_point_at_a_missing_city(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    let user = insert_user(&db, "a@example.tn", "a_user").await.unwrap();
    let err = sqlx::query(
        "INSERT INTO profiles (user_id, full_name, governorate_id, city_id) VALUES (?, 'A', ?, ?)",
    )
    .bind(user)
    .bind(Uuid::now_v7())
    .bind(Uuid::now_v7())
    .execute(&db)
    .await
    .unwrap_err();
    assert!(
        err.as_database_error()
            .is_some_and(|d| d.is_foreign_key_violation()),
        "{err}"
    );
}

#[sqlx::test]
async fn only_one_rule_set_can_be_active(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let db = backend::db::pool(opts, conn);
    insert_rule_set(&db, 1, "ACTIVE", "{}").await.unwrap();
    insert_rule_set(&db, 2, "DRAFT", "{}").await.unwrap();
    insert_rule_set(&db, 3, "DRAFT", "{}").await.unwrap();
    assert!(is_unique_violation(
        &insert_rule_set(&db, 4, "ACTIVE", "{}").await.unwrap_err()
    ));

    sqlx::query("UPDATE rule_sets SET status = 'ARCHIVED' WHERE version = 1")
        .execute(&db)
        .await
        .unwrap();
    insert_rule_set(&db, 4, "ACTIVE", "{}").await.unwrap();
    assert!(
        insert_rule_set(&db, 5, "DRAFT", "not json").await.is_err(),
        "the config column must hold valid JSON"
    );
}

#[sqlx::test]
async fn the_audit_log_is_append_only(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let db = backend::db::pool(opts, conn);
    let id = insert_audit(&db).await.unwrap();

    let update = sqlx::query("UPDATE audit_log SET action = 'CHANGED' WHERE id = ?")
        .bind(id)
        .execute(&db)
        .await
        .unwrap_err();
    assert!(update.to_string().contains("append-only"), "{update}");
    let delete = sqlx::query("DELETE FROM audit_log WHERE id = ?")
        .bind(id)
        .execute(&db)
        .await
        .unwrap_err();
    assert!(delete.to_string().contains("append-only"), "{delete}");

    let action: String = sqlx::query_scalar("SELECT action FROM audit_log WHERE id = ?")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(action, "TEST");
}

/// The promise of the spec: even a compromised API cannot alter the schema or rewrite the trail.
#[sqlx::test]
async fn the_app_account_cannot_change_the_schema_or_the_audit_trail(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let admin = backend::db::pool(opts, conn.clone());
    let database: String = sqlx::query_scalar("SELECT DATABASE()")
        .fetch_one(&admin)
        .await
        .unwrap();
    let user = format!("fl_app_t_{}", &Uuid::now_v7().simple().to_string()[20..]);
    for sql in [
        format!("CREATE USER '{user}'@'%' IDENTIFIED BY 'app-test-pass'"),
        format!("GRANT SELECT, INSERT, UPDATE, DELETE ON `{database}`.* TO '{user}'@'%'"),
    ] {
        sqlx::query(AssertSqlSafe(sql))
            .execute(&admin)
            .await
            .unwrap();
    }

    let app = backend::db::pool(
        MySqlPoolOptions::new().max_connections(1),
        conn.username(&user).password("app-test-pass"),
    );
    for forbidden in [
        "CREATE TABLE intruder (id INT)",
        "ALTER TABLE users ADD COLUMN backdoor INT",
        "DROP TABLE users",
        "DROP TRIGGER audit_log_no_update",
        "TRUNCATE TABLE audit_log",
    ] {
        assert!(
            sqlx::query(forbidden).execute(&app).await.is_err(),
            "the app account ran: {forbidden}"
        );
    }

    let id = insert_audit(&app).await.unwrap();
    assert!(
        sqlx::query("UPDATE audit_log SET action = 'X' WHERE id = ?")
            .bind(id)
            .execute(&app)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM audit_log WHERE id = ?")
            .bind(id)
            .execute(&app)
            .await
            .is_err()
    );
    // Ordinary data stays writable.
    insert_user(&app, "b@example.tn", "b_user").await.unwrap();

    app.close().await;
    sqlx::query(AssertSqlSafe(format!("DROP USER '{user}'@'%'")))
        .execute(&admin)
        .await
        .unwrap();
}

#[sqlx::test]
async fn the_email_column_confuses_what_the_application_refuses(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    insert_user(&db, "ahmed@example.com", "ahmed")
        .await
        .unwrap();
    // To the unique index these are the address above: the collation ignores a soft hyphen and a
    // zero-width space, and trailing spaces do not count.
    let twins = [
        "ah\u{00AD}med@example.com",
        "ah\u{200B}med@example.com",
        "ahmed@example.com ",
    ];
    for (i, twin) in twins.iter().enumerate() {
        let err = insert_user(&db, twin, &format!("twin{i}"))
            .await
            .expect_err(twin);
        assert_eq!(
            backend::db::duplicate_key(&err),
            Some("uq_users_email"),
            "{twin:?}"
        );
        // What reaches the column went through this function first.
        assert_ne!(
            backend::validate::normalise_email(twin).as_deref(),
            Some(*twin),
            "{twin:?}"
        );
    }
    // An accent makes another letter, as the spec promises.
    insert_user(&db, "ahm\u{00E9}d@example.com", "ahmed2")
        .await
        .unwrap();
    // A second username collides on its own index.
    let err = insert_user(&db, "other@example.com", "ahmed")
        .await
        .unwrap_err();
    assert_eq!(backend::db::duplicate_key(&err), Some("uq_users_username"));
}

#[sqlx::test]
async fn a_database_error_is_described_without_its_values(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    insert_user(&db, "secret.address@example.com", "first")
        .await
        .unwrap();
    let err = insert_user(&db, "secret.address@example.com", "second")
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("secret.address"),
        "the raw message quotes the value"
    );
    let line = backend::db::describe(&err);
    assert!(
        line.contains("1062") && line.contains("uq_users_email"),
        "{line}"
    );
    assert!(!line.contains("secret.address"), "{line}");
    assert_eq!(backend::db::duplicate_key(&sqlx::Error::RowNotFound), None);
}

#[sqlx::test]
async fn an_audit_entry_records_the_actor_the_action_and_the_request(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    let user = Uuid::now_v7();
    let event = backend::audit::Event {
        actor: Some((user, Role::Admin)),
        action: "ROLE_CHANGED",
        user_id: user,
        after: Some(json!({"to": "ADMIN"})),
    };
    backend::error::REQUEST_ID
        .scope("req-42".to_owned(), backend::audit::record(&db, event))
        .await
        .unwrap();
    let (role, action, entity, after, request): (String, String, String, String, String) =
        sqlx::query_as(
            "SELECT actor_role, action, entity_type, after_json, request_id FROM audit_log WHERE entity_id = ?",
        )
        .bind(user)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(
        (
            role.as_str(),
            action.as_str(),
            entity.as_str(),
            request.as_str()
        ),
        ("ADMIN", "ROLE_CHANGED", "user", "req-42")
    );
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({"to": "ADMIN"})
    );
}
