/**
 * Transactional email texts. Kept deliberately small and plain-text; the mobile app owns the rich UI.
 * Locale falls back to French (default locale for Tunisia, Q-12).
 */
type Locale = 'fr' | 'en' | 'ar';
type Template = (p: { appName: string; link: string }) => { subject: string; text: string };

const templates: Record<'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'ACCOUNT_LOCKED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_BANNED', Record<Locale, Template>> = {
  ACCOUNT_SUSPENDED: {
    fr: ({ appName, link }) => ({ subject: `${appName} : compte suspendu`, text: `Ton compte a été suspendu à la suite d'une décision de modération.\nConsulte le motif et la durée, et fais appel si tu n'es pas d'accord (lien valable 30 jours) :\n${link}\n` }),
    en: ({ appName, link }) => ({ subject: `${appName}: account suspended`, text: `Your account was suspended by a moderation decision.\nSee the reason and length, and appeal if you disagree (link valid for 30 days):\n${link}\n` }),
    ar: ({ appName, link }) => ({ subject: `${appName}: تم تعليق الحساب`, text: `تم تعليق حسابك بقرار من الإشراف.\nاطلع على السبب والمدة، وقدّم طعنًا إن لم توافق (الرابط صالح لمدة 30 يومًا):\n${link}\n` }),
  },
  ACCOUNT_BANNED: {
    fr: ({ appName, link }) => ({ subject: `${appName} : compte banni`, text: `Ton compte a été banni à la suite d'une décision de modération.\nConsulte le motif et fais appel si tu n'es pas d'accord (lien valable 30 jours) :\n${link}\n` }),
    en: ({ appName, link }) => ({ subject: `${appName}: account banned`, text: `Your account was banned by a moderation decision.\nSee the reason and appeal if you disagree (link valid for 30 days):\n${link}\n` }),
    ar: ({ appName, link }) => ({ subject: `${appName}: تم حظر الحساب`, text: `تم حظر حسابك بقرار من الإشراف.\nاطلع على السبب وقدّم طعنًا إن لم توافق (الرابط صالح لمدة 30 يومًا):\n${link}\n` }),
  },
  EMAIL_VERIFY: {
    fr: ({ appName, link }) => ({ subject: `${appName} : confirme ton adresse email`, text: `Bienvenue !\n\nConfirme ton adresse email (lien valable 24 h) :\n${link}\n` }),
    en: ({ appName, link }) => ({ subject: `${appName}: confirm your email`, text: `Welcome!\n\nConfirm your email address (link valid for 24 h):\n${link}\n` }),
    ar: ({ appName, link }) => ({ subject: `${appName}: أكّد بريدك الإلكتروني`, text: `مرحبًا!\n\nأكّد عنوان بريدك الإلكتروني (الرابط صالح لمدة 24 ساعة):\n${link}\n` }),
  },
  PASSWORD_RESET: {
    fr: ({ appName, link }) => ({ subject: `${appName} : réinitialisation du mot de passe`, text: `Pour choisir un nouveau mot de passe (lien valable 1 h) :\n${link}\n\nSi tu n'as rien demandé, ignore cet email.\n` }),
    en: ({ appName, link }) => ({ subject: `${appName}: reset your password`, text: `To choose a new password (link valid for 1 h):\n${link}\n\nIf you didn't ask for this, ignore this email.\n` }),
    ar: ({ appName, link }) => ({ subject: `${appName}: إعادة تعيين كلمة المرور`, text: `لاختيار كلمة مرور جديدة (الرابط صالح لمدة ساعة):\n${link}\n\nإذا لم تطلب ذلك، تجاهل هذا البريد.\n` }),
  },
  ACCOUNT_LOCKED: {
    fr: ({ appName, link }) => ({ subject: `${appName} : connexion bloquée temporairement`, text: `Plusieurs tentatives de connexion ont échoué. Ton compte est bloqué temporairement.\nSi ce n'était pas toi, change ton mot de passe : ${link}\n` }),
    en: ({ appName, link }) => ({ subject: `${appName}: sign-in temporarily locked`, text: `Several sign-in attempts failed, so your account is temporarily locked.\nIf this wasn't you, change your password: ${link}\n` }),
    ar: ({ appName, link }) => ({ subject: `${appName}: تم قفل تسجيل الدخول مؤقتًا`, text: `فشلت عدة محاولات لتسجيل الدخول، لذلك تم قفل حسابك مؤقتًا.\nإذا لم تكن أنت، غيّر كلمة المرور: ${link}\n` }),
  },
};

export function renderMail(tag: keyof typeof templates, locale: string | undefined, params: { appName: string; link: string }) {
  const byLocale = templates[tag];
  return (byLocale[(locale as Locale) ?? 'fr'] ?? byLocale.fr)(params);
}
