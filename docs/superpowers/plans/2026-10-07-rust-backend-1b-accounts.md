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
- **Reading a SQL condition in a test:** `x IS NOT NULL` comes back as an integer. If sqlx refuses to read it as `bool`, read it as `i64` and compare with 0; this is a change to how the test reads, not to what it expects.
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

Expected: `test result: ok.` with 65 tests (58 before, 7 added).

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

A job is written as JSON with its user id, so the `uuid` crate needs its `serde` feature. In `apps/backend/Cargo.toml`:

```toml
uuid = { version = "1", features = ["serde", "v7"] }
```

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
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test jobs 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib jobs:: 2>&1 | grep -E "^test |test result"
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
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test mail --test emails 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib mail:: 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib config:: 2>&1 | grep -E "test result"
```

Expected: `mail` 2 passed, `emails` 4 passed, the unit tests of `mail` (2) and `config` pass.

If `a_mail_goes_out_over_smtp` fails on the `token` assertion only, the library encoded the text (a `=` becomes `=3D`): the assertion on `verify-email?token` is written to hold either way, so look at what else differs in the printed message before touching the test.

- [ ] **Step 7: See a real mail in Mailpit**

With `SMTP_URL=smtp://127.0.0.1:1025` in `.env`:

Start `cargo run -q -- worker` in a second terminal (or in the background, noting its process id), wait for its first log line, then send it the TERM signal: `kill <pid>`.

Expected: one log line `worker started`, and the process ends within a second of the signal. (There is no account yet to send a mail to; the first real mail is checked by hand in Task 5.)

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
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test sessions 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib accounts:: 2>&1 | grep -E "^test |test result"
```

Expected: 12 integration tests and 1 unit test pass.

- [ ] **Step 8: Prepare, lint, commit**

Message: `feat(backend): sessions with single-use refresh tokens, the AppUser and PanelUser extractors, refresh and logout`

---

### Task 5: Registration

**Files:**
- Modify: `apps/backend/src/types.rs`, `src/modules/auth/mod.rs`, `src/modules/auth/accounts.rs`, `apps/backend/tests/common/mod.rs`, `apps/backend/tests/http_shell.rs`
- Test: unit test in `src/modules/auth/mod.rs`; `apps/backend/tests/register.rs`

**Interfaces:**
- Consumes: `normalise_email`, `password_problem`, `Passwords::hash`, `Rules::active`, `policy::{age_in_years, business_today}`, `db::duplicate_key`, `audit::record`, `sessions::{issue, Holder, Session}`, `jobs::enqueue`, `rate_limit::REGISTER_IP`.
- Produces:
  - `types::Gender { Male, Female, Undisclosed }` and `types::Locale { Fr, En, Ar }`, each with `as_str`
  - `accounts::Registration { … }` and `accounts::register(state, registration) -> Result<Session, AppError>`
  - Route `POST /api/v1/auth/register` → 201 and a session
  - Test helpers: `common::registration(app, name) -> Value`, `common::register(app, name) -> Value`, `common::post_from(app, ip, path, body) -> Reply`, `common::host_port(url) -> &str`, `common::seeded_with_cuttable_redis(opts, conn, tweak) -> (TestApp, JoinHandle<()>)`

The body, as the app sends it (`phone`, `gender`, `locale` and `consents.marketing` are optional):

```json
{"username": "ahmed_fit", "fullName": "Ahmed Ben Salah", "email": "ahmed@example.com", "password": "…",
 "dateOfBirth": "1998-04-12", "countryCode": "TN", "governorateId": "…", "cityId": "…", "locale": "fr",
 "consents": {"terms": true, "privacy": true, "healthData": false, "documentVersion": "2026-09"}}
```

| Rule | Answer |
|---|---|
| `username`: 3 to 20 of `a-z 0-9 _ .` | 422 field `username`, code `MATCHES` |
| `fullName`: 2 to 80 characters once trimmed, no control character | `fullName`: `MINLENGTH`, `MAXLENGTH` or `MATCHES` |
| `email`: see ruling 1 | `email`: `ISEMAIL` |
| `password`: 10 to 128 characters; not on the common list, not the email, not the username | `password`: `MINLENGTH`, `MAXLENGTH` or `TOO_COMMON` |
| `dateOfBirth`: `YYYY-MM-DD`, a real date, 1900 or later | `dateOfBirth`: `ISISO8601` |
| `countryCode`: two capital letters | `countryCode`: `MATCHES` |
| `phone`: `+` and 8 to 15 digits, not starting with 0 | `phone`: `MATCHES` |
| `consents.terms` and `consents.privacy` are `true` | `consents.terms`, `consents.privacy`: `EQUALS` |
| `consents.documentVersion`: 1 to 20 characters | `consents.documentVersion`: `MINLENGTH` or `MAXLENGTH` |
| A value of the wrong type, or not one of an enumeration | the field, code `INVALID` |
| A field that is not in the list | the field, code `UNKNOWN_FIELD` |
| Younger than the minimum age of the active rule set | 422 `UNDER_AGE` with `minAgeYears`; nothing is stored |
| The city is not in the governorate, or the country is not open | 422 field `cityId`, code `NOT_IN_GOVERNORATE` |
| The email, the username or the phone is taken | 409 `EMAIL_TAKEN`, `USERNAME_TAKEN`, `PHONE_TAKEN` |
| More than 5 registrations in an hour from one address | 429 `RATE_LIMITED` |

- [ ] **Step 1: Add the shared helpers**

In `tests/http_shell.rs`, delete the local `host_port` function and import it: `use common::{TestApp, host_port, request};`.

Append to `tests/common/mod.rs` (add `use serde_json::json;` to its imports):

```rust
/// `host:port` of a `scheme://[credentials@]host:port[/path]` URL.
pub fn host_port(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let rest = rest.rsplit_once('@').map_or(rest, |(_, rest)| rest);
    rest.split('/').next().unwrap_or(rest)
}

/// A seeded app whose Redis goes through a relay. Abort the returned task and await it: Redis is gone.
pub async fn seeded_with_cuttable_redis(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
    tweak: impl FnOnce(&mut HashMap<String, String>),
) -> (TestApp, tokio::task::JoinHandle<()>) {
    let real = std::env::var("TEST_REDIS_URL").expect("TEST_REDIS_URL");
    let target = host_port(&real).to_owned();
    let (address, relay) = relay("127.0.0.1:0", target.clone()).await;
    let app = seeded_with(opts, conn, |vars| {
        vars.insert(
            "REDIS_URL".into(),
            real.replacen(&target, &address.to_string(), 1),
        );
        tweak(vars);
    })
    .await;
    (app, relay)
}

