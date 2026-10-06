//! Value sets shared by several modules.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    User,
    GymAdmin,
    Moderator,
    Admin,
    SuperAdmin,
    Judge,
    HeadJudge,
}

impl Role {
    pub const ALL: [Role; 7] = [Role::User, Role::GymAdmin, Role::Moderator, Role::Admin, Role::SuperAdmin, Role::Judge, Role::HeadJudge];

    /// Judge accounts only judge, in the admin panel. They never sign in to the app.
    pub fn is_judge(self) -> bool {
        matches!(self, Role::Judge | Role::HeadJudge)
    }

    /// Who may open the admin panel: staff, and judges (who only get the judge space there).
    pub fn can_open_panel(self) -> bool {
        matches!(self, Role::Moderator | Role::Admin | Role::SuperAdmin) || self.is_judge()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn roles_use_their_wire_names() {
        assert_eq!(serde_json::to_string(&Role::GymAdmin).unwrap(), "\"GYM_ADMIN\"");
        assert_eq!(serde_json::from_str::<Role>("\"HEAD_JUDGE\"").unwrap(), Role::HeadJudge);
        assert!(serde_json::from_str::<Role>("\"ROOT\"").is_err());
    }

    #[test]
    fn the_panel_is_for_staff_and_judges_only() {
        let panel: Vec<Role> = Role::ALL.into_iter().filter(|r| r.can_open_panel()).collect();
        assert_eq!(panel, [Role::Moderator, Role::Admin, Role::SuperAdmin, Role::Judge, Role::HeadJudge]);
        let judges: Vec<Role> = Role::ALL.into_iter().filter(|r| r.is_judge()).collect();
        assert_eq!(judges, [Role::Judge, Role::HeadJudge]);
    }
}
