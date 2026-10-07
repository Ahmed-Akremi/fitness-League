# Rust Backend Part 1b — Accounts and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can register against the Rust API, receive the verification email, sign in, keep a session alive, reset a forgotten password and read their profile; a staff or judge account can sign in to the admin panel.

**Architecture:** Plan 1a left a running API with no accounts. This plan adds a job queue on a Redis Stream with a `backend worker` process that sends the emails, the two extractors through which a handler obtains the signed-in user (`AppUser`, `PanelUser`), and the modules `auth`, `admin_auth` and `me`. Sessions are a short Ed25519 access token plus a single-use refresh token stored as a hash; every refresh rotates it and reuse revokes its whole family.

**Tech Stack:** as plan 1a (Rust 1.99, Axum 0.8, sqlx 0.9 on MariaDB 11.4, redis 1, argon2 0.6, jsonwebtoken 11), plus `lettre` 0.11 (SMTP over rustls) and `unicode-normalization` 0.1.

**Spec:** `docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`

**Scope note:** part 1 of the spec is delivered by three plans. 1a (foundation) is built. This one (1b) covers the 14 account and session endpoints and `GET /me`. Plan 1c covers what is left of part 1: `PATCH /me/profile`, `PATCH /me/settings`, the three onboarding endpoints, `GET /me/export`, `DELETE /me` with the daily sweep, and the contract checks of those routes. The split keeps each plan small enough to review; nothing in 1c is needed for the flows of this plan.

| Endpoint | Task |
|---|---|
| `POST /auth/refresh`, `POST /auth/logout` | 4 |
| `POST /auth/register` | 5 |
| `POST /auth/login` | 6 |
| `POST /auth/email/verify`, `POST /auth/email/resend`, `POST /auth/password/forgot`, `POST /auth/password/reset` | 7 |
| `POST /admin/auth/login`, `POST /admin/auth/refresh`, `POST /admin/auth/logout`, `GET /admin/me` | 8 |
| `GET /me` | 9 |

## Global Constraints

Every constraint of plan 1a still holds (toolchain, lints, SQL as bound parameters, problem+json errors, routes only through `Api`, exact `git add` paths, never push). The ones an implementer needs most often, and those this plan adds:

- **Where commands run:** from `apps/backend`, after `. "$HOME/.cargo/env"`, with `CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target"`. The stack must be up: `docker compose -f infra/docker-compose.yml up -d --wait mariadb redis mailpit` (from the repository root).
- **Offline query data:** after adding or changing a `sqlx::query!` in `src/`, run `cargo sqlx prepare` (command in Task 1, Step 9) and commit `apps/backend/.sqlx/`.
- **Crate API drift:** the code below was written against the pinned versions and the code of plan 1a, but not compiled. If a call does not compile, read the documentation of the pinned version and adapt the call. Never change what a test expects, or a behaviour, to make code compile.
- **Tests:** every test file starts with `#![allow(clippy::unwrap_used, clippy::expect_used)]`. Integration tests use `#[sqlx::test]` with the `(opts, conn)` arguments and build a `TestApp`. A test is written and seen failing before the code that makes it pass.
- **Files containing SQL keywords that look destructive** (a test that sends `DROP TABLE` as a name, for instance) are created with the editor tools, never through a shell heredoc: the command guard of this machine refuses such a command.
- **Per-address limits** are keyed by `ClientIp::subject()`. The address itself is private on purpose.
- **Redis at request time:** call Redis directly; the connection is configured in `AppState::new` to fail at once during an outage. Do not add a deadline, a retry or a pause around a call (three attempts at that are described in `handoff.md`).
- **What is never logged or written to Redis:** passwords, tokens, links that carry a token, emails, request bodies. A database error is logged through `db::describe`, never through its own message.
- **Wire format:** JSON keys are camelCase; ids are UUID strings; timestamps are UTC with milliseconds (`types::iso`); a date of birth never leaves the API.
- **Error codes** are the ones the frontends already read: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `TOKEN_REUSED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_BANNED`, `ACCOUNT_SUSPENDED`, `JUDGE_ACCOUNT`, `UNDER_AGE`, `EMAIL_TAKEN`, `USERNAME_TAKEN`, `PHONE_TAKEN`, `FORBIDDEN`, `VALIDATION_FAILED`, `RATE_LIMITED`. Both frontends retry a request once after a refresh only when a 401 carries `TOKEN_EXPIRED` or `TOKEN_INVALID`.
- **Commits:** one per task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings carried from the review of plan 1a

Each is implemented by Task 1 unless another task is named.

1. **Emails are printable ASCII.** After trimming and lower-casing, an email with any other character is refused with field code `ISEMAIL`. MariaDB compares the column more loosely than Rust compares strings (a soft hyphen or a zero-width space is ignored, trailing spaces do not count), so two strings the application sees as different could be one account to the unique index. Cost: an address with a non-ASCII character cannot register (the old API accepted them).
2. **Which of `EMAIL_TAKEN` and `USERNAME_TAKEN`** is decided from the name of the unique index the insert collided with, never by comparing strings in Rust (Task 5).
3. **The token keys are checked at start:** two keys with the same id are refused, and one token is signed and verified before the server accepts a request.
4. **A database error is logged by number, SQLSTATE and index name**, never by its message, which quotes values.
5. **Passwords are normalised (NFKC)** before hashing, verifying and checking the policy, so the same password typed on two keyboards is the same password. This must be in place before the first account exists.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task that owns the code.