/// A JSON POST that comes from `ip`.
pub async fn post_from(app: &TestApp, ip: [u8; 4], path: &str, body: Value) -> Reply {
    app.send(
        request(Method::POST, path)
            .extension(from_ip(ip))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
}

/// A registration body that passes every rule. A test changes the field it is about.
pub async fn registration(app: &TestApp, name: &str) -> Value {
    let (governorate, city) = a_place(app).await;
    json!({
        "username": name,
        "fullName": format!("Athlete {name}"),
        "email": format!("{name}@example.com"),
        "password": PASSWORD,
        "dateOfBirth": "1995-05-05",
        "countryCode": "TN",
        "governorateId": governorate.to_string(),
        "cityId": city.to_string(),
        "locale": "fr",
        "consents": {"terms": true, "privacy": true, "healthData": false, "documentVersion": "2026-09"}
    })
}

/// Registers `name` through the API and returns the session.
pub async fn register(app: &TestApp, name: &str) -> Value {
    let reply = app
        .post("/api/v1/auth/register", registration(app, name).await)
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    reply.json
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/backend/tests/register.rs` with the editor (it contains SQL keywords as test data):

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::security::policy::business_today;
use chrono::{Days, Months, Utc};
use common::{
    PASSWORD, TestApp, deliver_mail, post_from, register, registration, seeded, seeded_with,
    seeded_with_cuttable_redis,
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

const REGISTER: &str = "/api/v1/auth/register";

async fn count(app: &TestApp, table: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
        .fetch_one(&app.db)
        .await
        .unwrap()
}

/// `registration` with some fields replaced.
async fn body_with(app: &TestApp, name: &str, changes: Value) -> Value {
    let mut body = registration(app, name).await;
    for (key, value) in changes.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

fn codes(reply: &common::Reply) -> Vec<(String, String)> {
    reply.json["errors"]
        .as_array()
        .unwrap_or_else(|| panic!("no field errors in {} {}", reply.status, reply.json))
        .iter()
        .map(|e| (e["field"].as_str().unwrap().to_owned(), e["code"].as_str().unwrap().to_owned()))
        .collect()
}

#[sqlx::test]
async fn a_registration_opens_a_session_and_creates_every_row(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let body = body_with(
        &app,
        "ahmed",
        json!({"email": "  Ahmed@Example.COM ", "fullName": "  Ahmed Ben Salah ", "consents": {"terms": true, "privacy": true, "healthData": true, "documentVersion": "2026-09"}}),
    )
    .await;
    let reply = app.post(REGISTER, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json.as_object().unwrap().len(), 4);
    let user = reply.json["userId"].as_str().unwrap().to_owned();

    let (email, role, status, verified, hash): (String, String, String, bool, String) = sqlx::query_as(
        "SELECT email, role, status, email_verified_at IS NOT NULL, password_hash FROM users",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!((email.as_str(), role.as_str(), status.as_str(), verified), ("ahmed@example.com", "USER", "ACTIVE", false));
    assert!(hash.starts_with("$argon2id$"), "{hash}");
    assert!(!hash.contains(PASSWORD));

    let (name, country, locale, level, division): (String, String, String, i32, Option<String>) = sqlx::query_as(
        "SELECT p.full_name, p.country_code, s.locale, t.level, t.division_code \
         FROM profiles p JOIN user_settings s USING (user_id) JOIN user_stats t USING (user_id) JOIN user_streaks k USING (user_id)",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!((name.as_str(), country.as_str(), locale.as_str(), level, division), ("Ahmed Ben Salah", "TN", "fr", 1, None));

    let consents: Vec<(String, bool, String)> =
        sqlx::query_as("SELECT type, granted, document_version FROM consents ORDER BY type")
            .fetch_all(&app.db)
            .await
            .unwrap();
    let granted: Vec<(&str, bool)> = consents.iter().map(|(t, g, _)| (t.as_str(), *g)).collect();
    assert_eq!(granted, [("TERMS", true), ("PRIVACY", true), ("HEALTH_DATA", true), ("MARKETING", false)]);
    assert!(consents.iter().all(|(_, _, version)| version == "2026-09"));

    let audited: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'USER_REGISTERED' AND HEX(entity_id) = REPLACE(UPPER(?), '-', '')")
        .bind(&user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(audited, 1);

    // The verification mail is the worker's business.
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");

    // The session works at once.
    let logout = app
        .call(
            Method::POST,
            "/api/v1/auth/logout",
            reply.json["accessToken"].as_str(),
            Some(json!({"refreshToken": reply.json["refreshToken"]})),
        )
        .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn a_taken_email_or_username_is_named(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;

    let same_email = body_with(&app, "other", json!({"email": "AHMED@example.com"})).await;
    let reply = app.post(REGISTER, same_email).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::CONFLICT, Some("EMAIL_TAKEN")));

    let same_username = body_with(&app, "ahmed", json!({"email": "someone.else@example.com"})).await;
    let reply = app.post(REGISTER, same_username).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::CONFLICT, Some("USERNAME_TAKEN")));

    // Both taken: the email is named.
    let reply = app.post(REGISTER, registration(&app, "ahmed").await).await;
    assert_eq!(reply.json["code"], "EMAIL_TAKEN");

    let with_phone = body_with(&app, "leila", json!({"phone": "+21620123456"})).await;
    assert_eq!(app.post(REGISTER, with_phone).await.status, StatusCode::CREATED);
    let same_phone = body_with(&app, "sami", json!({"phone": "+21620123456"})).await;
    assert_eq!(app.post(REGISTER, same_phone).await.json["code"], "PHONE_TAKEN");

    assert_eq!(count(&app, "users").await, 2);
    assert_eq!(count(&app, "profiles").await, 2);
}

#[sqlx::test]
async fn someone_under_the_minimum_age_is_refused_and_nothing_is_stored(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    // Today in Tunisia, which is where the age is counted.
    let today = business_today(Utc::now(), 60);
    let eighteen_tomorrow = (today + Days::new(1)) - Months::new(18 * 12);
    let eighteen_today = today - Months::new(18 * 12);

    let too_young = body_with(&app, "young", json!({"dateOfBirth": eighteen_tomorrow.to_string()})).await;
    let reply = app.post(REGISTER, too_young).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json["code"], "UNDER_AGE");
    assert_eq!(reply.json["minAgeYears"], 18);
    for table in ["users", "profiles", "consents", "audit_log", "refresh_tokens"] {
        assert_eq!(count(&app, table).await, 0, "{table}");
    }
    assert!(deliver_mail(&app).await.is_empty());

    let born_tomorrow = body_with(&app, "unborn", json!({"dateOfBirth": (today + Days::new(1)).to_string()})).await;
    assert_eq!(app.post(REGISTER, born_tomorrow).await.json["code"], "UNDER_AGE");

    let just_old_enough = body_with(&app, "adult", json!({"dateOfBirth": eighteen_today.to_string()})).await;
    assert_eq!(app.post(REGISTER, just_old_enough).await.status, StatusCode::CREATED);
}

#[sqlx::test]
async fn every_field_is_checked_and_all_the_problems_come_at_once(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let bad = body_with(
        &app,
        "ahmed",
        json!({
            "username": "Ahmed!",
            "fullName": " A ",
            "email": "ren\u{00E9}@example.com",
            "password": "short",
            "dateOfBirth": "12/04/1998",
            "countryCode": "tn",
            "phone": "0620123456",
            "consents": {"terms": false, "privacy": false, "healthData": false, "documentVersion": ""}
        }),
    )
    .await;
    let reply = app.post(REGISTER, bad).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    let expected = [
        ("username", "MATCHES"),
        ("fullName", "MINLENGTH"),
        ("email", "ISEMAIL"),
        ("password", "MINLENGTH"),
        ("dateOfBirth", "ISISO8601"),
        ("countryCode", "MATCHES"),
        ("phone", "MATCHES"),
        ("consents.terms", "EQUALS"),
        ("consents.privacy", "EQUALS"),
        ("consents.documentVersion", "MINLENGTH"),
    ];
    let got = codes(&reply);
    let got: Vec<(&str, &str)> = got.iter().map(|(f, c)| (f.as_str(), c.as_str())).collect();
    assert_eq!(got, expected);

    // One problem at a time, for the rules the list above does not reach.
    let one = |changes: Value| {
        let app = &app;
        async move {
            let reply = app.post(REGISTER, body_with(app, "ahmed", changes).await).await;
            assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", reply.json);
            codes(&reply)
        }
    };
    let single = |field: &str, code: &str| vec![(field.to_owned(), code.to_owned())];
    assert_eq!(one(json!({"role": "ADMIN"})).await, single("role", "UNKNOWN_FIELD"));
    assert_eq!(one(json!({"password": "1234567890"})).await, single("password", "TOO_COMMON"));
    assert_eq!(one(json!({"password": "Ahmed@Example.com"})).await, single("password", "TOO_COMMON"));
    assert_eq!(one(json!({"password": "x".repeat(129)})).await, single("password", "MAXLENGTH"));
    assert_eq!(one(json!({"gender": "ROBOT"})).await, single("gender", "INVALID"));
    assert_eq!(one(json!({"governorateId": "not-an-id"})).await, single("governorateId", "INVALID"));
    assert_eq!(one(json!({"dateOfBirth": "2001-02-30"})).await, single("dateOfBirth", "ISISO8601"));
    assert_eq!(one(json!({"dateOfBirth": "1899-12-31"})).await, single("dateOfBirth", "ISISO8601"));
    assert_eq!(one(json!({"fullName": "Ahmed\u{0007}Bell"})).await, single("fullName", "MATCHES"));

    // A city of another governorate.
    let (_, elsewhere): (uuid::Uuid, uuid::Uuid) = sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id ORDER BY g.code DESC, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(one(json!({"cityId": elsewhere.to_string()})).await, single("cityId", "NOT_IN_GOVERNORATE"));
    assert_eq!(one(json!({"countryCode": "FR"})).await, single("cityId", "NOT_IN_GOVERNORATE"));

    assert_eq!(count(&app, "users").await, 0);
}

#[sqlx::test]
async fn text_is_stored_exactly_as_it_was_sent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let names = [
        "Robert'); DROP TABLE users;-- ",
        "\" OR \"1\"=\"1",
        "أحمد بن صالح",
        "Zoë 💪 \\ %_",
    ];
    for (i, name) in names.iter().enumerate() {
        let body = body_with(&app, &format!("user{i}"), json!({"fullName": name})).await;
        assert_eq!(app.post(REGISTER, body).await.status, StatusCode::CREATED, "{name}");
    }
    let stored: Vec<String> = sqlx::query_scalar("SELECT full_name FROM profiles ORDER BY created_at, user_id")
        .fetch_all(&app.db)
        .await
        .unwrap();
    let expected: Vec<&str> = names.iter().map(|name| name.trim()).collect();
    assert_eq!(stored, expected);
    assert_eq!(count(&app, "users").await, 4);
}

#[sqlx::test]
async fn registration_is_limited_per_address(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let mut statuses = Vec::new();
    for i in 0..8 {
        let body = registration(&app, &format!("user{i}")).await;
        statuses.push(post_from(&app, [5, 5, 5, 5], REGISTER, body).await.status);
    }
    assert_eq!(statuses[..5], [StatusCode::CREATED; 5]);
    // The count is a sliding estimate: the refusal comes with the sixth or just after.
    assert!(statuses[5..].contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");
    // Another address is not affected.
    let body = registration(&app, "elsewhere").await;
    assert_eq!(post_from(&app, [6, 6, 6, 6], REGISTER, body).await.status, StatusCode::CREATED);
}

#[sqlx::test]
async fn a_queue_that_is_down_does_not_undo_a_registration(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    // With the limits off, the queue is the only thing that needs Redis.
    let (app, redis) = seeded_with_cuttable_redis(opts, conn, |_| {}).await;
    redis.abort();
    let _ = redis.await;

    let reply = app.post(REGISTER, registration(&app, "ahmed").await).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(count(&app, "users").await, 1);
}
```

The unit tests of the date and phone rules are written with the code, in Step 4.

- [ ] **Step 3: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test register 2>&1 | grep -E "^test |test result" | head -12
```

Expected: the tests compile and fail with `404` where `201` or `422` was expected (the route does not exist yet).

- [ ] **Step 4: Write the value sets, the body and its rules**

`src/types.rs`, after `Role`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Gender {
    Male,
    Female,
    Undisclosed,
}

impl Gender {
    pub fn as_str(self) -> &'static str {
        match self {
            Gender::Male => "MALE",
            Gender::Female => "FEMALE",
            Gender::Undisclosed => "UNDISCLOSED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    Fr,
    En,
    Ar,
}

impl Locale {
    pub fn as_str(self) -> &'static str {
        match self {
            Locale::Fr => "fr",
            Locale::En => "en",
            Locale::Ar => "ar",
        }
    }
}
```

`src/modules/auth/mod.rs`: add the route `.post("/api/v1/auth/register", register)` to `routes`, and:

```rust
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConsentsBody {
    terms: bool,
    privacy: bool,
    health_data: bool,
    marketing: Option<bool>,
    document_version: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisterBody {
    username: String,
    full_name: String,
    email: String,
    password: String,
    date_of_birth: String,
    country_code: String,
    governorate_id: Uuid,
    city_id: Uuid,
    phone: Option<String>,
    gender: Option<Gender>,
    locale: Option<Locale>,
    consents: ConsentsBody,
}

/// A calendar date written `YYYY-MM-DD`, in 1900 or later.
fn parse_date(raw: &str) -> Option<NaiveDate> {
    let shaped = raw.len() == 10
        && raw.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !shaped {
        return None;
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .ok()
        .filter(|date| date.year() >= 1900)
}

/// `+` and 8 to 15 digits, the first of which is not 0 (E.164).
fn is_phone(raw: &str) -> bool {
    raw.strip_prefix('+').is_some_and(|digits| {
        (8..=15).contains(&digits.len())
            && !digits.starts_with('0')
            && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

impl Validate for RegisterBody {
    fn validate(&self, check: &mut Check) {
        let username_ok = (3..=20).contains(&self.username.len())
            && self
                .username
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.');
        check.ensure("username", username_ok, "MATCHES");
        check.length("fullName", self.full_name.trim(), 2, 80);
        check.ensure(
            "fullName",
            !self.full_name.chars().any(char::is_control),
            "MATCHES",
        );
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
        check.length(
            "password",
            &self.password,
            password::MIN_LENGTH,
            password::MAX_LENGTH,
        );
        check.ensure(
            "dateOfBirth",
            parse_date(&self.date_of_birth).is_some(),
            "ISISO8601",
        );
        let country_ok =
            self.country_code.len() == 2 && self.country_code.bytes().all(|b| b.is_ascii_uppercase());
        check.ensure("countryCode", country_ok, "MATCHES");
        if let Some(phone) = &self.phone {
            check.ensure("phone", is_phone(phone), "MATCHES");
        }
        check.ensure("consents.terms", self.consents.terms, "EQUALS");
        check.ensure("consents.privacy", self.consents.privacy, "EQUALS");
        check.length(
            "consents.documentVersion",
            &self.consents.document_version,
            1,
            20,
        );
    }
}

impl RegisterBody {
    /// The validated body in the form the account module works with.
    fn into_registration(self) -> Result<Registration, AppError> {
        Ok(Registration {
            email: normalise_email(&self.email).ok_or_else(|| AppError::field("email", "ISEMAIL"))?,
            date_of_birth: parse_date(&self.date_of_birth)
                .ok_or_else(|| AppError::field("dateOfBirth", "ISISO8601"))?,
            username: self.username,
            full_name: self.full_name.trim().to_owned(),
            password: self.password,
            country_code: self.country_code,
            governorate_id: self.governorate_id,
            city_id: self.city_id,
            phone: self.phone,
            gender: self.gender,
            locale: self.locale.unwrap_or(Locale::Fr),
            health_data: self.consents.health_data,
            marketing: self.consents.marketing.unwrap_or(false),
            document_version: self.consents.document_version,
        })
    }
}

async fn register(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RegisterBody>,
) -> Result<(StatusCode, Json<Session>), AppError> {
    rate_limit::check(&state, &rate_limit::REGISTER_IP, &client.subject()).await?;
    let session = accounts::register(&state, body.into_registration()?).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn a_date_is_ten_characters_and_a_real_day() {
        assert_eq!(
            parse_date("1998-04-12"),
            NaiveDate::from_ymd_opt(1998, 4, 12)
        );
        for bad in ["1998-4-12", "98-04-12", "1998/04/12", "1998-04-12T00:00:00Z", "1998-13-01", "2001-02-29", "1899-12-31", ""] {
            assert_eq!(parse_date(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_phone_number_is_international() {
        assert!(is_phone("+21620123456"));
        for bad in ["21620123456", "+0620123456", "+2162012", "+21620123456789012", "+2162012345a", "+"] {
            assert!(!is_phone(bad), "{bad}");
        }
    }
}
```

Extend the imports of the file: `use chrono::{Datelike, NaiveDate};`, `use uuid::Uuid;`, `use self::accounts::Registration;`, and in the `crate::{…}` list `security::password`, `types::{Gender, Locale}`, `validate::normalise_email`.

- [ ] **Step 5: Write `accounts::register`**

In `src/modules/auth/accounts.rs`, extend the imports:

```rust
use chrono::{NaiveDate, NaiveDateTime, Utc};
use serde_json::json;
use uuid::Uuid;

use super::sessions::{self, Holder, Session};
use crate::{
    audit, db,
    error::AppError,
    jobs::{self, JobKind},
    rules::Rules,
    security::{password::password_problem, policy, tokens::Audience},
    state::AppState,
    types::{Gender, Locale, Role, iso},
};
```

and add:

```rust
/// A registration whose every field passed its own rule.
pub struct Registration {
    pub username: String,
    pub full_name: String,
    /// Normalised: see `validate::normalise_email`.
    pub email: String,
    pub password: String,
    pub date_of_birth: NaiveDate,
    pub country_code: String,
    pub governorate_id: Uuid,
    pub city_id: Uuid,
    pub phone: Option<String>,
    pub gender: Option<Gender>,
    pub locale: Locale,
    pub health_data: bool,
    pub marketing: bool,
    pub document_version: String,
}

pub async fn register(state: &AppState, r: Registration) -> Result<Session, AppError> {
    if let Some(code) = password_problem(&r.password, &r.email, &r.username) {
        return Err(AppError::field("password", code));
    }
    // The age gate comes before anything is stored about the person.
    let rules = Rules::active(&state.db).await?;
    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    if policy::age_in_years(r.date_of_birth, today) < rules.min_age_years {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNDER_AGE",
            "Minimum age not reached",
        )
        .with("minAgeYears", rules.min_age_years));
    }
    let places = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!: i64"
           FROM cities c
           JOIN governorates g ON g.id = c.governorate_id
           JOIN countries k ON k.code = g.country_code
           WHERE c.id = ? AND g.id = ? AND g.country_code = ? AND k.enabled"#,
        r.city_id,
        r.governorate_id,
        r.country_code
    )
    .fetch_one(&state.db)
    .await?;
    if places != 1 {
        return Err(AppError::field("cityId", "NOT_IN_GOVERNORATE"));
    }

    let password_hash = state.passwords.hash(r.password).await?;
    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query!(
        "INSERT INTO users (id, email, username, password_hash, date_of_birth, phone_e164) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        r.email,
        r.username,
        password_hash,
        r.date_of_birth,
        r.phone
    )
    .execute(&mut *tx)
    .await;
    if let Err(e) = inserted {
        // Which one is taken is what the database says: its idea of "the same email" is the one
        // that counts, and two registrations at the same instant are settled by its index.
        let taken = db::duplicate_key(&e).map(str::to_owned);
        return Err(match taken.as_deref() {
            Some("uq_users_email") => AppError::conflict("EMAIL_TAKEN"),
            Some("uq_users_username") => AppError::conflict("USERNAME_TAKEN"),
            Some("uq_users_phone") => AppError::conflict("PHONE_TAKEN"),
            _ => e.into(),
        });
    }
    sqlx::query!(
        "INSERT INTO profiles (user_id, full_name, gender, country_code, governorate_id, city_id) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        r.full_name,
        r.gender.map(Gender::as_str),
        r.country_code,
        r.governorate_id,
        r.city_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO user_settings (user_id, locale) VALUES (?, ?)",
        id,
        r.locale.as_str()
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("INSERT INTO user_stats (user_id) VALUES (?)", id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("INSERT INTO user_streaks (user_id) VALUES (?)", id)
        .execute(&mut *tx)
        .await?;
    for (kind, granted) in [
        ("TERMS", true),
        ("PRIVACY", true),
        ("HEALTH_DATA", r.health_data),
        ("MARKETING", r.marketing),
    ] {
        sqlx::query!(
            "INSERT INTO consents (id, user_id, type, document_version, granted) VALUES (?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            id,
            kind,
            r.document_version,
            granted
        )
        .execute(&mut *tx)
        .await?;
    }
    let event = audit::Event {
        actor: Some((id, Role::User)),
        action: "USER_REGISTERED",
        user_id: id,
        after: Some(json!({"via": "PASSWORD"})),
    };
    audit::record(&mut *tx, event).await?;
    let holder = Holder {
        id,
        role: Role::User,
        session_version: 1,
    };
    let session =
        sessions::issue(state, &mut *tx, holder, Uuid::now_v7(), Uuid::now_v7(), Audience::App).await?;
    tx.commit().await?;

    // The mail is the worker's business. A queue that is down must not undo a registration: the
    // person can ask for another link once signed in.
    if jobs::enqueue(state, JobKind::EmailVerify, id).await.is_err() {
        tracing::warn!(user_id = %id, "the verification email could not be queued");
    }
    Ok(session)
}
```

The country of the profile is a foreign key, so a code with no row in `countries` cannot be stored even if the query above were wrong.

- [ ] **Step 6: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test register 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --lib modules::auth 2>&1 | grep -E "^test |test result"
```

Expected: 7 integration tests and 3 unit tests pass (`accounts` has one, `auth` two).

- [ ] **Step 7: Register from the command line and read the mail**

In two terminals, from `apps/backend`: `cargo run -q -- serve` and `cargo run -q -- worker`. Then:

```bash
G=$(curl -s http://127.0.0.1:3100/api/v1/ref/governorates | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
C=$(curl -s "http://127.0.0.1:3100/api/v1/ref/cities?governorateId=$G" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST http://127.0.0.1:3100/api/v1/auth/register -H 'content-type: application/json' -d "{\"username\":\"plan1b\",\"fullName\":\"Plan One B\",\"email\":\"plan1b@example.com\",\"password\":\"a long enough passphrase\",\"dateOfBirth\":\"1995-05-05\",\"countryCode\":\"TN\",\"governorateId\":\"$G\",\"cityId\":\"$C\",\"consents\":{\"terms\":true,\"privacy\":true,\"healthData\":false,\"documentVersion\":\"2026-09\"}}"
curl -s http://127.0.0.1:8025/api/v1/messages | python3 -c "import json,sys; m=json.load(sys.stdin)['messages'][0]; print(m['To'][0]['Address'], '|', m['Subject'])"
```

Expected: the second command prints a session (four keys); the third prints `plan1b@example.com | Fitness League : confirme ton adresse email`. Stop both processes (by process id, not by name).

- [ ] **Step 8: Prepare, lint, commit**

Message: `feat(backend): registration with the age gate, consents, and the taken-name answers decided by the database`

---

### Task 6: Sign-in with lockout

**Files:**
- Modify: `apps/backend/src/modules/auth/mod.rs`, `src/modules/auth/accounts.rs`
- Test: `apps/backend/tests/login.rs`

**Interfaces:**
- Consumes: `Passwords::verify`, `policy::lock_minutes`, `accounts::refuse_if_barred`, `sessions::{start, Holder}`, `audit::record`, `jobs::enqueue`, `rate_limit::{LOGIN_IP, LOGIN_ACCOUNT}`.
- Produces:
  - `accounts::check_credentials(state, email: &str, password: String) -> Result<Holder, AppError>` (`email` already normalised)
  - `modules::auth::LoginBody { pub email: String, pub password: String }`
  - `modules::auth::sign_in(state, client: &ClientIp, body: LoginBody) -> Result<Holder, AppError>`: both rate limits, then the credentials. The admin panel's sign-in (Task 8) calls it too.
  - Route `POST /api/v1/auth/login` → 200 and a session

| Situation | Answer |
|---|---|
| Unknown email, deleted account, wrong password | 401 `INVALID_CREDENTIALS`, title `Invalid email or password`, identical in every case |
| Account locked | 423 `ACCOUNT_LOCKED` with `lockedUntil` and a `Retry-After` header, whatever the password |
| Right password, account banned | 403 `ACCOUNT_BANNED` |
| Right password, account suspended | 403 `ACCOUNT_SUSPENDED` with `suspendedUntil` |
| Right password, judge account | 403 `JUDGE_ACCOUNT`, detail `Judge accounts sign in to the admin panel.` |
| More than 10 a minute from one address, or 5 in 15 minutes for one account | 429 `RATE_LIMITED` |

Every fifth wrong password in a row locks the account: 15 minutes, then 30, 60… up to 24 hours (`policy::lock_minutes`). The lock is written in MariaDB, so it does not depend on Redis. A successful sign-in clears the counter.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/login.rs`:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::StatusCode;
use backend::types::Role;
use common::{PASSWORD, Reply, TestApp, create_user, deliver_mail, post_from, register, seeded, seeded_with};
use serde_json::json;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const LOGIN: &str = "/api/v1/auth/login";

async fn login(app: &TestApp, email: &str, password: &str) -> Reply {
    app.post(LOGIN, json!({"email": email, "password": password}))
        .await
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

fn retry_after(reply: &Reply) -> u64 {
    reply.headers["retry-after"].to_str().unwrap().parse().unwrap()
}

#[sqlx::test]
async fn the_right_password_opens_a_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let registered = register(&app, "ahmed").await;

    let reply = login(&app, "  Ahmed@Example.com ", PASSWORD).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(reply.json["userId"], registered["userId"]);
    assert_eq!(reply.json["expiresIn"], 900);
    assert_ne!(reply.json["refreshToken"], registered["refreshToken"]);

    let seen: bool = sqlx::query_scalar("SELECT last_login_at IS NOT NULL FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(seen);
}

#[sqlx::test]
async fn an_unknown_email_and_a_wrong_password_get_the_same_answer(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;

    let mut wrong = login(&app, "ahmed@example.com", "not the password").await;
    let mut unknown = login(&app, "nobody@example.com", "not the password").await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong.json["code"], "INVALID_CREDENTIALS");
    // The trace id is the only thing that may differ.
    for reply in [&mut wrong, &mut unknown] {
        reply.json.as_object_mut().unwrap().remove("traceId");
    }
    assert_eq!(wrong.status, unknown.status);
    assert_eq!(wrong.json, unknown.json);
    assert_eq!(
        wrong.headers.contains_key("retry-after"),
        unknown.headers.contains_key("retry-after")
    );
}

#[sqlx::test]
async fn the_fifth_failure_locks_and_the_lock_doubles(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let user: Uuid = register(&app, "ahmed").await["userId"].as_str().unwrap().parse().unwrap();
    deliver_mail(&app).await; // the verification mail, out of the way

    for _ in 0..5 {
        let reply = login(&app, "ahmed@example.com", "wrong").await;
        assert_eq!(reply.json["code"], "INVALID_CREDENTIALS");
    }
    // Locked: even the right password is refused, and the answer says until when.
    let locked = login(&app, "ahmed@example.com", PASSWORD).await;
    assert_eq!(locked.status, StatusCode::LOCKED);
    assert_eq!(locked.json["code"], "ACCOUNT_LOCKED");
    assert!(locked.json["lockedUntil"].is_string());
    assert!((880..=900).contains(&retry_after(&locked)), "{}", retry_after(&locked));

    let (minutes,): (String,) = sqlx::query_as(
        "SELECT JSON_VALUE(after_json, '$.minutes') FROM audit_log WHERE action = 'ACCOUNT_LOCKED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(minutes, "15");
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert!(mails[0].subject.contains("bloquée"), "{}", mails[0].subject);

    // The lock ends; five more failures lock for twice as long.
    set(&app, user, "locked_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND").await;
    for _ in 0..5 {
        assert_eq!(login(&app, "ahmed@example.com", "wrong").await.status, StatusCode::UNAUTHORIZED);
    }
    let longer = login(&app, "ahmed@example.com", PASSWORD).await;
    assert_eq!(longer.status, StatusCode::LOCKED);
    assert!((1780..=1800).contains(&retry_after(&longer)), "{}", retry_after(&longer));

    // Once it is over, the right password signs in and the count starts again from zero.
    set(&app, user, "locked_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND").await;
    assert_eq!(login(&app, "ahmed@example.com", PASSWORD).await.status, StatusCode::OK);
    let (failures, locked): (i32, bool) =
        sqlx::query_as("SELECT failed_login_count, locked_until IS NOT NULL FROM users WHERE id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!((failures, locked), (0, false));
}

#[sqlx::test]
async fn the_state_of_an_account_is_only_told_to_its_owner(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let banned = create_user(&app, "banned", Role::User).await;
    let suspended = create_user(&app, "suspended", Role::User).await;
    let deleted = create_user(&app, "deleted", Role::User).await;
    let judge = create_user(&app, "judge", Role::HeadJudge).await;
    set(&app, banned, "status = 'BANNED'").await;
    set(&app, suspended, "status = 'SUSPENDED', suspended_until = UTC_TIMESTAMP(6) + INTERVAL 7 DAY").await;
    set(&app, deleted, "status = 'DELETED'").await;
    let _ = judge;

    // Without the password, all four look like any other account.
    for name in ["banned", "suspended", "deleted", "judge"] {
        let reply = login(&app, &format!("{name}@example.com"), "not the password").await;
        assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")), "{name}");
    }

    let reply = login(&app, "banned@example.com", PASSWORD).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::FORBIDDEN, Some("ACCOUNT_BANNED")));
    let reply = login(&app, "suspended@example.com", PASSWORD).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::FORBIDDEN, Some("ACCOUNT_SUSPENDED")));
    assert!(reply.json["suspendedUntil"].is_string());
    // A deleted account does not exist any more, even for its former owner.
    let reply = login(&app, "deleted@example.com", PASSWORD).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")));

    let reply = login(&app, "judge@example.com", PASSWORD).await;
    assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::FORBIDDEN, Some("JUDGE_ACCOUNT")));
    assert_eq!(reply.json["detail"], "Judge accounts sign in to the admin panel.");
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0, "none of these sign-ins opened a session");
}

