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
            format!(
                "To choose a new password (link valid for 1 h):\n{link}\n\nIf you didn't ask for this, ignore this email.\n"
            ),
        ),
        (JobKind::PasswordReset, "ar") => (
            format!("{app}: إعادة تعيين كلمة المرور"),
            format!(
                "لاختيار كلمة مرور جديدة (الرابط صالح لمدة ساعة):\n{link}\n\nإذا لم تطلب ذلك، تجاهل هذا البريد.\n"
            ),
        ),
        (JobKind::PasswordReset, _) => (
            format!("{app} : réinitialisation du mot de passe"),
            format!(
                "Pour choisir un nouveau mot de passe (lien valable 1 h) :\n{link}\n\nSi tu n'as rien demandé, ignore cet email.\n"
            ),
        ),
        (JobKind::AccountLocked, "en") => (
            format!("{app}: sign-in temporarily locked"),
            format!(
                "Several sign-in attempts failed, so your account is temporarily locked.\nIf this wasn't you, change your password: {link}\n"
            ),
        ),
        (JobKind::AccountLocked, "ar") => (
            format!("{app}: تم قفل تسجيل الدخول مؤقتًا"),
            format!(
                "فشلت عدة محاولات لتسجيل الدخول، لذلك تم قفل حسابك مؤقتًا.\nإذا لم تكن أنت، غيّر كلمة المرور: {link}\n"
            ),
        ),
        (JobKind::AccountLocked, _) => (
            format!("{app} : connexion bloquée temporairement"),
            format!(
                "Plusieurs tentatives de connexion ont échoué. Ton compte est bloqué temporairement.\nSi ce n'était pas toi, change ton mot de passe : {link}\n"
            ),
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
            let texts =
                ["en", "ar"].map(|locale| render(kind, locale, "Fitness League", "https://x/y"));
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