1. **An address the database would confuse with another one** (soft hyphen, zero-width space, full-width letters): refused at the door, and a schema test pins what the column really does. Task 1.
2. **The same password typed as composed or decomposed characters** (é as one code point or as e plus an accent; full-width digits): one password. Task 1.
3. **Two refreshes with the same token at the same instant:** exactly one succeeds, and the family is revoked. Task 4.
4. **A job whose handler keeps failing, and a worker that dies in the middle of one:** retried with a growing delay, abandoned to the dead-letter stream after the fifth failure, picked up by another worker. Task 2.
5. **A birthday at the edge:** someone who turns 18 today (in Tunisia's time zone) registers; someone who turns 18 tomorrow is refused and nothing about them is stored. Task 5.

## File Structure

```
apps/backend/
  Cargo.toml                         + lettre, unicode-normalization
  src/
    lib.rs                           + audit, jobs, mail, rules
    main.rs                          + worker, promote; SIGTERM stops serve and worker
    state.rs                         + tokens, passwords
    types.rs                         + Role::as_str, iso
    db.rs                            + duplicate_key, describe
    error.rs                         From<sqlx::Error> through db::describe
    validate.rs                      + normalise_email
    audit.rs                         one function: record
    rules.rs                         the active rule set (minimum age, level titles)
    jobs.rs                          the queue: enqueue, Worker::tick
    mail.rs                          Mailer (SMTP or memory), the three mail texts
    security/tokens.rs               self-check at start
    security/password.rs             NFKC
    http/auth.rs                     AppUser, PanelUser
    http/mod.rs                      registers the new modules
    modules/mod.rs                   + auth, admin_auth, me
    modules/auth/mod.rs              routes and handlers of /auth/*
    modules/auth/sessions.rs         issue, start, refresh, logout
    modules/auth/accounts.rs         register, credentials check with lockout, promote
    modules/auth/emails.rs           the worker's side (create the link, send) and the API's side (consume it)
    modules/admin_auth.rs            /admin/auth/*, /admin/me
    modules/me.rs                    GET /me
    modules/reference.rs             uses types::iso
  tests/
    common/mod.rs                    + seeded, call, post, create_user, deliver_mail, assert_same_shape
    schema.rs                        + what the email column confuses; what is logged of an error
    reference.rs                     uses the shared helpers
    jobs.rs  sessions.rs  register.rs  login.rs  emails.rs  admin_auth.rs  me.rs  security.rs
```

---

### Task 1: Rulings of the review, shared services and test helpers

Everything the later tasks stand on: the five rulings above, the token and password services inside `AppState`, the audit function, the rule-set reader, and the helpers the integration tests share.

**Files:**
- Modify: `apps/backend/Cargo.toml`, `src/lib.rs`, `src/types.rs`, `src/db.rs`, `src/error.rs`, `src/validate.rs`, `src/state.rs`, `src/security/tokens.rs`, `src/security/password.rs`, `src/modules/reference.rs`
- Create: `src/audit.rs`, `src/rules.rs`
- Test: unit tests in the modified files; `tests/schema.rs`, `tests/reference.rs`, `tests/common/mod.rs`

**Interfaces:**
- Consumes (plan 1a): `Config`, `AppError`, `REQUEST_ID`, `Tokens`, `Passwords`, `password_problem`, `Role`, `backend::seed::run`, `TestApp`.
- Produces:
  - `types::Role::as_str(self) -> &'static str`; `types::iso(at: NaiveDateTime) -> String`
  - `validate::normalise_email(raw: &str) -> Option<String>`
  - `db::duplicate_key(e: &sqlx::Error) -> Option<&str>`; `db::describe(e: &sqlx::Error) -> String`
  - `audit::Event { actor: Option<(Uuid, Role)>, action: &'static str, user_id: Uuid, after: Option<serde_json::Value> }`; `audit::record(db, event) -> Result<(), sqlx::Error>` where `db` is a pool or a transaction connection
  - `rules::Rules { min_age_years: i32, level_titles: Vec<LevelTitle> }`; `Rules::active(db: &MySqlPool) -> Result<Rules, AppError>`; `Rules::level_title_key(&self, level: i32) -> &str`
  - `AppState.tokens: Arc<Tokens>`, `AppState.passwords: Arc<Passwords>`
  - Test helpers in `tests/common/mod.rs`: `seed_dir()`, `seeded(opts, conn)`, `seeded_with(opts, conn, tweak)`, `TestApp::call(method, path, token, body)`, `TestApp::post(path, body)`, `PASSWORD`, `a_place(app)`, `create_user(app, name, role) -> Uuid`, `assert_same_shape(path, expected, actual)`

- [ ] **Step 1: Move the shared test helpers into `tests/common/mod.rs`**

Add to the imports of `tests/common/mod.rs`:

```rust
use std::path::{Path, PathBuf};

use serde_json::Value;
use sqlx::AssertSqlSafe;
use uuid::Uuid;
```

(`Value` is already imported there; keep one import.) Append to the file:

```rust
pub fn seed_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../infra/seed-data")
}

/// A `TestApp` whose database holds the reference catalog and the active rule set.
pub async fn seeded(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> TestApp {
    seeded_with(opts, conn, |_| {}).await
}

pub async fn seeded_with(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
    tweak: impl FnOnce(&mut HashMap<String, String>),
) -> TestApp {
    let app = TestApp::with(opts, conn, tweak).await;
    backend::seed::run(&app.db, &seed_dir())
        .await
        .expect("the seed data loads");
    app
}

/// The password of every account the tests create.
pub const PASSWORD: &str = "correct horse battery staple";

/// One governorate and one of its cities, from the seeded catalog.
pub async fn a_place(app: &TestApp) -> (Uuid, Uuid) {
    sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id \
         ORDER BY g.code, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .expect("the catalog is seeded")
}

/// An account written straight into the database, as a registration leaves it. Its email is
/// `<name>@example.com`, its username `name` and its password `PASSWORD`.
pub async fn create_user(app: &TestApp, name: &str, role: backend::types::Role) -> Uuid {
    let id = Uuid::now_v7();
    let (governorate, city) = a_place(app).await;
    let hash = app
        .state
        .passwords
        .hash(PASSWORD.to_owned())
        .await
        .expect("a password hash");
    sqlx::query(
        "INSERT INTO users (id, email, username, password_hash, role, date_of_birth) \
         VALUES (?, ?, ?, ?, ?, '1995-05-05')",
    )
    .bind(id)
    .bind(format!("{name}@example.com"))
    .bind(name)
    .bind(hash)
    .bind(role.as_str())
    .execute(&app.db)
    .await
    .expect("the user row");
    sqlx::query(
        "INSERT INTO profiles (user_id, full_name, governorate_id, city_id) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("Athlete {name}"))
    .bind(governorate)
    .bind(city)
    .execute(&app.db)
    .await
    .expect("the profile row");
    for table in ["user_settings", "user_stats", "user_streaks"] {
        sqlx::query(AssertSqlSafe(format!(
            "INSERT INTO {table} (user_id) VALUES (?)"
        )))
        .bind(id)
        .execute(&app.db)
        .await
        .expect("the defaults row");
    }
    id
}

/// Every key of `expected` exists in `actual` with the same JSON type. `null` on either side matches
/// anything; lists are compared by their first element.
pub fn assert_same_shape(path: &str, expected: &Value, actual: &Value) {
    match (expected, actual) {
        (Value::Null, _) | (_, Value::Null) => {}
        (Value::Object(e), Value::Object(a)) => {
            for (key, value) in e {
                let got = a
                    .get(key)
                    .unwrap_or_else(|| panic!("{path}.{key} is missing"));
                assert_same_shape(&format!("{path}.{key}"), value, got);
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if let (Some(first_expected), Some(first_actual)) = (e.first(), a.first()) {
                assert_same_shape(&format!("{path}[0]"), first_expected, first_actual);
            }
        }
        (e, a) => assert_eq!(
            std::mem::discriminant(e),
            std::mem::discriminant(a),
            "{path}: expected {e}, got {a}"
        ),
    }
}
```

Inside `impl TestApp`, after `get`:

```rust
    /// One request. `token` goes in the `Authorization` header; `body` is sent as JSON.
    pub async fn call(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Reply {
        let mut req = request(method, path);
        if let Some(token) = token {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        let body = match body {
            Some(json) => {
                req = req.header("content-type", "application/json");
                Body::from(json.to_string())
            }
            None => Body::empty(),
        };
        self.send(req.body(body).unwrap()).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Reply {
        self.call(Method::POST, path, None, Some(body)).await
    }
```

In `tests/reference.rs`, delete its own `seed_dir`, `seeded` and `assert_same_shape`, and import the shared ones: `use common::{Reply, TestApp, assert_same_shape, seed_dir, seeded};`. Remove the imports that become unused.

`create_user` does not compile yet (`Role::as_str` and `AppState.passwords` come in Steps 3 and 7): that is expected until Step 7.

- [ ] **Step 2: Write the failing unit tests**

In the test module of `src/types.rs`:

```rust
    #[test]
    fn as_str_is_the_wire_name_of_every_role() {
        for role in Role::ALL {
            assert_eq!(
                serde_json::to_string(&role).unwrap(),
                format!("\"{}\"", role.as_str())
            );
        }
    }

    #[test]
    fn timestamps_leave_as_utc_with_milliseconds() {
        let at = chrono::NaiveDate::from_ymd_opt(2026, 10, 6)
            .unwrap()
            .and_hms_micro_opt(9, 30, 0, 123_456)
            .unwrap();
        assert_eq!(iso(at), "2026-10-06T09:30:00.123Z");
    }
```

In the test module of `src/validate.rs`:

```rust
    #[test]
    fn an_email_is_trimmed_lower_cased_and_must_be_plain_ascii() {
        assert_eq!(
            normalise_email("  Ahmed.Ben+Salah@Example.COM \n").as_deref(),
            Some("ahmed.ben+salah@example.com")
        );
        assert_eq!(
            normalise_email("o'brien@mail.example.tn").as_deref(),
            Some("o'brien@mail.example.tn")
        );
        for bad in [
            "",
            "ahmed",
            "@example.com",
            "ahmed@",
            "ahmed@example",
            "ahmed@@example.com",
            "a b@example.com",
            "ahmed@exa mple.com",
            "ahmed@-example.com",
            "ahmed@example..com",
            ".ahmed@example.com",
            "ahmed..b@example.com",
            "ahmed@example.c",
            // What the database would treat as the plain address, or as its neighbour.
            "ah\u{00AD}med@example.com",
            "ah\u{200B}med@example.com",
            "\u{FF41}hmed@example.com",
            "ren\u{00E9}@example.com",
            "ahmed@ex\u{00E4}mple.com",
            "ah\u{0000}med@example.com",
            "ahmed\t@example.com",
        ] {
            assert_eq!(normalise_email(bad), None, "{bad:?}");
        }
        assert_eq!(
            normalise_email(&format!("{}@example.com", "a".repeat(65))),
            None
        );
        assert_eq!(
            normalise_email(&format!("a@{}.com", "b".repeat(250))),
            None
        );
    }
```

In the test module of `src/security/password.rs`:

```rust
    #[tokio::test]
    async fn a_password_is_the_same_however_its_characters_were_typed() {
        let passwords = Arc::new(Passwords::new().unwrap());
        // é as one code point, then as e followed by a combining accent.
        let composed = "caf\u{00E9} du matin 2026";
        let decomposed = "cafe\u{0301} du matin 2026";
        let hash = passwords.hash(composed.into()).await.unwrap();
        assert!(passwords.verify(Some(hash), decomposed.into()).await);
    }

    #[test]
    fn the_policy_reads_the_normalised_password() {
        // Full-width digits are the digits 1234567890, which is on the common list.
        assert_eq!(
            password_problem(
                "\u{FF11}\u{FF12}\u{FF13}\u{FF14}\u{FF15}\u{FF16}\u{FF17}\u{FF18}\u{FF19}\u{FF10}",
                "a@example.com",
                "ahmed"
            ),
            Some("TOO_COMMON")
        );
    }
```

In the test module of `src/security/tokens.rs`:

```rust
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
```

- [ ] **Step 3: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib 2>&1 | tail -20
```

Expected: compile errors naming `as_str`, `iso`, `normalise_email` (not found); once those exist, the two password tests and the two token tests fail on their assertions.

- [ ] **Step 4: Implement the pure functions**

`apps/backend/Cargo.toml`, in `[dependencies]` (alphabetical order):

```toml
unicode-normalization = "0.1"
```

`src/types.rs`: add the import `use chrono::{NaiveDateTime, SecondsFormat};`, then inside `impl Role`:

```rust
    /// The spelling used on the wire and in the database.
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "USER",
            Role::GymAdmin => "GYM_ADMIN",
            Role::Moderator => "MODERATOR",
            Role::Admin => "ADMIN",
            Role::SuperAdmin => "SUPER_ADMIN",
            Role::Judge => "JUDGE",
            Role::HeadJudge => "HEAD_JUDGE",
        }
    }
```

and at module level:

```rust
/// Timestamps leave the API as UTC with milliseconds, like `2026-10-06T09:30:00.000Z`.
pub fn iso(at: NaiveDateTime) -> String {
    at.and_utc().to_rfc3339_opts(SecondsFormat::Millis, true)
}
```

In `src/modules/reference.rs`, delete the local `iso` function, add `types::iso` to the `use crate::{…}` list, and remove the `chrono` imports the compiler then reports as unused.

`src/validate.rs`, after `uuid_param`:

```rust
/// An email as it is stored and compared: trimmed and lower-cased. `None` unless it is a plausible
/// address written in printable ASCII. The database compares these columns more loosely than Rust
/// compares strings (it ignores a soft hyphen or a zero-width space, and trailing spaces do not
/// count), so two strings that differ here could be one account to the unique index. Refusing
/// everything outside ASCII closes that gap.
pub fn normalise_email(raw: &str) -> Option<String> {
    let email = raw.trim().to_ascii_lowercase();
    let (local, domain) = email.rsplit_once('@')?;
    let label_ok = |label: &str| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    };
    let ok = email.len() <= 254
        && (1..=64).contains(&local.len())
        && local.bytes().all(|b| b.is_ascii_graphic() && b != b'@')
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && domain.contains('.')
        && domain.split('.').all(label_ok)
        && domain
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_alphabetic()));
    ok.then_some(email)
}
```

`src/security/password.rs`: add `use unicode_normalization::UnicodeNormalization;` and

```rust
/// One spelling for every way of typing the same characters (NFKC): an accent typed as one key or
/// as two, full-width digits, Arabic presentation forms. Applied before hashing, verifying and
/// checking the policy, so a password works from any keyboard.
fn normalise(password: &str) -> String {
    password.nfkc().collect()
}
```

In `hash`, replace `password.as_bytes()` with `normalise(&password).as_bytes()`; in `verify`, likewise. In `password_problem`, start with `let password = normalise(password);` and use `&password` below (the length rule then counts normalised characters).

`src/security/tokens.rs`, in `Tokens::new`, replace the loop that fills `decoding` and the final `Ok(Self { … })` with:

```rust
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
```

- [ ] **Step 5: Run the unit tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib 2>&1 | tail -5
```

Expected: `test result: ok.` with 64 tests (58 before, 6 added).

- [ ] **Step 6: Write the failing database tests**

Append to `tests/schema.rs` (add `use backend::types::Role;` and `use serde_json::{Value, json};` to its imports):

```rust
#[sqlx::test]
async fn the_email_column_confuses_what_the_application_refuses(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let db = backend::db::pool(opts, conn);
    insert_user(&db, "ahmed@example.com", "ahmed").await.unwrap();
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
    assert!(err.to_string().contains("secret.address"), "the raw message quotes the value");
    let line = backend::db::describe(&err);
    assert!(line.contains("1062") && line.contains("uq_users_email"), "{line}");
    assert!(!line.contains("secret.address"), "{line}");
    assert_eq!(
        backend::db::duplicate_key(&sqlx::Error::RowNotFound),
        None
    );
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
        (role.as_str(), action.as_str(), entity.as_str(), request.as_str()),
        ("ADMIN", "ROLE_CHANGED", "user", "req-42")
    );
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({"to": "ADMIN"})
    );
}
```

If MariaDB does not report one of the three `twins` as a duplicate, remove that one from the list and say so in the task report: the test pins what this server really does, it does not prescribe it.

Append to `tests/reference.rs`:

```rust
#[sqlx::test]
async fn the_active_rule_set_gives_the_minimum_age_and_the_level_titles(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let rules = backend::rules::Rules::active(&app.db).await.unwrap();
    assert_eq!(rules.min_age_years, 18);
    assert_eq!(rules.level_title_key(1), "level.title.beginner");
    assert_eq!(rules.level_title_key(5), "level.title.beginner");
    assert_eq!(rules.level_title_key(6), "level.title.rookie");
    assert_eq!(rules.level_title_key(9999), rules.level_title_key(1000));
}

#[sqlx::test]
async fn without_a_rule_set_the_answer_is_an_internal_error(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let err = backend::rules::Rules::active(&app.db).await.err().unwrap();
    assert_eq!(err.status, StatusCode::INTERNAL_SERVER_ERROR);
}
```