#[sqlx::test]
async fn signing_in_cancels_a_deletion_that_was_waiting(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    sqlx::query("INSERT INTO deletion_requests (id, user_id, scheduled_for) VALUES (?, ?, UTC_TIMESTAMP(6) + INTERVAL 30 DAY)")
        .bind(Uuid::now_v7())
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();

    assert_eq!(login(&app, "ahmed@example.com", PASSWORD).await.status, StatusCode::OK);
    let status: String = sqlx::query_scalar("SELECT status FROM deletion_requests WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(status, "CANCELLED");
}

#[sqlx::test]
async fn the_body_of_a_sign_in_is_checked(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let errors = |body| {
        let app = &app;
        async move {
            let reply = app.post(LOGIN, body).await;
            assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", reply.json);
            reply.json["errors"].clone()
        }
    };
    assert_eq!(errors(json!({"email": "nope", "password": "x"})).await, json!([{"field": "email", "code": "ISEMAIL"}]));
    assert_eq!(errors(json!({"email": "a@example.com"})).await, json!([{"field": "password", "code": "REQUIRED"}]));
    assert_eq!(
        errors(json!({"email": "a@example.com", "password": "x".repeat(129)})).await,
        json!([{"field": "password", "code": "MAXLENGTH"}])
    );
    assert_eq!(
        errors(json!({"email": "a@example.com", "password": "x", "admin": true})).await,
        json!([{"field": "admin", "code": "UNKNOWN_FIELD"}])
    );
}

#[sqlx::test]
async fn sign_in_is_limited_per_account_and_per_address(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    create_user(&app, "ahmed", Role::User).await;

    // One account, a new address every time: 5 in 15 minutes.
    let mut statuses = Vec::new();
    for i in 0..8u8 {
        let body = json!({"email": "ahmed@example.com", "password": "wrong"});
        statuses.push(post_from(&app, [20, 0, 0, i], LOGIN, body).await.status);
    }
    assert_eq!(statuses[..5], [StatusCode::UNAUTHORIZED; 5]);
    assert!(statuses[5..].contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");

    // One address, a new account every time: 10 a minute.
    let mut statuses = Vec::new();
    for i in 0..14 {
        let body = json!({"email": format!("nobody{i}@example.com"), "password": "wrong"});
        let reply = post_from(&app, [30, 0, 0, 1], LOGIN, body).await;
        if reply.status == StatusCode::TOO_MANY_REQUESTS {
            assert!(reply.headers.contains_key("retry-after"));
        }
        statuses.push(reply.status);
    }
    assert_eq!(statuses[..10], [StatusCode::UNAUTHORIZED; 10]);
    assert!(statuses[10..].contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test login 2>&1 | grep -E "^test |test result" | head -10
```

Expected: every test fails with `404` (the route does not exist yet).

- [ ] **Step 3: Write the credentials check**

In `src/modules/auth/accounts.rs` add `use chrono::Duration;` to the `chrono` import, `error::AppError` is already there, and append:

```rust
/// Checks an email and a password, with the lockout. Shared by the app and the admin panel.
/// `email` is already normalised. What the account is (banned, suspended) is only told to someone
/// who gave the right password.
pub async fn check_credentials(
    state: &AppState,
    email: &str,
    password: String,
) -> Result<Holder, AppError> {
    let wrong = || AppError::unauthenticated("INVALID_CREDENTIALS", "Invalid email or password");
    let user = sqlx::query!(
        r#"SELECT id AS "id: Uuid", password_hash, role AS "role: Role", status, session_version,
                  locked_until, suspended_until
           FROM users WHERE email = ?"#,
        email
    )
    .fetch_optional(&state.db)
    .await?;
    let Some(user) = user.filter(|user| user.status != "DELETED") else {
        // The same work as for a real account: the time taken must not tell which emails exist.
        state.passwords.verify(None, password).await;
        return Err(wrong());
    };
    let now = Utc::now().naive_utc();
    if let Some(until) = user.locked_until.filter(|until| *until > now) {
        let seconds = u64::try_from((until - now).num_seconds()).unwrap_or(0) + 1;
        return Err(AppError::new(
            StatusCode::LOCKED,
            "ACCOUNT_LOCKED",
            "Account temporarily locked",
        )
        .with("lockedUntil", iso(until))
        .retry_after(seconds));
    }
    if !state.passwords.verify(user.password_hash, password).await {
        record_failure(state, user.id).await?;
        return Err(wrong());
    }
    refuse_if_barred(&user.status, user.suspended_until, now)?;
    Ok(Holder {
        id: user.id,
        role: user.role,
        session_version: user.session_version,
    })
}

/// Counts a wrong password. Every fifth in a row locks the account, for longer each time.
async fn record_failure(state: &AppState, user: Uuid) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    // The update holds the row until the commit: two failures at the same instant count as two.
    sqlx::query!(
        "UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    let failures = sqlx::query_scalar!("SELECT failed_login_count FROM users WHERE id = ?", user)
        .fetch_one(&mut *tx)
        .await?;
    let lock = policy::lock_minutes(u32::try_from(failures).unwrap_or(u32::MAX));
    if let Some(minutes) = lock {
        let until = Utc::now().naive_utc() + Duration::minutes(i64::from(minutes));
        sqlx::query!("UPDATE users SET locked_until = ? WHERE id = ?", until, user)
            .execute(&mut *tx)
            .await?;
        let event = audit::Event {
            actor: None,
            action: "ACCOUNT_LOCKED",
            user_id: user,
            after: Some(json!({"minutes": minutes, "failedLoginCount": failures})),
        };
        audit::record(&mut *tx, event).await?;
    }
    tx.commit().await?;
    // The owner is told by mail. If the queue is down the lock still holds.
    if lock.is_some() && jobs::enqueue(state, JobKind::AccountLocked, user).await.is_err() {
        tracing::warn!(user_id = %user, "the lock notice could not be queued");
    }
    Ok(())
}
```

- [ ] **Step 4: Write the route**

In `src/modules/auth/mod.rs`, add `.post("/api/v1/auth/login", login)` to `routes`, `use self::sessions::Holder;` to the imports, and:

```rust
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

impl Validate for LoginBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
        // No minimum: a short password is simply a wrong one.
        check.length("password", &self.password, 0, password::MAX_LENGTH);
    }
}

/// What the app's sign-in and the panel's share: both limits, then the credentials.
pub async fn sign_in(
    state: &AppState,
    client: &ClientIp,
    body: LoginBody,
) -> Result<Holder, AppError> {
    let email = normalise_email(&body.email).ok_or_else(|| AppError::field("email", "ISEMAIL"))?;
    rate_limit::check(state, &rate_limit::LOGIN_IP, &client.subject()).await?;
    rate_limit::check(state, &rate_limit::LOGIN_ACCOUNT, &email).await?;
    accounts::check_credentials(state, &email, body.password).await
}

async fn login(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<LoginBody>,
) -> Result<Json<Session>, AppError> {
    let holder = sign_in(&state, &client, body).await?;
    // Judges only judge, in the admin panel. Said after the password was checked, like every other
    // fact about an account.
    if holder.role.is_judge() {
        return Err(
            AppError::new(StatusCode::FORBIDDEN, "JUDGE_ACCOUNT", "Forbidden")
                .detail("Judge accounts sign in to the admin panel."),
        );
    }
    Ok(Json(sessions::start(&state, holder, Audience::App).await?))
}
```

- [ ] **Step 5: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test login 2>&1 | grep -E "^test |test result"
```

Expected: 7 tests pass. They take a few seconds: each attempt runs a real Argon2 verification.

- [ ] **Step 6: Prepare, lint, commit**

Message: `feat(backend): sign-in with lockout, one answer for every wrong attempt, judges sent to the panel`

---

### Task 7: The links sent by email

**Files:**
- Modify: `apps/backend/src/modules/auth/mod.rs`, `src/modules/auth/emails.rs`
- Test: `apps/backend/tests/emails.rs` (the API's side, appended to the worker's side of Task 3)

**Interfaces:**
- Consumes: `emails::handle` (Task 3), `tokens::hash_opaque`, `password_problem`, `Passwords::hash`, `sessions::revoke_all`, `audit::record`, `jobs::enqueue`, `AppUser`, `rate_limit::{VERIFY_IP, RESEND_USER, FORGOT_IP, FORGOT_ACCOUNT, RESET_IP}`.
- Produces:
  - `emails::verify_email(state, token: &str) -> Result<(), AppError>`
  - `emails::request_reset(state, email: &str) -> Result<(), AppError>` (`email` normalised)
  - `emails::reset_password(state, token: &str, new_password: String) -> Result<(), AppError>`
  - Routes: `POST /api/v1/auth/email/verify` `{token}` → 204; `POST /api/v1/auth/email/resend` (no body, app session) → 204; `POST /api/v1/auth/password/forgot` `{email}` → 202 always; `POST /api/v1/auth/password/reset` `{token, newPassword}` → 204

A link that is unknown, used, expired or of the other kind gets one answer: 422 `TOKEN_INVALID`, title `Invalid or expired link`. A new password that the policy refuses gets 422 field `newPassword` and leaves the link usable. A reset increments the session version and revokes every refresh token, lifts a lock, and is audited.

- [ ] **Step 1: Write the failing tests**

Append to `tests/emails.rs` (extend its imports with `axum::http::{Method, StatusCode}`, `common::{PASSWORD, post_from, register, seeded_with}` and `serde_json::json`):

```rust
const VERIFY: &str = "/api/v1/auth/email/verify";
const RESEND: &str = "/api/v1/auth/email/resend";
const FORGOT: &str = "/api/v1/auth/password/forgot";
const RESET: &str = "/api/v1/auth/password/reset";
const LOGIN: &str = "/api/v1/auth/login";

fn user_id(session: &serde_json::Value) -> Uuid {
    session["userId"].as_str().unwrap().parse().unwrap()
}

async fn verified(app: &TestApp, user: Uuid) -> bool {
    sqlx::query_scalar("SELECT email_verified_at IS NOT NULL FROM users WHERE id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_link_of_the_mail_verifies_the_address_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let user = user_id(&register(&app, "ahmed").await);
    let token = token_in(&deliver_mail(&app).await[0]);
    assert!(!verified(&app, user).await);

    assert_eq!(app.post(VERIFY, json!({"token": token})).await.status, StatusCode::NO_CONTENT);
    assert!(verified(&app, user).await);

    let again = app.post(VERIFY, json!({"token": token})).await;
    assert_eq!(again.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(again.json["code"], "TOKEN_INVALID");
    let unknown = app.post(VERIFY, json!({"token": "x".repeat(43)})).await;
    assert_eq!(unknown.json["code"], "TOKEN_INVALID");
    let short = app.post(VERIFY, json!({"token": "short"})).await;
    assert_eq!(short.json["errors"], json!([{"field": "token", "code": "MINLENGTH"}]));
}

#[sqlx::test]
async fn an_expired_link_or_one_of_the_other_kind_is_refused(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = user_id(&register(&app, "ahmed").await);
    let verify_token = token_in(&deliver_mail(&app).await[0]);
    assert_eq!(app.post(FORGOT, json!({"email": "ahmed@example.com"})).await.status, StatusCode::ACCEPTED);
    let reset_token = token_in(&deliver_mail(&app).await[0]);

    // A reset link does not verify an address, and trying does not use it up.
    assert_eq!(app.post(VERIFY, json!({"token": reset_token})).await.json["code"], "TOKEN_INVALID");
    // A verification link does not reset a password.
    let wrong_kind = app
        .post(RESET, json!({"token": verify_token, "newPassword": "another long passphrase"}))
        .await;
    assert_eq!(wrong_kind.json["code"], "TOKEN_INVALID");

    sqlx::query("UPDATE email_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ? AND purpose = 'EMAIL_VERIFY'")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(app.post(VERIFY, json!({"token": verify_token})).await.json["code"], "TOKEN_INVALID");
    assert!(!verified(&app, user).await);

    let reset = app
        .post(RESET, json!({"token": reset_token, "newPassword": "another long passphrase"}))
        .await;
    assert_eq!(reset.status, StatusCode::NO_CONTENT);

    // A reset link expires as well.
    app.post(FORGOT, json!({"email": "ahmed@example.com"})).await;
    let late = token_in(&deliver_mail(&app).await[0]);
    sqlx::query("UPDATE email_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ? AND purpose = 'PASSWORD_RESET'")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let expired = app
        .post(RESET, json!({"token": late, "newPassword": "yet another passphrase"}))
        .await;
    assert_eq!(expired.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn resending_sends_a_new_link_and_cancels_the_old_one(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let access = session["accessToken"].as_str().unwrap();
    let first = token_in(&deliver_mail(&app).await[0]);

    // The app sends no body and no content type with this request.
    let resend = || app.call(Method::POST, RESEND, Some(access), None);
    assert_eq!(resend().await.status, StatusCode::NO_CONTENT);
    let second = token_in(&deliver_mail(&app).await[0]);
    assert_ne!(first, second);
    assert_eq!(app.post(VERIFY, json!({"token": first})).await.json["code"], "TOKEN_INVALID");
    assert_eq!(app.post(VERIFY, json!({"token": second})).await.status, StatusCode::NO_CONTENT);

    // Once verified there is nothing to send, and the answer is the same.
    assert_eq!(resend().await.status, StatusCode::NO_CONTENT);
    assert!(deliver_mail(&app).await.is_empty());

    let anonymous = app.call(Method::POST, RESEND, None, None).await;
    assert_eq!(anonymous.json["code"], "UNAUTHENTICATED");
}

#[sqlx::test]
async fn forgot_always_answers_the_same_and_only_real_accounts_get_a_mail(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;
    let banned = create_user(&app, "banned", Role::User).await;
    sqlx::query("UPDATE users SET status = 'BANNED' WHERE id = ?")
        .bind(banned)
        .execute(&app.db)
        .await
        .unwrap();
    deliver_mail(&app).await;

    for email in ["Ahmed@Example.com", "nobody@example.com", "banned@example.com"] {
        let reply = app.post(FORGOT, json!({"email": email})).await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{email}");
        assert!(reply.json.is_null(), "{email}: the answer has no body");
    }
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");
    assert!(mails[0].text.contains("/reset-password?token="));

    let bad = app.post(FORGOT, json!({"email": "not an email"})).await;
    assert_eq!(bad.json["errors"], json!([{"field": "email", "code": "ISEMAIL"}]));
}

#[sqlx::test]
async fn a_reset_changes_the_password_and_ends_every_session(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let user = user_id(&session);
    deliver_mail(&app).await;
    // The account is locked: a reset is how its owner gets back in.
    sqlx::query("UPDATE users SET failed_login_count = 5, locked_until = UTC_TIMESTAMP(6) + INTERVAL 15 MINUTE WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    app.post(FORGOT, json!({"email": "ahmed@example.com"})).await;
    let token = token_in(&deliver_mail(&app).await[0]);

    // A password the policy refuses does not use the link up.
    for (weak, code) in [("1234567890", "TOO_COMMON"), ("ahmed@example.com", "TOO_COMMON"), ("short", "MINLENGTH")] {
        let reply = app.post(RESET, json!({"token": token, "newPassword": weak})).await;
        assert_eq!(reply.json["errors"], json!([{"field": "newPassword", "code": code}]), "{weak}");
    }

    let new_password = "a brand new passphrase";
    let reset = app.post(RESET, json!({"token": token, "newPassword": new_password})).await;
    assert_eq!(reset.status, StatusCode::NO_CONTENT);

    let old = app.post(LOGIN, json!({"email": "ahmed@example.com", "password": PASSWORD})).await;
    assert_eq!(old.json["code"], "INVALID_CREDENTIALS");
    let new = app.post(LOGIN, json!({"email": "ahmed@example.com", "password": new_password})).await;
    assert_eq!(new.status, StatusCode::OK, "the lock is lifted and the new password works");

    // Everything handed out before the reset is dead.
    let stale = app
        .call(Method::POST, RESEND, session["accessToken"].as_str(), None)
        .await;
    assert_eq!((stale.status, stale.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")));
    let refresh = app
        .post("/api/v1/auth/refresh", json!({"refreshToken": session["refreshToken"]}))
        .await;
    assert_eq!(refresh.json["code"], "TOKEN_INVALID");

    assert_eq!(
        app.post(RESET, json!({"token": token, "newPassword": new_password})).await.json["code"],
        "TOKEN_INVALID"
    );
    let audited: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'PASSWORD_RESET' AND entity_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(audited, 1);
}

#[sqlx::test]
async fn the_email_routes_are_limited(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    let refused_after = |statuses: &[StatusCode], allowed: usize, ok: StatusCode| {
        assert_eq!(statuses[..allowed], vec![ok; allowed][..], "{statuses:?}");
        assert!(statuses[allowed..].contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");
    };

    // Forgot: 3 an hour for one account, wherever the requests come from.
    let mut statuses = Vec::new();
    for i in 0..6u8 {
        statuses.push(post_from(&app, [40, 0, 0, i], FORGOT, json!({"email": "ahmed@example.com"})).await.status);
    }
    refused_after(&statuses, 3, StatusCode::ACCEPTED);

    // Resend: 3 an hour for one user.
    let mut statuses = Vec::new();
    for _ in 0..6 {
        statuses.push(app.call(Method::POST, RESEND, session["accessToken"].as_str(), None).await.status);
    }
    refused_after(&statuses, 3, StatusCode::NO_CONTENT);

    // Verify: 20 an hour from one address, whatever the tokens were.
    let mut statuses = Vec::new();
    for _ in 0..25 {
        statuses.push(post_from(&app, [41, 0, 0, 1], VERIFY, json!({"token": "x".repeat(43)})).await.status);
    }
    refused_after(&statuses, 20, StatusCode::UNPROCESSABLE_ENTITY);

    // Reset: 10 an hour from one address.
    let mut statuses = Vec::new();
    for _ in 0..14 {
        let body = json!({"token": "x".repeat(43), "newPassword": "a brand new passphrase"});
        statuses.push(post_from(&app, [42, 0, 0, 1], RESET, body).await.status);
    }
    refused_after(&statuses, 10, StatusCode::UNPROCESSABLE_ENTITY);

    // Forgot: 10 an hour from one address, whatever the accounts were.
    let mut statuses = Vec::new();
    for i in 0..14 {
        let body = json!({"email": format!("nobody{i}@example.com")});
        statuses.push(post_from(&app, [43, 0, 0, 1], FORGOT, body).await.status);
    }
    refused_after(&statuses, 10, StatusCode::ACCEPTED);
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test emails 2>&1 | grep -E "^test |test result"
```

Expected: the four tests of Task 3 pass; the six new ones fail with `404`.

- [ ] **Step 3: Write the API's side of the links**

Append to `src/modules/auth/emails.rs` (extend the imports with `axum::http::StatusCode`, `sqlx::MySqlConnection`, `super::sessions`, and in the `crate::{…}` list `audit`, `error::AppError`, `jobs`, `security::password::password_problem`, `types::Role`):

```rust
fn bad_link() -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "TOKEN_INVALID",
        "Invalid or expired link",
    )
}

/// Uses a link up and returns whose it was. One statement decides, so of two requests with the same
/// link exactly one changes the row.
async fn consume(tx: &mut MySqlConnection, token: &str, purpose: &str) -> Result<Uuid, AppError> {
    let hash = tokens::hash_opaque(token);
    let used = sqlx::query!(
        "UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(6) \
         WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(6)",
        &hash[..],
        purpose
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if used != 1 {
        return Err(bad_link());
    }
    Ok(sqlx::query_scalar!(
        r#"SELECT user_id AS "user_id: Uuid" FROM email_tokens WHERE token_hash = ?"#,
        &hash[..]
    )
    .fetch_one(&mut *tx)
    .await?)
}

pub async fn verify_email(state: &AppState, token: &str) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let user = consume(&mut *tx, token, "EMAIL_VERIFY").await?;
    sqlx::query!(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(6)) WHERE id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Queues a reset mail when the address belongs to an account that may reset. Nothing here tells
/// the caller which case it was: the route answers 202 in all of them.
pub async fn request_reset(state: &AppState, email: &str) -> Result<(), AppError> {
    let user = sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM users WHERE email = ? AND status NOT IN ('DELETED', 'BANNED')"#,
        email
    )
    .fetch_optional(&state.db)
    .await?;
    if let Some(user) = user
        && jobs::enqueue(state, JobKind::PasswordReset, user).await.is_err()
    {
        // An error here would answer differently for an address that exists.
        tracing::error!(user_id = %user, "the reset email could not be queued");
    }
    Ok(())
}

/// Sets a new password and signs the account out everywhere.
pub async fn reset_password(
    state: &AppState,
    token: &str,
    new_password: String,
) -> Result<(), AppError> {
    let hash = tokens::hash_opaque(token);
    // Looked at first, used up later: a password the policy refuses must leave the link usable.
    let owner = sqlx::query!(
        r#"SELECT u.id AS "id: Uuid", u.email, u.username, u.role AS "role: Role"
           FROM email_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ? AND t.purpose = 'PASSWORD_RESET' AND t.consumed_at IS NULL
             AND t.expires_at > UTC_TIMESTAMP(6) AND u.status NOT IN ('DELETED', 'BANNED')"#,
        &hash[..]
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(bad_link)?;
    if let Some(code) = password_problem(&new_password, &owner.email, &owner.username) {
        return Err(AppError::field("newPassword", code));
    }
    let password_hash = state.passwords.hash(new_password).await?;

    let mut tx = state.db.begin().await?;
    consume(&mut *tx, token, "PASSWORD_RESET").await?;
    sqlx::query!(
        "UPDATE users SET password_hash = ?, session_version = session_version + 1, \
         failed_login_count = 0, locked_until = NULL WHERE id = ?",
        password_hash,
        owner.id
    )
    .execute(&mut *tx)
    .await?;
    sessions::revoke_all(&mut *tx, owner.id).await?;
    let event = audit::Event {
        actor: Some((owner.id, owner.role)),
        action: "PASSWORD_RESET",
        user_id: owner.id,
        after: None,
    };
    audit::record(&mut *tx, event).await?;
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 4: Write the four routes**

In `src/modules/auth/mod.rs`, add to `routes`:

```rust
        .post("/api/v1/auth/email/verify", verify_email)
        .post("/api/v1/auth/email/resend", resend_verification)
        .post("/api/v1/auth/password/forgot", forgot_password)
        .post("/api/v1/auth/password/reset", reset_password)
```

and (with `jobs::{self, JobKind}` added to the `crate::{…}` imports):

```rust
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenBody {
    token: String,
}

impl Validate for TokenBody {
    fn validate(&self, check: &mut Check) {
        check.length("token", &self.token, 20, 200);
    }
}

async fn verify_email(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<TokenBody>,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::VERIFY_IP, &client.subject()).await?;
    emails::verify_email(&state, &body.token).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// No body: the app sends none. Whether a mail was really queued is not said.
async fn resend_verification(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::RESEND_USER, &user.id.to_string()).await?;
    if !user.email_verified {
        jobs::enqueue(&state, JobKind::EmailVerify, user.id).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForgotBody {
    email: String,
}

impl Validate for ForgotBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
    }
}

async fn forgot_password(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<ForgotBody>,
) -> Result<StatusCode, AppError> {
    let email = normalise_email(&body.email).ok_or_else(|| AppError::field("email", "ISEMAIL"))?;
    rate_limit::check(&state, &rate_limit::FORGOT_IP, &client.subject()).await?;
    // Counted by the address that was typed, whether or not an account has it.
    rate_limit::check(&state, &rate_limit::FORGOT_ACCOUNT, &email).await?;
    emails::request_reset(&state, &email).await?;
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ResetBody {
    token: String,
    new_password: String,
}

impl Validate for ResetBody {
    fn validate(&self, check: &mut Check) {
        check.length("token", &self.token, 20, 200);
        check.length(
            "newPassword",
            &self.new_password,
            password::MIN_LENGTH,
            password::MAX_LENGTH,
        );
    }
}

async fn reset_password(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<ResetBody>,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::RESET_IP, &client.subject()).await?;
    emails::reset_password(&state, &body.token, body.new_password).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 5: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test emails 2>&1 | grep -E "^test |test result"
```

Expected: 10 tests pass.

- [ ] **Step 6: Prepare, lint, commit**

Message: `feat(backend): email verification and password reset through single-use links`

---

### Task 8: Sign-in to the admin panel, and `backend promote`

**Files:**
- Create: `apps/backend/src/modules/admin_auth.rs`
- Modify: `apps/backend/src/modules/mod.rs`, `src/modules/auth/accounts.rs`, `src/http/mod.rs`, `src/main.rs`
- Test: `apps/backend/tests/admin_auth.rs`

**Interfaces:**
- Consumes: `auth::{LoginBody, RefreshBody, sign_in}`, `sessions::{start, refresh, logout, revoke_all}`, `PanelUser`, `audit::record`, `normalise_email`.
- Produces:
  - `modules::admin_auth::routes(api) -> Api`: `POST /api/v1/admin/auth/login` → 200 `{"session": {…}}`; `POST /api/v1/admin/auth/refresh` → 200 session; `POST /api/v1/admin/auth/logout` → 204; `GET /api/v1/admin/me` → 200 `{id, email, username, role}`
  - `accounts::promote(db: &MySqlPool, email: &str, role: Role) -> Result<(), String>`
  - The subcommand `backend promote <email> <role>`

The panel's sign-in is the app's with three differences: it accepts the panel roles only (`MODERATOR`, `ADMIN`, `SUPER_ADMIN`, `JUDGE`, `HEAD_JUDGE`; anyone else gets 403 `FORBIDDEN` with the detail `Staff accounts only.`, after the password was checked), its tokens carry the audience `admin`, and every sign-in is audited. The lockout and the rate limits are shared with the app: they count the same failures.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/admin_auth.rs`:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::auth::accounts, types::Role};
use common::{PASSWORD, Reply, TestApp, create_user, register, seeded};
use serde_json::json;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

const LOGIN: &str = "/api/v1/admin/auth/login";
const REFRESH: &str = "/api/v1/admin/auth/refresh";
const LOGOUT: &str = "/api/v1/admin/auth/logout";
const ME: &str = "/api/v1/admin/me";

async fn login(app: &TestApp, name: &str, password: &str) -> Reply {
    app.post(LOGIN, json!({"email": format!("{name}@example.com"), "password": password}))
        .await
}

#[sqlx::test]
async fn staff_and_judges_sign_in_to_the_panel(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let panel = [Role::Moderator, Role::Admin, Role::SuperAdmin, Role::Judge, Role::HeadJudge];
    for (i, role) in panel.into_iter().enumerate() {
        let name = format!("staff{i}");
        let user = create_user(&app, &name, role).await;
        let reply = login(&app, &name, PASSWORD).await;
        assert_eq!(reply.status, StatusCode::OK, "{role:?}: {}", reply.json);
        let session = &reply.json["session"];
        assert_eq!(session.as_object().unwrap().len(), 4, "{role:?}");
        assert_eq!(session["userId"], user.to_string());

        let me = app.call(Method::GET, ME, session["accessToken"].as_str(), None).await;
        assert_eq!(me.status, StatusCode::OK);
        assert_eq!(
            me.json,
            json!({"id": user.to_string(), "email": format!("{name}@example.com"), "username": name, "role": role.as_str()})
        );
    }
    let audited: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'ADMIN_LOGIN'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(audited, 5);
}

#[sqlx::test]
async fn an_athlete_cannot_open_the_panel(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    create_user(&app, "athlete", Role::User).await;
    create_user(&app, "owner", Role::GymAdmin).await;

    for name in ["athlete", "owner"] {
        // Without the password the answer is the one everybody gets.
        assert_eq!(login(&app, name, "not the password").await.json["code"], "INVALID_CREDENTIALS");
        let reply = login(&app, name, PASSWORD).await;
        assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::FORBIDDEN, Some("FORBIDDEN")));
        assert_eq!(reply.json["detail"], "Staff accounts only.");
    }
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}

