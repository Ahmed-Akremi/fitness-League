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