- [ ] **Step 7: Implement the database helpers, the audit function, the rule-set reader and the state**

`src/db.rs`: add `MySqlDatabaseError` to the `sqlx::mysql` imports and append:

```rust
/// The unique index a statement collided with, when that is why it failed (MariaDB error 1062).
/// The server names it only inside its message: `Duplicate entry '…' for key 'uq_users_email'`.
/// The quoted value comes first and may contain anything, so the name is read from the end.
pub fn duplicate_key(e: &sqlx::Error) -> Option<&str> {
    let error = e
        .as_database_error()?
        .try_downcast_ref::<MySqlDatabaseError>()?;
    if error.number() != 1062 {
        return None;
    }
    let (_, key) = error.message().rsplit_once(" for key '")?;
    // MySQL writes `table.index`, MariaDB the index alone.
    key.trim_end_matches('\'').rsplit('.').next()
}

/// What may be logged about a database error. Never its message: the server quotes the values of
/// the statement in it (an email, in a duplicate-key error).
pub fn describe(e: &sqlx::Error) -> String {
    match e
        .as_database_error()
        .and_then(|d| d.try_downcast_ref::<MySqlDatabaseError>())
    {
        Some(error) => format!(
            "database error {} (SQLSTATE {}), key {}",
            error.number(),
            error.code().unwrap_or("?"),
            duplicate_key(e).unwrap_or("-")
        ),
        None => e.to_string(),
    }
}
```

`src/error.rs`: replace the body of `From<sqlx::Error>`:

```rust
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        Self::internal(crate::db::describe(&e))
    }
}
```

Create `src/audit.rs`:

```rust
//! The append-only trail of security events. The database refuses to change or remove a row.
//! Never put a secret, a token or health data in `after`.

use serde_json::Value;
use sqlx::MySqlExecutor;
use uuid::Uuid;

use crate::{error::REQUEST_ID, types::Role};

pub struct Event {
    /// Who did it. `None` when nobody is signed in (a failed login, the worker).
    pub actor: Option<(Uuid, Role)>,
    pub action: &'static str,
    /// The account the event is about.
    pub user_id: Uuid,
    pub after: Option<Value>,
}

/// `db` is the pool, or the connection of a transaction when the entry must commit with the change.
pub async fn record<'e>(db: impl MySqlExecutor<'e>, event: Event) -> Result<(), sqlx::Error> {
    let request_id = REQUEST_ID.try_with(Clone::clone).ok();
    sqlx::query!(
        "INSERT INTO audit_log (id, actor_id, actor_role, action, entity_type, entity_id, after_json, request_id) \
         VALUES (?, ?, ?, ?, 'user', ?, ?, ?)",
        Uuid::now_v7(),
        event.actor.map(|(id, _)| id),
        event.actor.map(|(_, role)| role.as_str()),
        event.action,
        event.user_id,
        event.after.map(|value| value.to_string()),
        request_id
    )
    .execute(db)
    .await
    .map(|_| ())
}
```

Create `src/rules.rs`:

```rust
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
            .filter(|title| level >= title.from_level)
            .next_back()
            .or(self.level_titles.first())
            .map_or("", |title| title.key.as_str())
    }
}
```

If the compiler says `config` is `Vec<u8>` and not `String`, write the column as `config AS "config: String"`.

`src/lib.rs`: add `pub mod audit;` and `pub mod rules;` (alphabetical order).

`src/state.rs`: add the imports `use crate::security::{password::Passwords, tokens::Tokens};`, the fields

```rust
    pub tokens: Arc<Tokens>,
    pub passwords: Arc<Passwords>,
```

and in `new`, before the Redis connection is opened:

```rust
        // Both are checked now: a wrong key pair must stop the process, not refuse every sign-in.
        let tokens = Arc::new(Tokens::new(&cfg)?);
        let passwords = Arc::new(Passwords::new()?);
```

with `tokens,` and `passwords,` in the `Ok(Self { … })`.

- [ ] **Step 8: Run everything**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test 2>&1 | grep -E "^test result|FAILED|panicked"
```

Expected: every line `ok`; `schema` has 10 tests, `reference` has 10.

- [ ] **Step 9: Refresh the offline query data, lint, commit**

```bash
DATABASE_URL="mysql://root:fl_root_dev@127.0.0.1:3307/fitness_league" CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo sqlx prepare
SQLX_OFFLINE=true CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo clippy --all-targets -- -D warnings
cargo fmt --check
git -C ../.. add apps/backend/Cargo.toml apps/backend/Cargo.lock apps/backend/.sqlx apps/backend/src apps/backend/tests
git -C ../.. commit -m "feat(backend): review rulings, token and password services in the state, audit and rule-set readers"
```

The development database must hold the current schema for `cargo sqlx prepare` (it does after plan 1a; this plan adds no migration). Every later task ends with these same five commands and its own message; the steps below only give the message. Nothing outside `apps/backend` is staged by these paths, which is what keeps the line-ending noise of the rest of the tree out of the commits.

---

### Task 2: The job queue

**Files:**
- Create: `apps/backend/src/jobs.rs`
- Modify: `apps/backend/src/lib.rs`
- Test: unit tests in `src/jobs.rs`; `apps/backend/tests/jobs.rs`

**Interfaces:**
- Consumes: `AppState` (`redis`, `redis_prefix`), `AppError`.
- Produces:
  - `jobs::JobKind { EmailVerify, PasswordReset, AccountLocked }` (wire names `EMAIL_VERIFY`, `PASSWORD_RESET`, `ACCOUNT_LOCKED`)
  - `jobs::Job { kind: JobKind, user_id: Uuid, attempt: u32 }`
  - `jobs::enqueue(state: &AppState, kind: JobKind, user_id: Uuid) -> Result<(), AppError>`
  - `jobs::Worker::new(state: AppState, consumer: &str) -> Worker`; `Worker::claim_after_ms(self, ms: u64) -> Worker`; `Worker::tick(&self, now_ms: u64, block: bool, handler: impl AsyncFn(Job) -> Result<(), String>) -> Result<usize, String>` (returns how many jobs it ran)
  - `jobs::retry_delay_s(attempt: u32) -> Option<u64>`; `jobs::MAX_ATTEMPTS`
  - Redis keys, all under `state.redis_prefix`: `jobs` (stream), `jobs:waiting` (sorted set of jobs to run again, scored by the time they are due), `jobs:dead` (stream of abandoned jobs)

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/jobs.rs`:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::{sync::Mutex, time::Duration};

use backend::jobs::{self, Job, JobKind, Worker};
use common::TestApp;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

/// The clock is an argument of `tick`, so a test moves time without waiting.
const T0: u64 = 1_800_000_000_000;