#[sqlx::test]
async fn panel_sessions_and_app_sessions_do_not_mix(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    create_user(&app, "admin", Role::Admin).await;
    let panel = login(&app, "admin", PASSWORD).await.json["session"].clone();
    // An administrator may also use the app, with a session of the app.
    let in_app = app
        .post("/api/v1/auth/login", json!({"email": "admin@example.com", "password": PASSWORD}))
        .await
        .json;

    let invalid = |reply: Reply| {
        assert_eq!((reply.status, reply.json["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")));
    };
    // Access tokens.
    invalid(app.call(Method::GET, ME, in_app["accessToken"].as_str(), None).await);
    invalid(
        app.call(
            Method::POST,
            "/api/v1/auth/logout",
            panel["accessToken"].as_str(),
            Some(json!({"refreshToken": "x".repeat(43)})),
        )
        .await,
    );
    // Refresh tokens.
    invalid(app.post("/api/v1/auth/refresh", json!({"refreshToken": panel["refreshToken"]})).await);
    invalid(app.post(REFRESH, json!({"refreshToken": in_app["refreshToken"]})).await);

    // Each still works where it belongs.
    let renewed = app.post(REFRESH, json!({"refreshToken": panel["refreshToken"]})).await;
    assert_eq!(renewed.status, StatusCode::OK);
    assert_eq!(renewed.json.as_object().unwrap().len(), 4, "a bare session, as the panel reads it");
    let me = app.call(Method::GET, ME, renewed.json["accessToken"].as_str(), None).await;
    assert_eq!(me.status, StatusCode::OK);

    let out = app
        .call(
            Method::POST,
            LOGOUT,
            renewed.json["accessToken"].as_str(),
            Some(json!({"refreshToken": renewed.json["refreshToken"]})),
        )
        .await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    invalid(app.post(REFRESH, json!({"refreshToken": renewed.json["refreshToken"]})).await);
}

