/**
 * Transactional email texts. Kept deliberately small and plain-text; the mobile app owns the rich UI.
 * Locale falls back to French (default locale for Tunisia, Q-12).
 */
type Locale = 'fr' | 'en' | 'ar';
type Template = (p: { appName: string; link: string }) => { subject: string; text: string };

const templates: Record<'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'ACCOUNT_LOCKED', Record<Locale, Template>> = {
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