async fn size(app: &TestApp, command: &str, suffix: &str) -> i64 {
    let mut redis = app.state.redis.clone();
    redis::cmd(command)
        .arg(format!("{}jobs{suffix}", app.state.redis_prefix))
        .query_async(&mut redis)
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_job_runs_once_and_leaves_nothing_behind(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = TestApp::new(opts, conn).await;
    let user = Uuid::now_v7();
    jobs::enqueue(&app.state, JobKind::EmailVerify, user)
        .await
        .unwrap();

    let worker = Worker::new(app.state.clone(), "w1");
    let seen = Mutex::new(Vec::new());
    let ran = worker
        .tick(T0, false, async |job: Job| {
            seen.lock().unwrap().push(job);
            Ok(())
        })
        .await
        .unwrap();

    assert_eq!(ran, 1);
    assert_eq!(
        *seen.lock().unwrap(),
        [Job {
            kind: JobKind::EmailVerify,
            user_id: user,
            attempt: 1
        }]
    );
    assert_eq!(worker.tick(T0, false, async |_| Ok(())).await.unwrap(), 0);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn a_failing_job_comes_back_later_and_is_abandoned_after_the_fifth_failure(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    jobs::enqueue(&app.state, JobKind::AccountLocked, Uuid::now_v7())
        .await
        .unwrap();
    let worker = Worker::new(app.state.clone(), "w1");
    let attempts = Mutex::new(Vec::new());
    let fail = async |job: Job| {
        attempts.lock().unwrap().push(job.attempt);
        Err("smtp: refused with 451".to_owned())
    };

    let mut now = T0;
    assert_eq!(worker.tick(now, false, &fail).await.unwrap(), 1);
    for delay_s in [30, 60, 120, 240] {
        // One second before it is due, nothing runs.
        let early = now + (delay_s - 1) * 1000;
        assert_eq!(worker.tick(early, false, &fail).await.unwrap(), 0);
        now += delay_s * 1000;
        assert_eq!(worker.tick(now, false, &fail).await.unwrap(), 1);
    }

    assert_eq!(*attempts.lock().unwrap(), [1, 2, 3, 4, 5]);
    // Abandoned: nothing waits, nothing is left to run, and the dead-letter stream holds it.
    assert_eq!(worker.tick(now + 86_400_000, false, &fail).await.unwrap(), 0);
    assert_eq!(size(&app, "ZCARD", ":waiting").await, 0);
    assert_eq!(size(&app, "XLEN", ":dead").await, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn a_job_left_by_a_dead_worker_is_run_by_another(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = TestApp::new(opts, conn).await;
    let user = Uuid::now_v7();
    jobs::enqueue(&app.state, JobKind::PasswordReset, user)
        .await
        .unwrap();

    // A worker takes the job and dies before finishing it.
    let dying = Worker::new(app.state.clone(), "w1");
    let never = dying.tick(T0, false, async |_| {
        std::future::pending::<()>().await;
        Ok(())
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(500), never)
            .await
            .is_err(),
        "the handler never returns"
    );

    // To another worker it is not a new job…
    let other = Worker::new(app.state.clone(), "w2");
    assert_eq!(other.tick(T0, false, async |_| Ok(())).await.unwrap(), 0);
    // …but it takes it over once the job has been left alone long enough (at once, in this test).
    let ran = other
        .claim_after_ms(0)
        .tick(T0, false, async |job: Job| {
            assert_eq!(job.user_id, user);
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(ran, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn an_entry_that_is_not_a_job_goes_straight_to_the_dead_letters(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let mut redis = app.state.redis.clone();
    let _: String = redis::cmd("XADD")
        .arg(format!("{}jobs", app.state.redis_prefix))
        .arg("*")
        .arg("job")
        .arg(r#"{"kind":"FROM_A_NEWER_VERSION","userId":"x","attempt":1}"#)
        .query_async(&mut redis)
        .await
        .unwrap();

    let worker = Worker::new(app.state.clone(), "w1");
    let ran = worker
        .tick(T0, false, async |_| panic!("the handler must not see it"))
        .await
        .unwrap();
    assert_eq!(ran, 1);
    assert_eq!(size(&app, "XLEN", ":dead").await, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test jobs 2>&1 | tail -5
```

Expected: does not compile, `could not find jobs in backend`.

- [ ] **Step 3: Write the queue**

Add `pub mod jobs;` to `src/lib.rs`. Create `src/jobs.rs`:

```rust
//! Background jobs on a Redis Stream.
//!
//! The API adds a job. A worker reads it through a consumer group, runs it and acknowledges it. A
//! job that fails goes to a waiting list and comes back after a growing delay; after its fifth
//! failure it is moved to the dead-letter stream. A job whose worker died is taken over by another
//! worker. Delivery is at-least-once: a job must be safe to run twice.
//!
//! A job carries a kind and a user id, nothing else. No secret is ever written to Redis.

use std::sync::LazyLock;

use redis::streams::{StreamAutoClaimReply, StreamId, StreamReadReply};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

pub const MAX_ATTEMPTS: u32 = 5;
const GROUP: &str = "workers";
/// A job delivered this long ago and still not acknowledged belongs to a worker that died.
const CLAIM_AFTER_MS: u64 = 60_000;
/// How long an idle worker waits for a job. Shorter than the second the connection gives Redis to answer.
const BLOCK_MS: u64 = 500;
const BATCH: usize = 10;
/// A safety valve when no worker runs: the oldest jobs are dropped beyond this many.
const STREAM_CAPACITY: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobKind {
    EmailVerify,
    PasswordReset,
    AccountLocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub kind: JobKind,
    pub user_id: Uuid,
    pub attempt: u32,
}

/// Seconds to wait before running a job again after its `attempt`-th failure: 30 s, 1 min, 2 min,
/// 4 min. `None` after the fifth failure: the job is abandoned.
pub fn retry_delay_s(attempt: u32) -> Option<u64> {
    (1..MAX_ATTEMPTS)
        .contains(&attempt)
        .then(|| 30u64 << (attempt - 1))
}

struct Keys {
    stream: String,
    waiting: String,
    dead: String,
}

fn keys(state: &AppState) -> Keys {
    let prefix = &state.redis_prefix;
    Keys {
        stream: format!("{prefix}jobs"),
        waiting: format!("{prefix}jobs:waiting"),
        dead: format!("{prefix}jobs:dead"),
    }
}

pub async fn enqueue(state: &AppState, kind: JobKind, user_id: Uuid) -> Result<(), AppError> {
    let job = Job {
        kind,
        user_id,
        attempt: 1,
    };
    let job = serde_json::to_string(&job).map_err(AppError::internal)?;
    let mut redis = state.redis.clone();
    let _: String = redis::cmd("XADD")
        .arg(keys(state).stream)
        .arg("MAXLEN")
        .arg("~")
        .arg(STREAM_CAPACITY)
        .arg("*")
        .arg("job")
        .arg(job)
        .query_async(&mut redis)
        .await?;
    Ok(())
}

/// Moves the waiting jobs that are due back to the stream. One script, so two workers never move
/// the same job. KEYS: waiting list, stream. ARGV: now, in milliseconds.
static REQUEUE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r"
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 50)
for _, job in ipairs(due) do
  redis.call('XADD', KEYS[2], '*', 'job', job)
  redis.call('ZREM', KEYS[1], job)
end
return #due
",
    )
});

pub struct Worker {
    state: AppState,
    /// The name of this worker in the consumer group. Unique per process.
    consumer: String,
    claim_after_ms: u64,
}

impl Worker {
    pub fn new(state: AppState, consumer: &str) -> Self {
        Self {
            state,
            consumer: consumer.to_owned(),
            claim_after_ms: CLAIM_AFTER_MS,
        }
    }

    /// How long a job must have been left alone before this worker takes it over from another.
    pub fn claim_after_ms(mut self, ms: u64) -> Self {
        self.claim_after_ms = ms;
        self
    }

    /// Runs the jobs that are ready (those due again, those left by a dead worker, the new ones)
    /// and returns how many it ran. `now_ms` is the clock; with `block` an idle worker waits half a
    /// second for a job instead of returning at once.
    pub async fn tick(
        &self,
        now_ms: u64,
        block: bool,
        handler: impl AsyncFn(Job) -> Result<(), String>,
    ) -> Result<usize, String> {
        let text = |e: redis::RedisError| e.to_string();
        let keys = keys(&self.state);
        let mut redis = self.state.redis.clone();

        // The group exists after the first call; creating it again is refused with BUSYGROUP.
        let created: redis::RedisResult<String> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(&keys.stream)
            .arg(GROUP)
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut redis)
            .await;
        if let Err(e) = created
            && e.code() != Some("BUSYGROUP")
        {
            return Err(text(e));
        }

        let _: i64 = REQUEUE
            .key(&keys.waiting)
            .key(&keys.stream)
            .arg(now_ms)
            .invoke_async(&mut redis)
            .await
            .map_err(text)?;

        let abandoned: StreamAutoClaimReply = redis::cmd("XAUTOCLAIM")
            .arg(&keys.stream)
            .arg(GROUP)
            .arg(&self.consumer)
            .arg(self.claim_after_ms)
            .arg("0")
            .arg("COUNT")
            .arg(BATCH)
            .query_async(&mut redis)
            .await
            .map_err(text)?;
        let mut entries: Vec<StreamId> = abandoned.claimed;

        let mut read = redis::cmd("XREADGROUP");
        read.arg("GROUP")
            .arg(GROUP)
            .arg(&self.consumer)
            .arg("COUNT")
            .arg(BATCH);
        if block && entries.is_empty() {
            read.arg("BLOCK").arg(BLOCK_MS);
        }
        read.arg("STREAMS").arg(&keys.stream).arg(">");
        // Nothing to read is a nil answer.
        let fresh: Option<StreamReadReply> = read.query_async(&mut redis).await.map_err(text)?;
        entries.extend(
            fresh
                .into_iter()
                .flat_map(|reply| reply.keys)
                .flat_map(|key| key.ids),
        );

        for entry in &entries {
            let raw: String = entry.get("job").unwrap_or_default();
            let job = serde_json::from_str::<Job>(&raw).ok();
            let outcome = match job.clone() {
                Some(job) => handler(job).await,
                None => Err("not a job this version knows".to_owned()),
            };
            // What follows the run and the acknowledgement go together or not at all.
            let mut done = redis::pipe();
            done.atomic();
            if let Err(cause) = outcome {
                let again = job.and_then(|job| retry_delay_s(job.attempt).map(|delay| (job, delay)));
                match again {
                    Some((job, delay_s)) => {
                        tracing::warn!(kind = ?job.kind, attempt = job.attempt, cause = %cause, "job failed; it will run again");
                        let next = Job {
                            attempt: job.attempt + 1,
                            ..job
                        };
                        let next = serde_json::to_string(&next).map_err(|e| e.to_string())?;
                        done.cmd("ZADD")
                            .arg(&keys.waiting)
                            .arg(now_ms + delay_s * 1000)
                            .arg(next);
                    }
                    None => {
                        tracing::error!(cause = %cause, "job abandoned");
                        done.cmd("XADD")
                            .arg(&keys.dead)
                            .arg("*")
                            .arg("job")
                            .arg(&raw)
                            .arg("cause")
                            .arg(&cause);
                    }
                }
            }
            done.cmd("XACK")
                .arg(&keys.stream)
                .arg(GROUP)
                .arg(&entry.id)
                .cmd("XDEL")
                .arg(&keys.stream)
                .arg(&entry.id);
            let _: () = done.query_async(&mut redis).await.map_err(text)?;
        }
        Ok(entries.len())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use serde_json::json;

    use super::*;

    #[test]
    fn the_delay_doubles_and_the_fifth_failure_is_the_last() {
        assert_eq!(
            [1, 2, 3, 4].map(retry_delay_s),
            [Some(30), Some(60), Some(120), Some(240)]
        );
        assert_eq!([0, 5, 6, u32::MAX].map(retry_delay_s), [None; 4]);
    }

    #[test]
    fn a_job_carries_a_kind_a_user_and_nothing_else() {
        let job = Job {
            kind: JobKind::PasswordReset,
            user_id: Uuid::nil(),
            attempt: 1,
        };
        assert_eq!(
            serde_json::to_value(&job).unwrap(),
            json!({"kind": "PASSWORD_RESET", "userId": "00000000-0000-0000-0000-000000000000", "attempt": 1})
        );
    }
}
```

Two identical jobs waiting for the same retry are one entry of the waiting list (it is a set): running it once is enough, since a job is safe to run twice or once.

- [ ] **Step 4: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test jobs --lib jobs 2>&1 | grep -E "^test |test result"
```

Expected: 4 integration tests and 2 unit tests pass.

- [ ] **Step 5: Lint and commit**

Message: `feat(backend): job queue on a Redis Stream with retries, dead letters and takeover`

---

### Task 3: Mail, the email jobs and the worker process

**Files:**
- Create: `apps/backend/src/mail.rs`, `src/modules/auth/mod.rs`, `src/modules/auth/emails.rs`
- Modify: `apps/backend/Cargo.toml`, `src/lib.rs`, `src/modules/mod.rs`, `src/main.rs`, `src/config.rs`, `apps/backend/.env.example`, `apps/backend/tests/common/mod.rs`
- Test: unit tests in `src/mail.rs` and `src/config.rs`; `apps/backend/tests/mail.rs`, `apps/backend/tests/emails.rs`

**Interfaces:**
- Consumes: `jobs::{Job, JobKind, Worker}`, `tokens::new_opaque`, `db::describe`, `Config.{smtp_url, mail_from, app_name, app_link_base_url}`.
- Produces:
  - `mail::Sent { to, subject, text }`; `mail::Mailer::{from_config(cfg) -> Result<Mailer, String>, memory() -> Mailer, sent(&self) -> Vec<Sent>, send(&self, to, subject, text) -> Result<(), String>}`
  - `mail::render(kind: JobKind, locale: &str, app: &str, link: &str) -> (String, String)` (subject, text)
  - `modules::auth::emails::handle(state: &AppState, mailer: &Mailer, job: Job) -> Result<(), String>`
  - Links: `<APP_LINK_BASE_URL>/verify-email?token=…` (24 h), `/reset-password?token=…` (1 h), `/forgot-password` (no token)
  - The subcommand `backend worker`
  - Test helpers: `common::deliver_mail(app) -> Vec<Sent>`, `common::token_in(mail) -> String`

- [ ] **Step 1: Add the mail library**

`apps/backend/Cargo.toml`, in `[dependencies]`:

```toml
lettre = { version = "0.11", default-features = false, features = ["builder", "smtp-transport", "tokio1-rustls-tls"] }
```

Then check the new dependencies against the supply-chain rules:

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo check && cargo audit && cargo deny check
```

Expected: `cargo audit` reports no vulnerability; `cargo deny check` ends with `advisories ok, bans ok, licenses ok, sources ok`. If a licence of a new crate is refused and it is a permissive one (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode), add it to `deny.toml` and say so in the report. Anything else: stop and report.

- [ ] **Step 2: Write the failing tests**

Unit tests at the end of the future `src/mail.rs` are part of Step 3's file. Create `apps/backend/tests/mail.rs`, a test of the real SMTP path against a server that lives inside the test:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use backend::{config::Config, devkeys, mail::Mailer};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

/// Just enough SMTP to accept one message. Returns what the client sent after `DATA`.
async fn one_message(listener: TcpListener) -> String {
    let (socket, _) = listener.accept().await.unwrap();
    let (read, mut write) = socket.into_split();
    let mut lines = BufReader::new(read).lines();
    write.write_all(b"220 test server\r\n").await.unwrap();
    let mut message = String::new();
    let mut in_data = false;
    while let Some(line) = lines.next_line().await.unwrap() {
        if in_data {
            if line == "." {
                in_data = false;
                write.write_all(b"250 queued\r\n").await.unwrap();
            } else {
                message.push_str(&line);
                message.push('\n');
            }
            continue;
        }
        let verb = line.to_ascii_uppercase();
        if verb.starts_with("DATA") {
            in_data = true;
            write.write_all(b"354 go on\r\n").await.unwrap();
        } else if verb.starts_with("QUIT") {
            write.write_all(b"221 bye\r\n").await.unwrap();
            break;
        } else {
            write.write_all(b"250 ok\r\n").await.unwrap();
        }
    }
    message
}

fn config(smtp_url: &str) -> Config {
    let (private, public) = devkeys::generate().unwrap();
    let vars: HashMap<String, String> = [
        ("APP_ENV", "test"),
        ("DATABASE_URL", "mysql://unused"),
        ("REDIS_URL", "redis://unused"),
        ("JWT_PRIVATE_KEY_B64", private.as_str()),
        ("JWT_PUBLIC_KEY_B64", public.as_str()),
        ("APP_HMAC_SECRET", "0123456789abcdef0123456789abcdef"),
        ("SMTP_URL", smtp_url),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    Config::from_map(&vars).unwrap()
}

#[tokio::test]
async fn a_mail_goes_out_over_smtp() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("smtp://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(one_message(listener));

    let mailer = Mailer::from_config(&config(&url)).unwrap();
    mailer
        .send(
            "athlete@example.com",
            "Fitness League: confirm your email",
            "Welcome!\n\nhttps://app.example/verify-email?token=abc\n",
        )
        .await
        .unwrap();

    let message = server.await.unwrap();
    assert!(message.contains("To: athlete@example.com"), "{message}");
    assert!(message.contains("From: Fitness League <no-reply@fitnessleague.app>"), "{message}");
    assert!(message.contains("Subject: Fitness League: confirm your email"), "{message}");
    assert!(message.contains("verify-email?token"), "{message}");
    assert!(mailer.sent().is_empty(), "nothing is kept when mails really leave");
}

#[tokio::test]
async fn a_refusal_is_reported_without_the_address() {
    // Nothing listens on this port once the listener is dropped.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("smtp://{}", listener.local_addr().unwrap());
    drop(listener);
    let mailer = Mailer::from_config(&config(&url)).unwrap();
    let cause = mailer
        .send("athlete@example.com", "Subject", "Text")
        .await
        .unwrap_err();
    assert!(cause.starts_with("smtp:"), "{cause}");
    assert!(!cause.contains("athlete"), "{cause}");
}
```

Create `apps/backend/tests/emails.rs`, the worker's side of the links:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use backend::{
    jobs::{self, JobKind},
    security::tokens::hash_opaque,
    types::Role,
};
use common::{TestApp, create_user, deliver_mail, seeded, token_in};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

/// `(hash, minutes until it expires, consumed)` of the user's links, oldest first.
async fn links(app: &TestApp, user: Uuid, purpose: &str) -> Vec<(Vec<u8>, i64, bool)> {
    sqlx::query_as(
        "SELECT token_hash, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(6), expires_at), consumed_at IS NOT NULL \
         FROM email_tokens WHERE user_id = ? AND purpose = ? ORDER BY created_at, id",
    )
    .bind(user)
    .bind(purpose)
    .fetch_all(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn the_verification_mail_carries_a_link_whose_hash_is_stored(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    jobs::enqueue(&app.state, JobKind::EmailVerify, user)
        .await
        .unwrap();

    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");
    // French is the default language of an account.
    assert_eq!(mails[0].subject, "Fitness League : confirme ton adresse email");
    assert!(
        mails[0]
            .text
            .contains("https://app.fitnessleague.app/verify-email?token="),
        "{}",
        mails[0].text
    );

    let stored = links(&app, user, "EMAIL_VERIFY").await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].0, hash_opaque(&token_in(&mails[0])));
    assert!((23 * 60..=24 * 60).contains(&stored[0].1), "{}", stored[0].1);
    assert!(!stored[0].2);
}

#[sqlx::test]
async fn a_second_link_cancels_the_first(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    for _ in 0..2 {
        jobs::enqueue(&app.state, JobKind::PasswordReset, user)
            .await
            .unwrap();
    }
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 2);

    let stored = links(&app, user, "PASSWORD_RESET").await;
    assert_eq!(stored.len(), 2);
    assert!(stored[0].2, "the first link no longer works");
    assert!(!stored[1].2);
    assert!((59..=60).contains(&stored[1].1), "{}", stored[1].1);
}

#[sqlx::test]
async fn the_mail_is_written_in_the_language_of_the_account(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    sqlx::query("UPDATE user_settings SET locale = 'en' WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    jobs::enqueue(&app.state, JobKind::AccountLocked, user)
        .await
        .unwrap();

    let mails = deliver_mail(&app).await;
    assert_eq!(mails[0].subject, "Fitness League: sign-in temporarily locked");
    // This mail points at the screen where a new password is asked for: no token in it.
    assert!(mails[0].text.contains("https://app.fitnessleague.app/forgot-password"));
    assert!(!mails[0].text.contains("token="));
    assert!(links(&app, user, "PASSWORD_RESET").await.is_empty());
}

#[sqlx::test]
async fn nothing_is_sent_when_the_job_no_longer_applies(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let verified = create_user(&app, "verified", Role::User).await;
    let banned = create_user(&app, "banned", Role::User).await;
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(verified)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET status = 'BANNED' WHERE id = ?")
        .bind(banned)
        .execute(&app.db)
        .await
        .unwrap();

    jobs::enqueue(&app.state, JobKind::EmailVerify, verified)
        .await
        .unwrap();
    jobs::enqueue(&app.state, JobKind::PasswordReset, banned)
        .await
        .unwrap();
    // An account that was removed after the job was queued.
    jobs::enqueue(&app.state, JobKind::EmailVerify, Uuid::now_v7())
        .await
        .unwrap();

    assert!(deliver_mail(&app).await.is_empty());
    assert!(links(&app, banned, "PASSWORD_RESET").await.is_empty());
}
```

In `src/config.rs`, in the test module:

```rust
    #[test]
    fn a_mail_server_reached_without_tls_is_reported() {
        let names = |url: &str| {
            Config::from_map(&with(&[("APP_ENV", "production"), ("SMTP_URL", url)]))
                .unwrap()
                .plaintext_backends()
        };
        assert!(names("smtp://user:pw@mail.example:25").contains(&"SMTP"));
        assert!(!names("smtp://user:pw@mail.example:587?tls=required").contains(&"SMTP"));
        assert!(!names("smtps://user:pw@mail.example:465").contains(&"SMTP"));
    }
```

- [ ] **Step 3: Write the mail module**

Add `pub mod mail;` to `src/lib.rs`. Create `src/mail.rs`:

```rust
//! Outgoing mail: three plain-text messages, in French, English and Arabic.

use std::sync::{Mutex, PoisonError};

use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
};
use secrecy::ExposeSecret;

use crate::{config::Config, jobs::JobKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sent {
    pub to: String,
    pub subject: String,
    pub text: String,
}

pub enum Mailer {
    Smtp {
        transport: AsyncSmtpTransport<Tokio1Executor>,
        from: Mailbox,
    },
    /// Keeps the mails instead of sending them: the tests, and a developer machine with no
    /// `SMTP_URL`. Production refuses to start without one.
    Memory(Mutex<Vec<Sent>>),
}

impl Mailer {
    pub fn from_config(cfg: &Config) -> Result<Self, String> {
        let Some(url) = &cfg.smtp_url else {
            tracing::warn!("SMTP_URL is not set: mails are kept in memory and never sent");
            return Ok(Self::memory());
        };
        // The address may hold a password: the error does not repeat it.
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url.expose_secret())
            .map_err(|_| "SMTP_URL: expected smtp://… or smtps://…".to_owned())?
            .build();
        let from = cfg
            .mail_from
            .parse()
            .map_err(|_| "MAIL_FROM: expected `Name <address>`".to_owned())?;
        Ok(Self::Smtp { transport, from })
    }

    pub fn memory() -> Self {
        Self::Memory(Mutex::default())
    }

    /// What a memory mailer was asked to send.
    pub fn sent(&self) -> Vec<Sent> {
        match self {
            Self::Memory(kept) => kept.lock().unwrap_or_else(PoisonError::into_inner).clone(),
            Self::Smtp { .. } => Vec::new(),
        }
    }

    /// The error is logged by the caller, so it never repeats the address or the text.
    pub async fn send(&self, to: &str, subject: &str, text: &str) -> Result<(), String> {
        match self {
            Self::Memory(kept) => {
                kept.lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(Sent {
                        to: to.to_owned(),
                        subject: subject.to_owned(),
                        text: text.to_owned(),
                    });
                Ok(())
            }
            Self::Smtp { transport, from } => {
                let recipient = to
                    .parse()
                    .map_err(|_| "smtp: the recipient is not an address".to_owned())?;
                let message = Message::builder()
                    .from(from.clone())
                    .to(recipient)
                    .subject(subject)
                    .header(ContentType::TEXT_PLAIN)
                    .body(text.to_owned())
                    .map_err(|_| "smtp: the message could not be built".to_owned())?;
                transport
                    .send(message)
                    .await
                    .map(|_| ())
                    .map_err(|e| match e.status() {
                        Some(code) => format!("smtp: refused with {code}"),
                        None => "smtp: no answer".to_owned(),
                    })
            }
        }
    }
}

/// `(subject, text)` in the language of the account; French when it is none of the three.
pub fn render(kind: JobKind, locale: &str, app: &str, link: &str) -> (String, String) {
    match (kind, locale) {
        (JobKind::EmailVerify, "en") => (
            format!("{app}: confirm your email"),
            format!("Welcome!\n\nConfirm your email address (link valid for 24 h):\n{link}\n"),
        ),
        (JobKind::EmailVerify, "ar") => (
            format!("{app}: أكّد بريدك الإلكتروني"),
            format!("مرحبًا!\n\nأكّد عنوان بريدك الإلكتروني (الرابط صالح لمدة 24 ساعة):\n{link}\n"),
        ),
        (JobKind::EmailVerify, _) => (
            format!("{app} : confirme ton adresse email"),
            format!("Bienvenue !\n\nConfirme ton adresse email (lien valable 24 h) :\n{link}\n"),
        ),
        (JobKind::PasswordReset, "en") => (
            format!("{app}: reset your password"),
            format!("To choose a new password (link valid for 1 h):\n{link}\n\nIf you didn't ask for this, ignore this email.\n"),
        ),
        (JobKind::PasswordReset, "ar") => (
            format!("{app}: إعادة تعيين كلمة المرور"),
            format!("لاختيار كلمة مرور جديدة (الرابط صالح لمدة ساعة):\n{link}\n\nإذا لم تطلب ذلك، تجاهل هذا البريد.\n"),
        ),
        (JobKind::PasswordReset, _) => (
            format!("{app} : réinitialisation du mot de passe"),
            format!("Pour choisir un nouveau mot de passe (lien valable 1 h) :\n{link}\n\nSi tu n'as rien demandé, ignore cet email.\n"),
        ),
        (JobKind::AccountLocked, "en") => (
            format!("{app}: sign-in temporarily locked"),
            format!("Several sign-in attempts failed, so your account is temporarily locked.\nIf this wasn't you, change your password: {link}\n"),
        ),
        (JobKind::AccountLocked, "ar") => (
            format!("{app}: تم قفل تسجيل الدخول مؤقتًا"),
            format!("فشلت عدة محاولات لتسجيل الدخول، لذلك تم قفل حسابك مؤقتًا.\nإذا لم تكن أنت، غيّر كلمة المرور: {link}\n"),
        ),
        (JobKind::AccountLocked, _) => (
            format!("{app} : connexion bloquée temporairement"),
            format!("Plusieurs tentatives de connexion ont échoué. Ton compte est bloqué temporairement.\nSi ce n'était pas toi, change ton mot de passe : {link}\n"),
        ),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[tokio::test]
    async fn a_memory_mailer_keeps_what_it_is_given() {
        let mailer = Mailer::memory();
        mailer.send("a@example.com", "Hello", "Text").await.unwrap();
        assert_eq!(
            mailer.sent(),
            [Sent {
                to: "a@example.com".into(),
                subject: "Hello".into(),
                text: "Text".into()
            }]
        );
    }

    #[test]
    fn every_mail_exists_in_three_languages_and_falls_back_to_french() {
        for kind in [
            JobKind::EmailVerify,
            JobKind::PasswordReset,
            JobKind::AccountLocked,
        ] {
            let french = render(kind, "fr", "Fitness League", "https://x/y");
            let texts = ["en", "ar"].map(|locale| render(kind, locale, "Fitness League", "https://x/y"));
            assert_ne!(texts[0], french);
            assert_ne!(texts[1], french);
            assert_ne!(texts[0], texts[1]);
            assert_eq!(render(kind, "de", "Fitness League", "https://x/y"), french);
            for (subject, text) in [&french, &texts[0], &texts[1]] {
                assert!(subject.starts_with("Fitness League"), "{subject}");
                assert!(text.contains("https://x/y"), "{text}");
            }
        }
    }
}
```

- [ ] **Step 4: Write the worker's side of the links**

`src/modules/mod.rs`: add `pub mod auth;`. Create `src/modules/auth/mod.rs` with one line for now (Task 4 adds the routes):

```rust
pub mod emails;
```

Create `src/modules/auth/emails.rs`:

```rust
//! The links sent by email: confirming an address, choosing a new password.
//! The worker creates a link and sends it; the API consumes it. Only the hash of a token is stored,
//! and the token is never written to Redis or to a log.

use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::{
    db,
    jobs::{Job, JobKind},
    mail::{self, Mailer},
    security::tokens,
    state::AppState,
};

const VERIFY_HOURS: i64 = 24;
const RESET_HOURS: i64 = 1;

/// Runs one email job. Safe to run twice: the second run sends a second mail, whose link replaces
/// the first.
pub async fn handle(state: &AppState, mailer: &Mailer, job: Job) -> Result<(), String> {
    let describe = |e: sqlx::Error| db::describe(&e);
    let user = sqlx::query!(
        "SELECT u.email, u.status, u.email_verified_at, s.locale \
         FROM users u JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?",
        job.user_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(describe)?;
    // The account may have gone since the job was queued.
    let Some(user) = user.filter(|user| user.status != "DELETED") else {
        return Ok(());
    };
    let (purpose, path, hours) = match job.kind {
        JobKind::EmailVerify if user.email_verified_at.is_some() => return Ok(()),
        JobKind::EmailVerify => (Some("EMAIL_VERIFY"), "/verify-email", VERIFY_HOURS),
        JobKind::PasswordReset if user.status == "BANNED" => return Ok(()),
        JobKind::PasswordReset => (Some("PASSWORD_RESET"), "/reset-password", RESET_HOURS),
        JobKind::AccountLocked => (None, "/forgot-password", 0),
    };

    let mut link = format!("{}{path}", state.cfg.app_link_base_url);
    if let Some(purpose) = purpose {
        let (token, hash) = tokens::new_opaque().map_err(|_| "no random bytes".to_owned())?;
        let now = Utc::now().naive_utc();
        let mut tx = state.db.begin().await.map_err(describe)?;
        // A new link cancels the older ones.
        sqlx::query!(
            "UPDATE email_tokens SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL",
            now,
            job.user_id,
            purpose
        )
        .execute(&mut *tx)
        .await
        .map_err(describe)?;
        sqlx::query!(
            "INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            job.user_id,
            purpose,
            &hash[..],
            now + Duration::hours(hours)
        )
        .execute(&mut *tx)
        .await
        .map_err(describe)?;
        tx.commit().await.map_err(describe)?;
        link = format!("{link}?token={token}");
    }

    let (subject, text) = mail::render(job.kind, &user.locale, &state.cfg.app_name, &link);
    mailer.send(&user.email, &subject, &text).await
}
```

Append to `tests/common/mod.rs`:

```rust
/// Runs the worker until its queue is empty and returns the mails it sent.
pub async fn deliver_mail(app: &TestApp) -> Vec<backend::mail::Sent> {
    let mailer = backend::mail::Mailer::memory();
    let worker = backend::jobs::Worker::new(app.state.clone(), "test");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    while worker
        .tick(now, false, async |job| {
            backend::modules::auth::emails::handle(&app.state, &mailer, job).await
        })
        .await
        .expect("the queue answers")
        > 0
    {}
    mailer.sent()
}

/// The token carried by the link of a mail.
pub fn token_in(mail: &backend::mail::Sent) -> String {
    mail.text
        .split("token=")
        .nth(1)
        .expect("a link with a token")
        .split_whitespace()
        .next()
        .unwrap()
        .to_owned()
}
```

- [ ] **Step 5: The worker process, the TERM signal, the TLS warning**

`src/config.rs`, at the end of `plaintext_backends`, before `names` is returned:

```rust
        let smtp_in_clear = self.smtp_url.as_ref().is_some_and(|url| {
            let url = url.expose_secret();
            url.starts_with("smtp://") && !url.contains("tls=required")
        });
        if smtp_in_clear {
            names.push("SMTP");
        }
```

`src/main.rs`: change `USAGE` to `"usage: backend <serve|worker|migrate|seed [dir]|keys>"`, add the arm `Some("worker") => worker().await,`, replace the `with_graceful_shutdown(async { … })` argument of `serve` with `with_graceful_shutdown(shutdown())`, and add:

```rust
/// Ctrl-C, or the TERM signal that `docker stop` and process managers send.
async fn shutdown() {
    use tokio::signal::unix::{SignalKind, signal};
    match signal(SignalKind::terminate()) {
        Ok(mut term) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        }
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// Runs the background jobs. Any number of workers may run: each job goes to one of them.
async fn worker() -> Result<(), String> {
    let cfg = backend::config::Config::from_env()?;
    init_logging(&cfg.log_level);
    let state = backend::state::AppState::connect(cfg).await?;
    let mailer = backend::mail::Mailer::from_config(&state.cfg)?;
    let consumer = format!("worker-{}", uuid::Uuid::now_v7().simple());
    let jobs = backend::jobs::Worker::new(state.clone(), &consumer);
    tracing::info!(consumer, "worker started");
    let mut stop = std::pin::pin!(shutdown());
    loop {
        let tick = jobs.tick(now_ms(), true, async |job| {
            backend::modules::auth::emails::handle(&state, &mailer, job).await
        });
        tokio::select! {
            () = &mut stop => return Ok(()),
            outcome = tick => {
                if let Err(cause) = outcome {
                    tracing::error!(cause = %cause, "the worker cannot use its queue");
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }
}
```

A worker stopped in the middle of a job leaves it unacknowledged: another worker takes it over after a minute. That is the at-least-once rule at work, not a loss.

`apps/backend/.env.example`: after the `SMTP_URL` line add

```
MAIL_FROM=Fitness League <no-reply@fitnessleague.app>
# The base of the links sent by email.
APP_LINK_BASE_URL=http://localhost:8081
```

- [ ] **Step 6: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test mail --test emails --lib mail --lib config 2>&1 | grep -E "^test |test result"
```

Expected: `mail` 2 passed, `emails` 4 passed, the unit tests of `mail` (2) and `config` pass.

If `a_mail_goes_out_over_smtp` fails on the `token` assertion only, the library encoded the text (a `=` becomes `=3D`): the assertion on `verify-email?token` is written to hold either way, so look at what else differs in the printed message before touching the test.

- [ ] **Step 7: See a real mail in Mailpit**

With `SMTP_URL=smtp://127.0.0.1:1025` in `.env`:

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo run -q -- worker &
sleep 2 && kill %1
```

Expected: one log line `worker started`, and the process ends on the TERM signal within a second. (There is no account yet to send a mail to; the first real mail is checked by hand in Task 5.)

- [ ] **Step 8: Prepare, lint, commit**

Message: `feat(backend): mails over SMTP, the email jobs and the worker process`

---

### Task 4: Sessions, the two extractors, refresh and logout

**Files:**
- Create: `apps/backend/src/modules/auth/sessions.rs`, `src/modules/auth/accounts.rs`, `src/http/auth.rs`
- Modify: `apps/backend/src/modules/auth/mod.rs`, `src/http/mod.rs`, `apps/backend/tests/common/mod.rs`
- Test: unit test in `src/modules/auth/accounts.rs`; `apps/backend/tests/sessions.rs`

**Interfaces:**
- Consumes: `AppState.tokens`, `tokens::{new_opaque, hash_opaque, Audience, TokenError}`, `audit::record`, `rate_limit::{check, ClientIp, REFRESH_IP, GLOBAL_USER}`, `types::iso`, `ValidJson`, `Check`.
- Produces:
  - `sessions::Session { access_token, expires_in, refresh_token, user_id }` (serialises as `accessToken`, `expiresIn`, `refreshToken`, `userId`)
  - `sessions::Holder { id: Uuid, role: Role, session_version: i32 }`
  - `sessions::issue(state, tx: &mut MySqlConnection, holder: Holder, id: Uuid, family: Uuid, audience: Audience) -> Result<Session, AppError>`
  - `sessions::start(state, holder: Holder, audience: Audience) -> Result<Session, AppError>` (after a successful sign-in)
  - `sessions::refresh(state, refresh_token: &str, audience: Audience) -> Result<Session, AppError>`
  - `sessions::logout(state, user: Uuid, refresh_token: &str) -> Result<(), AppError>`
  - `sessions::revoke_family(db, family: Uuid)`, `sessions::revoke_all(db, user: Uuid)`, both `-> Result<(), sqlx::Error>`
  - `accounts::refuse_if_barred(status: &str, suspended_until: Option<NaiveDateTime>, now: NaiveDateTime) -> Result<(), AppError>`
  - `http::auth::AuthUser { id: Uuid, role: Role, email_verified: bool }`; the extractors `http::auth::AppUser(pub AuthUser)` (app token, every role but the judge roles) and `http::auth::PanelUser(pub AuthUser)` (admin token, panel roles)
  - `modules::auth::RefreshBody { pub refresh_token: String }` (body `{"refreshToken": "…"}`, 20 to 200 characters)
  - `modules::auth::routes(api: Api) -> Api`
  - Test helper `common::open_session(app, user, role, audience) -> Value`

Answers of the extractors, in the order they are checked:

| Situation | Status and code |
|---|---|
| No `Authorization: Bearer …` header | 401 `UNAUTHENTICATED` |
| Token expired | 401 `TOKEN_EXPIRED` |
| Token unreadable, wrong audience, wrong signature, unknown user, deleted user, old session version | 401 `TOKEN_INVALID` |
| Account banned | 403 `ACCOUNT_BANNED` |
| Account suspended (no end date, or one in the future) | 403 `ACCOUNT_SUSPENDED` with `suspendedUntil` |
| Role not allowed by the extractor | 403 `FORBIDDEN` |
| More than 120 requests in a minute by this user | 429 `RATE_LIMITED` |

- [ ] **Step 1: Write the failing tests**

Append to `tests/common/mod.rs`:

```rust
/// A session opened for an existing account, as a sign-in would open it.
pub async fn open_session(
    app: &TestApp,
    user: Uuid,
    role: backend::types::Role,
    audience: backend::security::tokens::Audience,
) -> Value {
    let holder = backend::modules::auth::sessions::Holder {
        id: user,
        role,
        session_version: 1,
    };
    let session = backend::modules::auth::sessions::start(&app.state, holder, audience)
        .await
        .expect("a session");
    serde_json::to_value(session).unwrap()
}
```

Create `apps/backend/tests/sessions.rs`:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::auth::sessions, security::tokens::Audience, types::Role};
use common::{Reply, TestApp, create_user, open_session, seeded, seeded_with};
use secrecy::ExposeSecret;
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn refresh(app: &TestApp, token: &str) -> Reply {
    app.post("/api/v1/auth/refresh", json!({"refreshToken": token}))
        .await
}

async fn logout(app: &TestApp, access: &str, refresh: &str) -> Reply {
    app.call(
        Method::POST,
        "/api/v1/auth/logout",
        Some(access),
        Some(json!({"refreshToken": refresh})),
    )
    .await
}

fn text(session: &Value, key: &str) -> String {
    session[key].as_str().unwrap().to_owned()
}

/// A user and an app session of theirs.
async fn signed_in(app: &TestApp, name: &str) -> (Uuid, Value) {
    let user = create_user(app, name, Role::User).await;
    (user, open_session(app, user, Role::User, Audience::App).await)
}

async fn set(app: &TestApp, user: Uuid, assignment: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE users SET {assignment} WHERE id = ?"
    )))
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

#[sqlx::test]
async fn a_session_has_the_four_fields_the_apps_read(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    assert_eq!(session.as_object().unwrap().len(), 4);
    assert_eq!(text(&session, "accessToken").split('.').count(), 3);
    assert_eq!(session["expiresIn"], 900);
    assert_eq!(text(&session, "refreshToken").len(), 43);
    assert_eq!(session["userId"], user.to_string());
    // Only the hash of the refresh token is stored.
    let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = ?")
        .bind(&backend::security::tokens::hash_opaque(&text(&session, "refreshToken"))[..])
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(stored, 1);
}

#[sqlx::test]
async fn a_refresh_replaces_the_token_and_a_second_use_revokes_the_family(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, first) = signed_in(&app, "ahmed").await;

    let second = refresh(&app, &text(&first, "refreshToken")).await;
    assert_eq!(second.status, StatusCode::OK);
    assert_ne!(second.json["refreshToken"], first["refreshToken"]);
    assert_eq!(second.json["userId"], user.to_string());

    // The first token again: it was copied. Everything descended from that sign-in ends.
    let replay = refresh(&app, &text(&first, "refreshToken")).await;
    assert_eq!(replay.status, StatusCode::UNAUTHORIZED);
    assert_eq!(replay.json["code"], "TOKEN_REUSED");
    let after = refresh(&app, &text(&second.json, "refreshToken")).await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);
    assert_eq!(after.json["code"], "TOKEN_INVALID");

    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'REFRESH_TOKEN_REUSE_DETECTED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[sqlx::test]
async fn of_two_refreshes_at_the_same_instant_one_wins(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let token = text(&session, "refreshToken");

    let (a, b) = tokio::join!(refresh(&app, &token), refresh(&app, &token));
    let (winner, loser) = if a.status == StatusCode::OK { (a, b) } else { (b, a) };
    assert_eq!(winner.status, StatusCode::OK);
    assert_eq!(loser.status, StatusCode::UNAUTHORIZED);
    assert_eq!(loser.json["code"], "TOKEN_REUSED");
    // The copy was noticed: the winner's new token is revoked with the rest of the family.
    let next = refresh(&app, &text(&winner.json, "refreshToken")).await;
    assert_eq!(next.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn a_refresh_token_only_works_for_its_own_audience(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let token = text(&session, "refreshToken");

    let err = sessions::refresh(&app.state, &token, Audience::Admin)
        .await
        .unwrap_err();
    assert_eq!((err.status, err.code), (StatusCode::UNAUTHORIZED, "TOKEN_INVALID"));
    // The mistake did not use the token up.
    assert_eq!(refresh(&app, &token).await.status, StatusCode::OK);
}

#[sqlx::test]
async fn an_expired_or_unknown_refresh_token_is_refused(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    sqlx::query("UPDATE refresh_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let expired = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(expired.status, StatusCode::UNAUTHORIZED);
    assert_eq!(expired.json["code"], "TOKEN_EXPIRED");

    let unknown = refresh(&app, &"x".repeat(43)).await;
    assert_eq!(unknown.json["code"], "TOKEN_INVALID");
    let short = refresh(&app, "too-short").await;
    assert_eq!(short.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(short.json["errors"], json!([{"field": "refreshToken", "code": "MINLENGTH"}]));
}

#[sqlx::test]
async fn a_banned_account_cannot_refresh_and_loses_the_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    set(&app, user, "status = 'BANNED'").await;
    let banned = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(banned.status, StatusCode::FORBIDDEN);
    assert_eq!(banned.json["code"], "ACCOUNT_BANNED");

    // Lifting the ban does not bring the old session back.
    set(&app, user, "status = 'ACTIVE'").await;
    let after = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(after.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn logout_ends_ones_own_session_and_no_one_elses(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, mine) = signed_in(&app, "ahmed").await;
    let (_, theirs) = signed_in(&app, "leila").await;

    // Someone else's refresh token: the same quiet answer, and nothing happens to it.
    let quiet = logout(&app, &text(&mine, "accessToken"), &text(&theirs, "refreshToken")).await;
    assert_eq!(quiet.status, StatusCode::NO_CONTENT);
    assert_eq!(refresh(&app, &text(&theirs, "refreshToken")).await.status, StatusCode::OK);

    let done = logout(&app, &text(&mine, "accessToken"), &text(&mine, "refreshToken")).await;
    assert_eq!(done.status, StatusCode::NO_CONTENT);
    let after = refresh(&app, &text(&mine, "refreshToken")).await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);
    assert_eq!(after.json["code"], "TOKEN_INVALID");
}

/// A token signed with the application's key whose life ended a minute ago.
fn expired_token(app: &TestApp, user: Uuid) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::EdDSA);
    header.kid = Some("k1".to_owned());
    let claims = json!({"sub": user.to_string(), "role": "USER", "sv": 1, "aud": "app", "iss": "fitness-league", "iat": now - 960, "exp": now - 60});
    let key = jsonwebtoken::EncodingKey::from_ed_pem(
        app.state.cfg.jwt_private_key_pem.expose_secret().as_bytes(),
    )
    .unwrap();
    jsonwebtoken::encode(&header, &claims, &key).unwrap()
}

#[sqlx::test]
async fn a_protected_route_wants_a_valid_token_of_its_own_audience(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    let body = || Some(json!({"refreshToken": "x".repeat(43)}));
    let with = |token: Option<String>| {
        let app = &app;
        async move {
            app.call(Method::POST, "/api/v1/auth/logout", token.as_deref(), body())
                .await
        }
    };

    let none = with(None).await;
    assert_eq!((none.status, none.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("UNAUTHENTICATED")));
    let garbage = with(Some("not.a.token".into())).await;
    assert_eq!((garbage.status, garbage.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")));
    let expired = with(Some(expired_token(&app, user))).await;
    assert_eq!((expired.status, expired.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_EXPIRED")));

    // A token of the admin panel is not a token of the app.
    let panel = open_session(&app, user, Role::User, Audience::Admin).await;
    let wrong = with(Some(text(&panel, "accessToken"))).await;
    assert_eq!((wrong.status, wrong.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")));

    assert_eq!(with(Some(text(&session, "accessToken"))).await.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn a_change_to_the_account_applies_on_the_very_next_request(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    let access = text(&session, "accessToken");
    let call = || logout(&app, &access, &"x".repeat(43));
    assert_eq!(call().await.status, StatusCode::NO_CONTENT);

    set(&app, user, "status = 'SUSPENDED', suspended_until = UTC_TIMESTAMP(6) + INTERVAL 1 DAY").await;
    let suspended = call().await;
    assert_eq!(suspended.status, StatusCode::FORBIDDEN);
    assert_eq!(suspended.json["code"], "ACCOUNT_SUSPENDED");
    assert!(suspended.json["suspendedUntil"].is_string());

    // A suspension that is over no longer refuses anyone.
    set(&app, user, "suspended_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND").await;
    assert_eq!(call().await.status, StatusCode::NO_CONTENT);

    set(&app, user, "status = 'BANNED'").await;
    assert_eq!(call().await.json["code"], "ACCOUNT_BANNED");

    // What a password reset or a role change does: every token signed before it is dead.
    set(&app, user, "status = 'ACTIVE', session_version = session_version + 1").await;
    let stale = call().await;
    assert_eq!((stale.status, stale.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")));

    set(&app, user, "session_version = 1, status = 'DELETED'").await;
    assert_eq!(call().await.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn a_judge_cannot_use_an_app_route_even_with_an_app_token(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let judge = create_user(&app, "judge", Role::Judge).await;
    // The sign-in refuses judges (Task 6); a token minted some other way is refused here too.
    let session = open_session(&app, judge, Role::Judge, Audience::App).await;
    let refused = logout(&app, &text(&session, "accessToken"), &"x".repeat(43)).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "FORBIDDEN");
}

#[sqlx::test]
async fn the_limits_of_a_user_and_of_the_refresh_route(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let access = text(&session, "accessToken");

    // 120 a minute per signed-in user. The count is a sliding estimate: allow a few more.
    let mut refused = None;
    for _ in 0..130 {
        let reply = logout(&app, &access, &"x".repeat(43)).await;
        if reply.status != StatusCode::NO_CONTENT {
            refused = Some(reply);
            break;
        }
    }
    let refused = refused.expect("130 requests of one user were all allowed");
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(refused.headers.contains_key("retry-after"));

    // 30 a minute per address on the refresh route, whatever the answers were.
    let mut statuses = Vec::new();
    for _ in 0..36 {
        statuses.push(
            app.send(
                common::request(Method::POST, "/api/v1/auth/refresh")
                    .extension(common::from_ip([8, 8, 4, 4]))
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(json!({"refreshToken": "x".repeat(43)}).to_string()))
                    .unwrap(),
            )
            .await
            .status,
        );
    }
    assert_eq!(statuses[..30], [StatusCode::UNAUTHORIZED; 30]);
    assert!(statuses[30..].contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test sessions 2>&1 | tail -5
```

Expected: does not compile, `could not find sessions in auth`.

- [ ] **Step 3: Write `accounts.rs` with the one rule this task needs**

Create `src/modules/auth/accounts.rs`:

```rust
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
```

- [ ] **Step 4: Write the sessions**

Create `src/modules/auth/sessions.rs`:

```rust
//! Sessions: a short access token and a single-use refresh token.
//!
//! Every use of a refresh token replaces it. A token presented a second time was copied: the whole
//! family (every token descended from one sign-in) is revoked. Only the hash of a token is stored.

use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{MySqlConnection, MySqlExecutor};
use uuid::Uuid;

use super::accounts;
use crate::{
    audit,
    error::AppError,
    security::tokens::{self, Audience},
    state::AppState,
    types::Role,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    /// Seconds until the access token expires.
    pub expires_in: u64,
    pub refresh_token: String,
    pub user_id: String,
}

/// Who a session is for. The role and the session version are copied into the access token.
#[derive(Debug, Clone, Copy)]
pub struct Holder {
    pub id: Uuid,
    pub role: Role,
    pub session_version: i32,
}

/// Stores a new refresh token under `id` in `family` and signs the access token that goes with it.
pub async fn issue(
    state: &AppState,
    tx: &mut MySqlConnection,
    holder: Holder,
    id: Uuid,
    family: Uuid,
    audience: Audience,
) -> Result<Session, AppError> {
    let (refresh_token, hash) = tokens::new_opaque()?;
    let expires_at = Utc::now().naive_utc() + Duration::days(state.cfg.refresh_token_ttl_days);
    sqlx::query!(
        "INSERT INTO refresh_tokens (id, user_id, family_id, audience, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        holder.id,
        family,
        audience.as_str(),
        &hash[..],
        expires_at
    )
    .execute(&mut *tx)
    .await?;
    let (access_token, expires_in) =
        state
            .tokens
            .sign_access(holder.id, holder.role, holder.session_version, audience)?;
    Ok(Session {
        access_token,
        expires_in,
        refresh_token,
        user_id: holder.id.to_string(),
    })
}

/// Opens a session after a successful sign-in. The failure counter is cleared, and an account
/// deletion that was waiting out its grace period is cancelled: signing in again is how one changes
/// one's mind.
pub async fn start(state: &AppState, holder: Holder, audience: Audience) -> Result<Session, AppError> {
    let now = Utc::now().naive_utc();
    let mut tx = state.db.begin().await?;
    sqlx::query!(
        "UPDATE deletion_requests SET status = 'CANCELLED' WHERE user_id = ? AND status = 'PENDING'",
        holder.id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
        now,
        holder.id
    )
    .execute(&mut *tx)
    .await?;
    let session = issue(state, &mut *tx, holder, Uuid::now_v7(), Uuid::now_v7(), audience).await?;
    tx.commit().await?;
    Ok(session)
}

pub async fn revoke_family<'e>(db: impl MySqlExecutor<'e>, family: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE family_id = ? AND revoked_at IS NULL",
        family
    )
    .execute(db)
    .await
    .map(|_| ())
}

/// Ends every session of an account. The caller also increments `users.session_version`, which
/// kills the access tokens already handed out.
pub async fn revoke_all<'e>(db: impl MySqlExecutor<'e>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND revoked_at IS NULL",
        user
    )
    .execute(db)
    .await
    .map(|_| ())
}

/// The token was copied: every session descended from that sign-in ends, and the event is recorded.
async fn reused(state: &AppState, user: Uuid, family: Uuid) -> AppError {
    let recorded = async {
        revoke_family(&state.db, family).await?;
        let event = audit::Event {
            actor: None,
            action: "REFRESH_TOKEN_REUSE_DETECTED",
            user_id: user,
            after: Some(json!({"familyId": family.to_string()})),
        };
        audit::record(&state.db, event).await
    };
    if let Err(e) = recorded.await {
        return e.into();
    }
    tracing::warn!(user_id = %user, "refresh token reuse detected; the session family is revoked");
    AppError::unauthenticated("TOKEN_REUSED", "Invalid refresh token")
}

pub async fn refresh(
    state: &AppState,
    refresh_token: &str,
    audience: Audience,
) -> Result<Session, AppError> {
    let invalid = || AppError::unauthenticated("TOKEN_INVALID", "Invalid refresh token");
    let hash = tokens::hash_opaque(refresh_token);
    let row = sqlx::query!(
        r#"SELECT t.id AS "id: Uuid", t.user_id AS "user_id: Uuid", t.family_id AS "family_id: Uuid",
                  t.audience, t.replaced_by_id AS "replaced_by_id: Uuid", t.expires_at, t.revoked_at,
                  u.role AS "role: Role", u.status, u.session_version, u.suspended_until
           FROM refresh_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ?"#,
        &hash[..]
    )
    .fetch_optional(&state.db)
    .await?;
    // Each refresh endpoint accepts its own kind of session only.
    let Some(row) = row.filter(|row| row.audience == audience.as_str()) else {
        return Err(invalid());
    };
    let now = Utc::now().naive_utc();
    if row.revoked_at.is_some() {
        // Revoked because it was used: someone holds a copy.
        if row.replaced_by_id.is_some() {
            return Err(reused(state, row.user_id, row.family_id).await);
        }
        return Err(invalid());
    }
    if row.expires_at <= now {
        return Err(AppError::unauthenticated(
            "TOKEN_EXPIRED",
            "Refresh token expired",
        ));
    }
    if row.status == "DELETED" {
        return Err(invalid());
    }
    if let Err(barred) = accounts::refuse_if_barred(&row.status, row.suspended_until, now) {
        revoke_family(&state.db, row.family_id).await?;
        return Err(barred);
    }

    let new_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    // Conditional: of two refreshes with the same token, one changes the row and the other does not.
    let won = sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ? AND revoked_at IS NULL",
        now,
        new_id,
        row.id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if !won {
        drop(tx);
        return Err(reused(state, row.user_id, row.family_id).await);
    }
    let holder = Holder {
        id: row.user_id,
        role: row.role,
        session_version: row.session_version,
    };
    let session = issue(state, &mut *tx, holder, new_id, row.family_id, audience).await?;
    tx.commit().await?;
    Ok(session)
}

/// Ends the session a refresh token belongs to. A token of someone else, or one that does not
/// exist, changes nothing and gets the same answer: the route must not tell whether a token exists.
pub async fn logout(state: &AppState, user: Uuid, refresh_token: &str) -> Result<(), AppError> {
    let hash = tokens::hash_opaque(refresh_token);
    let family = sqlx::query_scalar!(
        r#"SELECT family_id AS "family_id: Uuid" FROM refresh_tokens WHERE token_hash = ? AND user_id = ?"#,
        &hash[..],
        user
    )
    .fetch_optional(&state.db)
    .await?;
    if let Some(family) = family {
        revoke_family(&state.db, family).await?;
    }
    Ok(())
}
```

- [ ] **Step 5: Write the extractors**

Add `pub mod auth;` next to `pub mod rate_limit;` in `src/http/mod.rs`. Create `src/http/auth.rs`:

```rust
//! Who is calling. A handler obtains the signed-in user only through one of these extractors, and
//! the type it asks for names who may pass. There is no way to read the user without choosing one.

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use chrono::Utc;
use uuid::Uuid;

use super::rate_limit;
use crate::{
    error::AppError,
    modules::auth::accounts,
    security::tokens::{Audience, TokenError},
    state::AppState,
    types::Role,
};

pub struct AuthUser {
    pub id: Uuid,
    pub role: Role,
    pub email_verified: bool,
}

/// A signed-in account of the app: every role except the judge roles, which only exist in the panel.
pub struct AppUser(pub AuthUser);

/// Someone signed in to the admin panel: staff, and judges.
pub struct PanelUser(pub AuthUser);

impl FromRequestParts<AppState> for AppUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        authenticate(parts, state, Audience::App, |role| !role.is_judge())
            .await
            .map(Self)
    }
}

impl FromRequestParts<AppState> for PanelUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        authenticate(parts, state, Audience::Admin, Role::can_open_panel)
            .await
            .map(Self)
    }
}

/// The token proves who signed in; the row read here says what they are today. A ban, a role change
/// or a password reset therefore applies on the very next request, without waiting for the token to
/// expire.
async fn authenticate(
    parts: &Parts,
    state: &AppState,
    audience: Audience,
    allowed: fn(Role) -> bool,
) -> Result<AuthUser, AppError> {
    let invalid = || AppError::unauthenticated("TOKEN_INVALID", "Invalid access token");
    let token = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("UNAUTHENTICATED", "Authentication required"))?;
    let claims = state
        .tokens
        .verify_access(token, audience)
        .map_err(|e| match e {
            TokenError::Expired => {
                AppError::unauthenticated("TOKEN_EXPIRED", "Invalid access token")
            }
            TokenError::Invalid => invalid(),
        })?;
    let user = sqlx::query!(
        r#"SELECT role AS "role: Role", status, session_version, email_verified_at, suspended_until
           FROM users WHERE id = ?"#,
        claims.user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(invalid)?;
    if user.status == "DELETED" || user.session_version != claims.session_version {
        return Err(invalid());
    }
    accounts::refuse_if_barred(&user.status, user.suspended_until, Utc::now().naive_utc())?;
    // The role of the row, not of the token.
    if !allowed(user.role) {
        return Err(AppError::forbidden());
    }
    rate_limit::check(state, &rate_limit::GLOBAL_USER, &claims.user_id.to_string()).await?;
    tracing::Span::current().record("user_id", tracing::field::display(claims.user_id));
    Ok(AuthUser {
        id: claims.user_id,
        role: user.role,
        email_verified: user.email_verified_at.is_some(),
    })
}
```

- [ ] **Step 6: Write the two routes**

Replace `src/modules/auth/mod.rs` with:

```rust
//! `/auth/*`: registration, sign-in, sessions and the links sent by email.

pub mod accounts;
pub mod emails;
pub mod sessions;

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;

use self::sessions::Session;
use crate::{
    error::AppError,
    http::{
        Api,
        auth::AppUser,
        rate_limit::{self, ClientIp},
    },
    security::tokens::Audience,
    state::AppState,
    validate::{Check, ValidJson, Validate},
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/auth/refresh", refresh)
        .post("/api/v1/auth/logout", logout)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefreshBody {
    pub refresh_token: String,
}

impl Validate for RefreshBody {
    fn validate(&self, check: &mut Check) {
        check.length("refreshToken", &self.refresh_token, 20, 200);
    }
}

async fn refresh(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<Json<Session>, AppError> {
    rate_limit::check(&state, &rate_limit::REFRESH_IP, &client.subject()).await?;
    Ok(Json(
        sessions::refresh(&state, &body.refresh_token, Audience::App).await?,
    ))
}

async fn logout(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<StatusCode, AppError> {
    sessions::logout(&state, user.id, &body.refresh_token).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

In `src/http/mod.rs`, `api()` becomes:

```rust
fn api() -> Api {
    let api = modules::health::routes(Api::new());
    let api = modules::reference::routes(api);
    modules::auth::routes(api)
}
```

The refresh route counts the request before it looks at the token, so a refused token still counts: that is what bounds guessing.

- [ ] **Step 7: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test sessions --lib accounts 2>&1 | grep -E "^test |test result"
```

Expected: 12 integration tests and 1 unit test pass.

- [ ] **Step 8: Prepare, lint, commit**

Message: `feat(backend): sessions with single-use refresh tokens, the AppUser and PanelUser extractors, refresh and logout`

---

<!-- END -->