#[sqlx::test]
async fn the_lockout_is_the_same_one_as_in_the_app(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    create_user(&app, "admin", Role::Admin).await;
    for _ in 0..3 {
        login(&app, "admin", "wrong").await;
    }
    for _ in 0..2 {
        app.post("/api/v1/auth/login", json!({"email": "admin@example.com", "password": "wrong"}))
            .await;
    }
    // Five failures in all, three here and two in the app: the account is locked for both.
    assert_eq!(login(&app, "admin", PASSWORD).await.status, StatusCode::LOCKED);
}

#[sqlx::test]
async fn promote_gives_a_role_and_ends_every_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    assert_eq!(login(&app, "ahmed", PASSWORD).await.status, StatusCode::FORBIDDEN);

    accounts::promote(&app.db, " Ahmed@Example.com ", Role::Admin)
        .await
        .unwrap();

    let (role, version): (String, i32) = sqlx::query_as("SELECT role, session_version FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!((role.as_str(), version), ("ADMIN", 2));
    // What was signed before the change is dead, so the new role is never carried by an old token.
    let stale = app
        .call(Method::POST, "/api/v1/auth/email/resend", session["accessToken"].as_str(), None)
        .await;
    assert_eq!(stale.json["code"], "TOKEN_INVALID");
    let refresh = app
        .post("/api/v1/auth/refresh", json!({"refreshToken": session["refreshToken"]}))
        .await;
    assert_eq!(refresh.json["code"], "TOKEN_INVALID");

    let (change,): (String,) = sqlx::query_as("SELECT after_json FROM audit_log WHERE action = 'ROLE_CHANGED'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&change).unwrap(),
        json!({"from": "USER", "to": "ADMIN"})
    );
    assert_eq!(login(&app, "ahmed", PASSWORD).await.status, StatusCode::OK);

    let missing = accounts::promote(&app.db, "nobody@example.com", Role::Admin).await;
    assert!(missing.unwrap_err().contains("no account"));
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test admin_auth 2>&1 | tail -5
```

Expected: does not compile, `no function promote in accounts`.

- [ ] **Step 3: Write `promote`**

Append to `src/modules/auth/accounts.rs` (add `sqlx::MySqlPool` and `crate::validate::normalise_email` to the imports):

```rust
/// Gives a role to an account, from the command line. Nobody changes a role through the API in this
/// part, and never their own. Every session of the account ends: the role is read from the row on
/// each request anyway, and ending the sessions makes the change visible to the person at once.
pub async fn promote(db: &MySqlPool, email: &str, role: Role) -> Result<(), String> {
    let describe = |e: sqlx::Error| db::describe(&e);
    let email = normalise_email(email).ok_or("not an email address")?;
    let mut tx = db.begin().await.map_err(describe)?;
    let user = sqlx::query!(
        r#"SELECT id AS "id: Uuid", role AS "role: Role" FROM users
           WHERE email = ? AND status <> 'DELETED' FOR UPDATE"#,
        email
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(describe)?
    .ok_or("no account with this email")?;
    sqlx::query!(
        "UPDATE users SET role = ?, session_version = session_version + 1 WHERE id = ?",
        role.as_str(),
        user.id
    )
    .execute(&mut *tx)
    .await
    .map_err(describe)?;
    sessions::revoke_all(&mut *tx, user.id)
        .await
        .map_err(describe)?;
    let event = audit::Event {
        actor: None,
        action: "ROLE_CHANGED",
        user_id: user.id,
        after: Some(json!({"from": user.role.as_str(), "to": role.as_str()})),
    };
    audit::record(&mut *tx, event).await.map_err(describe)?;
    tx.commit().await.map_err(describe)
}
```

`src/main.rs`: `USAGE` becomes `"usage: backend <serve|worker|migrate|seed [dir]|promote <email> <role>|keys>"`, add the arm `Some("promote") => promote(args.get(1), args.get(2)).await,` and:

```rust
/// `backend promote <email> <role>`: how the first staff account comes to exist.
async fn promote(email: Option<&String>, role: Option<&String>) -> Result<(), String> {
    let (Some(email), Some(role)) = (email, role) else {
        return Err(USAGE.to_owned());
    };
    let role: backend::types::Role =
        serde_json::from_value(serde_json::Value::String(role.to_uppercase()))
            .map_err(|_| format!("unknown role {role}: USER, GYM_ADMIN, MODERATOR, ADMIN, SUPER_ADMIN, JUDGE or HEAD_JUDGE"))?;
    let cfg = backend::config::Config::from_env()?;
    let pool = backend::db::connect(cfg.database_url.expose_secret(), 1)
        .await
        .map_err(|e| format!("database: {}", backend::db::describe(&e)))?;
    backend::modules::auth::accounts::promote(&pool, email, role).await?;
    println!("{email} is now {}", role.as_str());
    Ok(())
}
```

- [ ] **Step 4: Write the panel's routes**

Add `pub mod admin_auth;` to `src/modules/mod.rs`. Create `src/modules/admin_auth.rs`:

```rust
//! `/admin/auth/*` and `/admin/me`: the session of the admin panel.
//! Email and password, no second factor (the owner's decision); every sign-in is audited.

use axum::{Json, extract::State, http::StatusCode};
use serde_json::{Value, json};

use super::auth::{
    self, LoginBody, RefreshBody,
    sessions::{self, Session},
};
use crate::{
    audit,
    error::AppError,
    http::{
        Api,
        auth::PanelUser,
        rate_limit::{self, ClientIp},
    },
    security::tokens::Audience,
    state::AppState,
    validate::ValidJson,
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/admin/auth/login", login)
        .post("/api/v1/admin/auth/refresh", refresh)
        .post("/api/v1/admin/auth/logout", logout)
        .get("/api/v1/admin/me", me)
}

async fn login(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<LoginBody>,
) -> Result<Json<Value>, AppError> {
    let holder = auth::sign_in(&state, &client, body).await?;
    if !holder.role.can_open_panel() {
        return Err(AppError::forbidden().detail("Staff accounts only."));
    }
    let session = sessions::start(&state, holder, Audience::Admin).await?;
    let event = audit::Event {
        actor: Some((holder.id, holder.role)),
        action: "ADMIN_LOGIN",
        user_id: holder.id,
        after: None,
    };
    audit::record(&state.db, event).await?;
    Ok(Json(json!({"session": session})))
}

async fn refresh(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<Json<Session>, AppError> {
    rate_limit::check(&state, &rate_limit::REFRESH_IP, &client.subject()).await?;
    Ok(Json(
        sessions::refresh(&state, &body.refresh_token, Audience::Admin).await?,
    ))
}

async fn logout(
    State(state): State<AppState>,
    PanelUser(user): PanelUser,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<StatusCode, AppError> {
    sessions::logout(&state, user.id, &body.refresh_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// What the panel needs to draw itself: who is signed in, and with which role.
async fn me(
    State(state): State<AppState>,
    PanelUser(user): PanelUser,
) -> Result<Json<Value>, AppError> {
    let row = sqlx::query!("SELECT email, username FROM users WHERE id = ?", user.id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(json!({
        "id": user.id.to_string(),
        "email": row.email,
        "username": row.username,
        "role": user.role.as_str(),
    })))
}
```

In `src/http/mod.rs`, `api()` ends with:

```rust
    let api = modules::auth::routes(api);
    modules::admin_auth::routes(api)
```

- [ ] **Step 5: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test admin_auth 2>&1 | grep -E "^test |test result"
```

Expected: 5 tests pass.

- [ ] **Step 6: Prepare, lint, commit**

Message: `feat(backend): admin panel sign-in with its own audience, and the promote command`

---

### Task 9: `GET /me`

**Files:**
- Create: `apps/backend/src/modules/me.rs`
- Modify: `apps/backend/src/modules/mod.rs`, `src/http/mod.rs`
- Test: `apps/backend/tests/me.rs`

**Interfaces:**
- Consumes: `AppUser`, `Rules::{active, level_title_key}`, `policy::{age_in_years, age_bracket, business_today}`, `types::iso`.
- Produces:
  - `modules::me::routes(api) -> Api`: `GET /api/v1/me` → 200
  - `modules::me::payload(state: &AppState, user: Uuid) -> Result<serde_json::Value, AppError>`: the profile payload. Plan 1c returns the same payload from `PATCH /me/profile` and `PATCH /me/settings`.

The payload, key for key what the app reads today (`gym` and `division` stay `null` until parts 3 and 2 exist; the date of birth never appears, only the bracket):

```json
{"id": "…", "username": "ahmed", "email": "ahmed@example.com", "emailVerified": false, "role": "USER", "ageBracket": "25-34",
 "profile": {"fullName": "…", "bio": null, "gender": null, "countryCode": "TN",
             "governorate": {"id": "…", "code": "TUN", "name": {"fr": "…", "en": "…", "ar": "…"}},
             "city": {"id": "…", "name": {"fr": "…", "en": "…", "ar": "…"}},
             "gym": null, "experienceLevelDeclared": null, "plannedTrainingDaysPerWeek": 3,
             "calibrationEndsAt": null, "onboardingCompleted": false,
             "sports": [{"id": "…", "code": "CROSSFIT", "isPrimary": true}]},
 "settings": {"locale": "fr", "theme": "DARK", "reducedMotion": null, "defaultVisibility": "FRIENDS",
              "showAgeBracket": false, "showOnLeaderboards": true, "streakFreezeDaysPerWeek": 2},
 "stats": {"xpTotal": 0, "level": 1, "levelTitleKey": "level.title.beginner", "xpIntoLevel": 0,
           "xpForNextLevel": 100, "seasonLp": 0, "division": null, "leaderboardEligible": false},
 "streak": {"currentWeeks": 0, "longestWeeks": 0, "currentDays": 0}}
```

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/tests/me.rs`:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::path::Path;

use axum::http::{Method, StatusCode};
use backend::{security::tokens::Audience, types::Role};
use common::{TestApp, a_place, assert_same_shape, create_user, open_session, register, seeded};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const ME: &str = "/api/v1/me";

async fn me(app: &TestApp, session: &Value) -> common::Reply {
    app.call(Method::GET, ME, session["accessToken"].as_str(), None)
        .await
}

#[sqlx::test]
async fn me_is_the_payload_the_app_reads(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let (governorate, city) = a_place(&app).await;

    let reply = me(&app, &session).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let body = &reply.json;
    // Born on 1995-05-05: between 25 and 34 for the life of this test.
    let top = json!({
        "id": session["userId"], "username": "ahmed", "email": "ahmed@example.com",
        "emailVerified": false, "role": "USER", "ageBracket": "25-34"
    });
    for (key, value) in top.as_object().unwrap() {
        assert_eq!(&body[key], value, "{key}");
    }
    assert_eq!(body.as_object().unwrap().len(), 10, "{body}");

    let profile = &body["profile"];
    assert_eq!(profile["fullName"], "Athlete ahmed");
    assert_eq!(profile["countryCode"], "TN");
    assert_eq!(profile["governorate"]["id"], governorate.to_string());
    assert!(profile["governorate"]["code"].is_string());
    for language in ["fr", "en", "ar"] {
        assert!(profile["governorate"]["name"][language].is_string(), "{language}");
        assert!(profile["city"]["name"][language].is_string(), "{language}");
    }
    assert_eq!(profile["city"]["id"], city.to_string());
    for absent in ["bio", "gender", "gym", "experienceLevelDeclared", "calibrationEndsAt"] {
        assert!(profile[absent].is_null(), "{absent}");
        assert!(profile.as_object().unwrap().contains_key(absent), "{absent} must be present, as null");
    }
    assert_eq!(profile["plannedTrainingDaysPerWeek"], 3);
    assert_eq!(profile["onboardingCompleted"], false);
    assert_eq!(profile["sports"], json!([]));

    assert_eq!(
        body["settings"],
        json!({"locale": "fr", "theme": "DARK", "reducedMotion": null, "defaultVisibility": "FRIENDS",
               "showAgeBracket": false, "showOnLeaderboards": true, "streakFreezeDaysPerWeek": 2})
    );
    assert_eq!(
        body["stats"],
        json!({"xpTotal": 0, "level": 1, "levelTitleKey": "level.title.beginner", "xpIntoLevel": 0,
               "xpForNextLevel": 100, "seasonLp": 0, "division": null, "leaderboardEligible": false})
    );
    assert_eq!(body["streak"], json!({"currentWeeks": 0, "longestWeeks": 0, "currentDays": 0}));

    // Neither the date of birth nor anything about the password leaves the API.
    let text = body.to_string();
    assert!(!text.contains("1995") && !text.contains("argon") && !text.to_lowercase().contains("password"), "{text}");
}

#[sqlx::test]
async fn me_has_the_shape_recorded_from_the_old_api(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let recorded: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_same_shape("GET /me", &recorded["GET /me"], &me(&app, &session).await.json);
    // The session too: the app's offline demo holds one.
    assert_same_shape("POST /auth/login", &recorded["POST /auth/login"], &session);
}

#[sqlx::test]
async fn me_follows_the_account(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let user: Uuid = session["userId"].as_str().unwrap().parse().unwrap();
    let sports: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, code FROM sports ORDER BY code LIMIT 2")
        .fetch_all(&app.db)
        .await
        .unwrap();
    for (i, (sport, _)) in sports.iter().enumerate() {
        sqlx::query("INSERT INTO user_sports (user_id, sport_id, is_primary) VALUES (?, ?, ?)")
            .bind(user)
            .bind(sport)
            .bind(i == 1)
            .execute(&app.db)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE profiles SET onboarding_completed_at = UTC_TIMESTAMP(6), calibration_ends_at = '2026-11-01 08:00:00.000000', \
         bio = 'Rx athlete', gender = 'MALE' WHERE user_id = ?",
    )
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query("UPDATE user_stats SET level = 7, xp_total = 5000000000 WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();

    let body = me(&app, &session).await.json;
    assert_eq!(body["emailVerified"], true);
    // The primary sport first.
    assert_eq!(
        body["profile"]["sports"],
        json!([
            {"id": sports[1].0.to_string(), "code": sports[1].1, "isPrimary": true},
            {"id": sports[0].0.to_string(), "code": sports[0].1, "isPrimary": false}
        ])
    );
    assert_eq!(body["profile"]["onboardingCompleted"], true);
    assert_eq!(body["profile"]["calibrationEndsAt"], "2026-11-01T08:00:00.000Z");
    assert_eq!(body["profile"]["bio"], "Rx athlete");
    assert_eq!(body["profile"]["gender"], "MALE");
    assert_eq!(body["stats"]["level"], 7);
    assert_eq!(body["stats"]["levelTitleKey"], "level.title.rookie");
    assert_eq!(body["stats"]["xpTotal"], 5_000_000_000_i64);
}

#[sqlx::test]
async fn me_is_ones_own_and_needs_an_app_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let ahmed = register(&app, "ahmed").await;
    let leila = register(&app, "leila").await;
    assert_eq!(me(&app, &ahmed).await.json["username"], "ahmed");
    assert_eq!(me(&app, &leila).await.json["username"], "leila");

    assert_eq!(app.call(Method::GET, ME, None, None).await.json["code"], "UNAUTHENTICATED");
    let admin = create_user(&app, "admin", Role::Admin).await;
    let panel = open_session(&app, admin, Role::Admin, Audience::Admin).await;
    assert_eq!(me(&app, &panel).await.json["code"], "TOKEN_INVALID");
    // The same administrator, signed in to the app, has a profile like anyone.
    let in_app = open_session(&app, admin, Role::Admin, Audience::App).await;
    assert_eq!(me(&app, &in_app).await.json["role"], "ADMIN");
}
```

- [ ] **Step 2: Run them to see them fail**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test me 2>&1 | grep -E "^test |test result"
```

Expected: 4 tests fail with `404`.

- [ ] **Step 3: Write the module**

Add `pub mod me;` to `src/modules/mod.rs`, and end `api()` in `src/http/mod.rs` with:

```rust
    let api = modules::admin_auth::routes(api);
    modules::me::routes(api)
```

Create `src/modules/me.rs`:

```rust
//! `/me`: what the signed-in athlete sees of their own account.
//! Every query here carries the user id of the session: there is no way to ask for someone else.

use axum::{Json, extract::State};
use chrono::Utc;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    rules::Rules,
    security::policy,
    state::AppState,
    types::{Role, iso},
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me", me)
}

async fn me(State(state): State<AppState>, AppUser(user): AppUser) -> Result<Json<Value>, AppError> {
    Ok(Json(payload(&state, user.id).await?))
}

/// Everything the home screen needs about the signed-in user, in one answer.
pub async fn payload(state: &AppState, user: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query!(
        r#"SELECT u.username, u.email, u.email_verified_at, u.role AS "role: Role", u.date_of_birth,
                  p.full_name, p.bio, p.gender, p.country_code, p.experience_level_declared,
                  p.planned_training_days_per_week, p.calibration_ends_at, p.onboarding_completed_at,
                  g.id AS "governorate_id: Uuid", g.code AS governorate_code,
                  g.name_fr AS governorate_fr, g.name_en AS governorate_en, g.name_ar AS governorate_ar,
                  c.id AS "city_id: Uuid", c.name_fr AS city_fr, c.name_en AS city_en, c.name_ar AS city_ar,
                  s.locale, s.theme, s.reduced_motion AS "reduced_motion: bool", s.default_visibility,
                  s.show_age_bracket AS "show_age_bracket: bool",
                  s.show_on_leaderboards AS "show_on_leaderboards: bool", s.streak_freeze_days_per_week,
                  t.xp_total, t.level, t.xp_into_level, t.xp_for_next_level, t.season_lp, t.division_code,
                  t.leaderboard_eligible AS "leaderboard_eligible: bool",
                  k.current_weeks, k.longest_weeks, k.current_days
           FROM users u
           JOIN profiles p ON p.user_id = u.id
           JOIN governorates g ON g.id = p.governorate_id
           JOIN cities c ON c.id = p.city_id
           JOIN user_settings s ON s.user_id = u.id
           JOIN user_stats t ON t.user_id = u.id
           JOIN user_streaks k ON k.user_id = u.id
           WHERE u.id = ?"#,
        user
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Profile"))?;
    let sports = sqlx::query!(
        r#"SELECT sp.id AS "id: Uuid", sp.code, us.is_primary AS "is_primary: bool"
           FROM user_sports us JOIN sports sp ON sp.id = us.sport_id
           WHERE us.user_id = ?
           ORDER BY us.is_primary DESC, sp.code"#,
        user
    )
    .fetch_all(&state.db)
    .await?;
    let rules = Rules::active(&state.db).await?;

    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    let name = |fr: &str, en: &str, ar: &str| json!({"fr": fr, "en": en, "ar": ar});
    let sports: Vec<Value> = sports
        .iter()
        .map(|sport| json!({"id": sport.id.to_string(), "code": sport.code, "isPrimary": sport.is_primary}))
        .collect();
    Ok(json!({
        "id": user.to_string(),
        "username": row.username,
        "email": row.email,
        "emailVerified": row.email_verified_at.is_some(),
        "role": row.role.as_str(),
        // The owner sees their bracket. The date itself never leaves the API.
        "ageBracket": policy::age_bracket(policy::age_in_years(row.date_of_birth, today)),
        "profile": {
            "fullName": row.full_name,
            "bio": row.bio,
            "gender": row.gender,
            "countryCode": row.country_code,
            "governorate": {
                "id": row.governorate_id.to_string(),
                "code": row.governorate_code,
                "name": name(&row.governorate_fr, &row.governorate_en, &row.governorate_ar),
            },
            "city": {
                "id": row.city_id.to_string(),
                "name": name(&row.city_fr, &row.city_en, &row.city_ar),
            },
            // Gyms arrive with part 3.
            "gym": null,
            "experienceLevelDeclared": row.experience_level_declared,
            "plannedTrainingDaysPerWeek": row.planned_training_days_per_week,
            "calibrationEndsAt": row.calibration_ends_at.map(iso),
            "onboardingCompleted": row.onboarding_completed_at.is_some(),
            "sports": sports,
        },
        "settings": {
            "locale": row.locale,
            "theme": row.theme,
            "reducedMotion": row.reduced_motion,
            "defaultVisibility": row.default_visibility,
            "showAgeBracket": row.show_age_bracket,
            "showOnLeaderboards": row.show_on_leaderboards,
            "streakFreezeDaysPerWeek": row.streak_freeze_days_per_week,
        },
        // Created with their defaults at registration; the scoring engine of part 2 fills them.
        "stats": {
            "xpTotal": row.xp_total,
            "level": row.level,
            "levelTitleKey": rules.level_title_key(row.level),
            "xpIntoLevel": row.xp_into_level,
            "xpForNextLevel": row.xp_for_next_level,
            "seasonLp": row.season_lp,
            "division": row.division_code,
            "leaderboardEligible": row.leaderboard_eligible,
        },
        "streak": {
            "currentWeeks": row.current_weeks,
            "longestWeeks": row.longest_weeks,
            "currentDays": row.current_days,
        },
    }))
}
```

- [ ] **Step 4: Run the tests**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test me 2>&1 | grep -E "^test |test result"
```

Expected: 4 tests pass. If `me_has_the_shape_recorded_from_the_old_api` names a key, the payload differs from what the app was recorded reading: fix the payload, not the recording.

- [ ] **Step 5: Prepare, lint, commit**

Message: `feat(backend): GET /me with the profile payload the app reads`

---

### Task 10: The security suite, and the documents

One test per promise of the spec that no earlier task already pins. The promises pinned earlier: the same answer for an unknown email and a wrong password, the lock and its doubling, the judge refused by the app (Task 6); reuse and concurrent refresh, a ban on the next request, an old token dead after a version change (Task 4), after a reset (Task 7), after a role change (Task 8); the two audiences kept apart (Tasks 4 and 8); unknown fields and literal storage of text (Task 5); the rate limits with `Retry-After` (Tasks 4 to 7); links that work once and expire (Task 7); what `fl_app` cannot do to the audit log and the schema (plan 1a).

**Files:**
- Create: `apps/backend/tests/security.rs`
- Modify: `README.md`, `handoff.md`, `docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`

**Interfaces:**
- Consumes: `backend::http::route_table()`, every route of this plan, the helpers of `tests/common`.
- Produces: the list of public routes, `PUBLIC`, in `tests/security.rs`. A route added by a later plan that is not on this list must answer 401 without a session, or the suite fails.

- [ ] **Step 1: Write the suite**

Create `apps/backend/tests/security.rs` with the editor:

```rust
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::{
    body::Body,
    http::{Method, StatusCode},
};
use backend::{http::route_table, security::tokens::Audience, types::Role};
use common::{
    PASSWORD, create_user, open_session, register, registration, request, seeded,
    seeded_with_cuttable_redis,
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

/// Every route that answers without a session. Adding a line here is a security decision: it is
/// reviewed as one.
const PUBLIC: [(&str, &str); 14] = [
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/ready"),
    ("GET", "/api/v1/ref/governorates"),
    ("GET", "/api/v1/ref/cities"),
    ("GET", "/api/v1/ref/sports"),
    ("GET", "/api/v1/ref/exercises"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/email/verify"),
    ("POST", "/api/v1/auth/password/forgot"),
    ("POST", "/api/v1/auth/password/reset"),
    ("POST", "/api/v1/admin/auth/login"),
    ("POST", "/api/v1/admin/auth/refresh"),
];

fn is_public(method: &Method, path: &str) -> bool {
    PUBLIC.contains(&(method.as_str(), path))
}

fn protected() -> Vec<(Method, &'static str)> {
    route_table()
        .into_iter()
        .filter(|(method, path)| !is_public(method, path))
        .collect()
}

#[sqlx::test]
async fn every_route_wants_a_session_unless_it_is_on_the_public_list(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let table = route_table();
    for (method, path) in &table {
        let reply = app.call(method.clone(), path, None, None).await;
        if is_public(method, path) {
            // It may dislike the empty request, but never for want of a session.
            assert_ne!(reply.json["code"], "UNAUTHENTICATED", "{method} {path}");
        } else {
            assert_eq!(
                (reply.status, reply.json["code"].as_str()),
                (StatusCode::UNAUTHORIZED, Some("UNAUTHENTICATED")),
                "{method} {path} answered without a session"
            );
        }
    }
    for (method, path) in PUBLIC {
        assert!(
            table.iter().any(|(m, p)| m.as_str() == method && *p == path),
            "{method} {path} is on the public list but is not a route"
        );
    }
    assert!(!protected().is_empty());
}

/// Who may use a protected route. Routes under `/admin/` belong to the panel, the others to the
/// app. A later plan that adds a route with a narrower rule (administrators only, say) extends this.
fn allowed(role: Role, path: &str) -> bool {
    if path.starts_with("/api/v1/admin/") {
        role.can_open_panel()
    } else {
        !role.is_judge()
    }
}

#[sqlx::test]
async fn every_role_is_tried_against_every_protected_route(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    for (i, role) in Role::ALL.into_iter().enumerate() {
        let user = create_user(&app, &format!("role{i}"), role).await;
        let app_token = open_session(&app, user, role, Audience::App).await["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let panel_token = open_session(&app, user, role, Audience::Admin).await["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        for (method, path) in protected() {
            let (own, other) = if path.starts_with("/api/v1/admin/") {
                (&panel_token, &app_token)
            } else {
                (&app_token, &panel_token)
            };
            // No body: an allowed caller is then refused for the missing body, which is neither 401
            // nor 403. What is tested here is who gets past the door.
            let reply = app.call(method.clone(), path, Some(own.as_str()), None).await;
            let passed = !matches!(reply.status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN);
            assert_eq!(passed, allowed(role, path), "{role:?} on {method} {path}: {} {}", reply.status, reply.json);
            if !passed {
                assert_eq!(reply.json["code"], "FORBIDDEN", "{role:?} on {method} {path}");
            }
            // A token of the other audience is not a token at all here.
            let wrong = app.call(method.clone(), path, Some(other.as_str()), None).await;
            assert_eq!(
                (wrong.status, wrong.json["code"].as_str()),
                (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")),
                "{role:?} with the other audience on {method} {path}"
            );
        }
    }
}

#[sqlx::test]
async fn identity_routes_refuse_when_redis_is_down_and_the_rest_keeps_working(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let (app, redis) = seeded_with_cuttable_redis(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    let access = session["accessToken"].as_str();
    create_user(&app, "admin", Role::Admin).await;
    let fresh = registration(&app, "leila").await;

    redis.abort();
    let _ = redis.await;

    let token = json!({"token": "x".repeat(43)});
    let refresh = json!({"refreshToken": "x".repeat(43)});
    let closed: [(&str, Value); 8] = [
        ("/api/v1/auth/register", fresh),
        ("/api/v1/auth/login", json!({"email": "ahmed@example.com", "password": PASSWORD})),
        ("/api/v1/auth/refresh", refresh.clone()),
        ("/api/v1/auth/email/verify", token.clone()),
        ("/api/v1/auth/password/forgot", json!({"email": "ahmed@example.com"})),
        ("/api/v1/auth/password/reset", json!({"token": "x".repeat(43), "newPassword": "a brand new passphrase"})),
        ("/api/v1/admin/auth/login", json!({"email": "admin@example.com", "password": PASSWORD})),
        ("/api/v1/admin/auth/refresh", refresh),
    ];
    for (path, body) in closed {
        let reply = app.post(path, body).await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::SERVICE_UNAVAILABLE, Some("SERVICE_UNAVAILABLE")),
            "{path}"
        );
        assert!(!reply.json.to_string().to_lowercase().contains("redis"), "{path}: the answer says why");
    }
    // Costly for each use, so it refuses as well.
    let resend = app.call(Method::POST, "/api/v1/auth/email/resend", access, None).await;
    assert_eq!(resend.status, StatusCode::SERVICE_UNAVAILABLE);

    // What does not create or prove an identity keeps working: a signed-in athlete still reads
    // their profile, and the catalog is still served.
    assert_eq!(app.call(Method::GET, "/api/v1/me", access, None).await.status, StatusCode::OK);
    assert_eq!(app.get("/api/v1/ref/sports").await.status, StatusCode::OK);
    // The lockout does not depend on Redis: it lives in MariaDB.
    let locked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE failed_login_count > 0")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(locked, 0, "a refused request did not reach the password check");
}

#[sqlx::test]
async fn account_routes_refuse_bodies_that_are_too_large_or_not_json(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    for path in ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/admin/auth/login"] {
        let huge = json!({"email": "a@example.com", "password": "x".repeat(300 * 1024)});
        let reply = app.post(path, huge).await;
        assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE, "{path}");

        let form = request(Method::POST, path)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from("email=a%40example.com&password=x"))
            .unwrap();
        assert_eq!(app.send(form).await.status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{path}");

        let array = request(Method::POST, path)
            .header("content-type", "application/json")
            .body(Body::from(r#"["a@example.com", "x"]"#))
            .unwrap();
        assert_eq!(app.send(array).await.status, StatusCode::UNPROCESSABLE_ENTITY, "{path}");
    }
}

#[sqlx::test]
async fn sql_in_a_credential_is_only_a_wrong_credential(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;
    for password in ["' OR '1'='1", "\" OR 1=1 -- ", "x'; DROP TABLE users; --", "\\"] {
        let reply = app
            .post("/api/v1/auth/login", json!({"email": "ahmed@example.com", "password": password}))
            .await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")),
            "{password}"
        );
    }
    // A quote is a legal character of an address: it finds nobody, and breaks nothing.
    let reply = app
        .post("/api/v1/auth/login", json!({"email": "o'brien@example.com", "password": PASSWORD}))
        .await;
    assert_eq!(reply.json["code"], "INVALID_CREDENTIALS");
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(users, 1);
}

#[sqlx::test]
async fn nothing_secret_is_written_to_redis(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = common::seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    app.post("/api/v1/auth/password/forgot", json!({"email": "ahmed@example.com"}))
        .await;
    app.post("/api/v1/auth/login", json!({"email": "ahmed@example.com", "password": PASSWORD}))
        .await;

    // Everything this application wrote: the rate-limit counters and the two queued jobs.
    let mut redis = app.state.redis.clone();
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{}*", app.state.redis_prefix))
        .query_async(&mut redis)
        .await
        .unwrap();
    let jobs: redis::Value = redis::cmd("XRANGE")
        .arg(format!("{}jobs", app.state.redis_prefix))
        .arg("-")
        .arg("+")
        .query_async(&mut redis)
        .await
        .unwrap();
    let written = format!("{keys:?} {jobs:?}");
    assert!(written.contains("EMAIL_VERIFY") && written.contains("PASSWORD_RESET"), "{written}");
    for secret in [
        "ahmed@example.com",
        "example.com",
        PASSWORD,
        session["refreshToken"].as_str().unwrap(),
        session["accessToken"].as_str().unwrap(),
        "127.0.0.1",
    ] {
        assert!(!written.contains(secret), "{secret} is in Redis: {written}");
    }
}
```

- [ ] **Step 2: Run the suite**

```bash
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test --test security 2>&1 | grep -E "^test |test result"
```

Expected: 6 tests pass. These tests describe code that already exists, so they are not seen failing first; each was written against a promise, and a failure here is a defect of an earlier task. Fix the code, in the module that owns it, not the test. To see that the suite can fail, remove one line of `PUBLIC` (the first test must fail) and change `!role.is_judge()` to `true` in `src/http/auth.rs` (the second must fail), then put both back.

- [ ] **Step 3: The whole flow, by hand**

With `serve` and `worker` running (two terminals, from `apps/backend`), and `B=http://127.0.0.1:3100/api/v1`:

```bash
curl -s -X POST $B/auth/login -H 'content-type: application/json' -d '{"email":"plan1b@example.com","password":"a long enough passphrase"}' > /tmp/s.json
A=$(python3 -c "import json; print(json.load(open('/tmp/s.json'))['accessToken'])")
curl -s $B/me -H "authorization: Bearer $A" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['username'], d['emailVerified'], d['stats']['levelTitleKey'])"
T=$(curl -s http://127.0.0.1:8025/api/v1/messages | python3 -c "import json,sys,urllib.request; m=json.load(sys.stdin)['messages'][0]; print(json.load(urllib.request.urlopen('http://127.0.0.1:8025/api/v1/message/'+m['ID']))['Text'].split('token=')[1].split()[0])")
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/auth/email/verify -H 'content-type: application/json' -d "{\"token\":\"$T\"}"
curl -s $B/me -H "authorization: Bearer $A" | python3 -c "import json,sys; print(json.load(sys.stdin)['emailVerified'])"
cargo run -q -- promote plan1b@example.com ADMIN
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/auth/login -H 'content-type: application/json' -d '{"email":"plan1b@example.com","password":"a long enough passphrase"}'
```

(The account `plan1b@example.com` is the one of Task 5, Step 7.) Expected, in order: `plan1b False level.title.beginner`; `204`; `True`; `plan1b@example.com is now ADMIN`; `200`. Stop both processes by process id.

- [ ] **Step 4: The documents**

`README.md`, in the Rust backend section, after the commands that are already listed:

````markdown
```bash
cargo run -- worker                                   # sends the emails; run one next to the API
cargo run -- promote someone@example.com ADMIN        # the first staff account; roles are never self-assigned
```

Accounts (plan 1b): registration, sign-in with lockout, sessions with single-use refresh tokens, email
verification and password reset through links, the admin panel's sign-in, and `GET /me`. The emails go
to Mailpit locally: http://localhost:8025.
````

`docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`: replace the paragraph that begins `Part 1 is built by two plans` with:

```markdown
Part 1 is built by three plans: **1a, foundation** (everything that needs no user account:
`docs/superpowers/plans/2026-10-06-rust-backend-1a-foundation.md`), **1b, accounts and sessions**
(`docs/superpowers/plans/2026-10-07-rust-backend-1b-accounts.md`) and **1c, profile and privacy** (profile
and settings changes, onboarding, export, account deletion with its daily sweep).
```

and, in "Passwords and sign-in", after the line about the common-password list, add:

```markdown
- Emails are trimmed, lower-cased and must be printable ASCII; passwords are normalised (NFKC) before
  hashing. Both rules exist so that two spellings the database or a keyboard treats as one are one here too.
```

`handoff.md`: in "Current state", replace the sentence saying `there are no accounts yet` with what now exists (the fifteen endpoints, the worker, the promote command, the number of tests of the last run); in "Active files", add the files of this plan's File Structure; in "Next steps", replace the item about plan 1b with plan 1c and keep the open points. Restore the file from `HEAD` first if `git status` shows it modified by line endings only.

- [ ] **Step 5: Everything, once more**

```bash
cargo fmt --check
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo clippy --all-targets -- -D warnings
SQLX_OFFLINE=true CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo clippy --all-targets -- -D warnings
CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target" cargo test 2>&1 | grep -E "^test result|FAILED"
cargo audit && cargo deny check
```

Expected: no output from `fmt`; `Finished` twice; every `test result` line `ok`; no vulnerability; `advisories ok, bans ok, licenses ok, sources ok`. The secret scan has never run on this branch: before the first push, run `gitleaks detect` (or let CI do it on the pull request) and expect the test fixtures of `tests/common/mod.rs` and `src/config.rs` to need an allow-list entry.

- [ ] **Step 6: Commit**

```bash
git -C ../.. add apps/backend/tests/security.rs README.md handoff.md docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md
git -C ../.. commit -m "test(backend): security suite over every route and role; docs for plan 1b"
```

---

## Done when

- `cargo test` passes with the suites of this plan: `jobs`, `mail`, `emails`, `sessions`, `register`, `login`, `admin_auth`, `me`, `security`, next to those of plan 1a.
- The flow of Task 10, Step 3 gives the expected lines against a running `serve` and `worker`.
- The mobile app pointed at the Rust API (`EXPO_PUBLIC_API_URL=http://<this machine>:3100/api/v1`) registers an account and signs in. It then stops at onboarding, whose three endpoints are plan 1c.
- The admin panel pointed at the Rust API (`VITE_API_URL`, with its origin in `CORS_ORIGINS`) signs in with a promoted account and shows who is signed in. Its pages stay empty: their routes are part 5.

## Left for plan 1c, on purpose

`PATCH /me/profile`, `PATCH /me/settings`, `POST /me/onboarding/sports`, `/baselines`, `/complete`, `GET /me/export`, `DELETE /me`, the daily sweep (anonymising accounts whose 30 days are over, removing expired tokens, behind a Redis lock), and what the review of 1a left open about deletion: what anonymising writes into `users.date_of_birth`, and one pending deletion per account.

