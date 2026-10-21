import type { Locale } from '../../core/i18n';

/**
 * Legal documents shown in the app. `LEGAL_VERSION` is the version the registration consents record
 * (`documentVersion` in features/auth/api.ts): change both together, and the date, when a text changes.
 */
export const LEGAL_VERSION = '2026-09';
export const LEGAL_UPDATED = '2026-09-25';

export type LegalDocId = 'terms' | 'privacy' | 'health';
export const LEGAL_DOCS: LegalDocId[] = ['terms', 'privacy', 'health'];

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  title: string;
  summary: string;
  sections: LegalSection[];
}

const fr: Record<LegalDocId, LegalDoc> = {
  terms: {
    title: "Conditions générales d'utilisation",
    summary: "Les règles d'utilisation de Fitness League : ton compte, les entraînements, la ligue, les salles et les compétitions.",
    sections: [
      { heading: '1. Objet', body: ["Fitness League est une application d'entraînement et de compétition pour les athlètes, les salles et les organisateurs d'événements en Tunisie. Ces conditions encadrent l'utilisation de l'application et du site.", "En créant un compte, tu acceptes ces conditions et la politique de confidentialité."] },
      { heading: '2. Compte', body: ["Tu dois avoir l'âge minimum indiqué à l'inscription et donner des informations exactes.", 'Ton compte est personnel : tu es responsable de ton mot de passe et de ce qui est fait avec ton compte. Préviens-nous sans attendre en cas d’utilisation que tu n’as pas autorisée.', "Un e-mail vérifié est nécessaire pour certaines actions, comme créer un événement."] },
      { heading: '3. Entraînements, ligue et classements', body: ["Les points, divisions et classements sont calculés à partir des entraînements que tu enregistres. Ils doivent refléter ce que tu as réellement fait.", "Les résultats anormaux peuvent être vérifiés, retenus ou annulés. La triche (résultats inventés, preuves trompeuses, comptes multiples) peut entraîner une sanction, jusqu'à la suspension du compte."] },
      { heading: '4. Compétitions', body: ["Chaque compétition est organisée par son organisateur, qui fixe le règlement, les catégories, les WODs, le prix et le planning. Fitness League fournit l'outil, pas l'événement.", "Les scores sont validés par les juges : en ligne à partir de ta vidéo, sur place par le juge de ton couloir, après ta confirmation. Tu peux contester un score dans le délai prévu ; la décision du juge principal ou de l'organisateur est finale.", "L'inscription et son paiement se règlent avec l'organisateur selon ses conditions, y compris pour un remboursement."] },
      { heading: '5. Contenus', body: ["Tu restes propriétaire de ce que tu publies (photos, commentaires, liens vidéo). Tu nous autorises à l'afficher dans l'application selon la visibilité que tu choisis.", "Sont interdits : les contenus illégaux, haineux, harcelants, sexuels ou trompeurs, et l'usage du travail d'autrui sans droit. Tout contenu peut être signalé et retiré."] },
      { heading: '6. Santé et sécurité', body: ["Le sport comporte des risques. Entraîne-toi selon ton niveau, échauffe-toi et consulte un médecin en cas de doute. Les WODs et défis de l'application ne sont pas des conseils médicaux.", "Tu participes aux entraînements, défis et compétitions sous ta propre responsabilité."] },
      { heading: '7. Disponibilité', body: ["Nous faisons notre possible pour que le service fonctionne sans interruption, sans pouvoir le garantir. Des fonctions peuvent évoluer ou être retirées."] },
      { heading: '8. Fin du compte', body: ["Tu peux supprimer ton compte à tout moment dans Réglages. Il est désactivé tout de suite et effacé après 30 jours ; pendant ce délai, te reconnecter annule la suppression.", "Nous pouvons suspendre ou fermer un compte qui ne respecte pas ces conditions."] },
      { heading: '9. Droit applicable', body: ["Ces conditions sont régies par le droit tunisien. Nous pouvons les modifier ; la nouvelle version est publiée dans l'application avec sa date."] },
    ],
  },
  privacy: {
    title: 'Politique de confidentialité',
    summary: "Les données que nous traitons, pourquoi, combien de temps, et tes droits.",
    sections: [
      { heading: '1. Responsable', body: ["Fitness League traite tes données personnelles conformément à la loi organique tunisienne n° 2004-63 du 27 juillet 2004 sur la protection des données à caractère personnel."] },
      { heading: '2. Données traitées', body: ['Compte : e-mail, nom d’utilisateur, nom complet, mot de passe (jamais stocké en clair), date de naissance, gouvernorat et ville.', 'Activité : entraînements, points, ligue, badges, défis, amis, salles, commentaires et réactions.', 'Compétitions : inscriptions, catégorie, paiements déclarés par l’organisateur, scores, liens vidéo, couloirs et heats.', 'Données de santé, seulement avec ton accord : voir le document « Données de santé ».', 'Technique : appareil, langue, jetons de notification, journaux de sécurité.'] },
      { heading: '3. Pourquoi', body: ["Faire fonctionner ton compte et l'application, calculer les points et les classements, organiser et juger les compétitions, t'envoyer les e-mails et notifications utiles, prévenir la triche et les abus, assurer la sécurité."] },
      { heading: '4. Qui les voit', body: ["Les autres utilisateurs voient ce que tes réglages de confidentialité permettent (visibilité des entraînements, présence dans les classements, tranche d'âge). Ta date de naissance n'est jamais affichée.", "L'organisateur et les juges d'une compétition voient ce qu'il faut pour la gérer : ton nom, ta catégorie, ton inscription, tes scores et tes vidéos.", "Nous ne vendons pas tes données. Des prestataires techniques (hébergement, envoi d'e-mails, notifications) les traitent pour notre compte."] },
      { heading: '5. Durée', body: ["Tant que ton compte existe. Après une demande de suppression, le compte est effacé ou anonymisé au bout de 30 jours ; les résultats publiés de compétitions restent sous forme anonyme."] },
      { heading: '6. Sécurité', body: ['Connexions chiffrées, mots de passe hachés, données de santé chiffrées, accès limité et journalisé.'] },
      { heading: '7. Tes droits', body: ["Tu peux consulter et corriger tes données dans ton profil, les exporter et supprimer ton compte dans Réglages, retirer ton accord pour les données de santé, et régler ta visibilité.", "Tu peux aussi saisir l'Instance nationale de protection des données personnelles (INPDP)."] },
      { heading: '8. Modifications', body: ["Nous publierons toute nouvelle version dans l'application avec sa date ; un changement important te sera signalé."] },
    ],
  },
  health: {
    title: 'Données de santé',
    summary: "Les mesures corporelles et données de santé : facultatives, chiffrées, jamais publiques.",
    sections: [
      { heading: '1. Quelles données', body: ["Poids, mensurations et mesures que tu enregistres dans « Corps », et les données de santé que tu choisis de lier à tes entraînements."] },
      { heading: '2. Ton accord', body: ["Ces données ne sont traitées que si tu as donné ton accord, à l'inscription ou plus tard. Sans accord, l'application fonctionne sans elles.", "Tu peux retirer ton accord à tout moment : les données concernées ne sont plus utilisées."] },
      { heading: '3. Usage', body: ["Uniquement pour te montrer ta progression. Elles ne sont jamais affichées aux autres utilisateurs, aux salles ni aux organisateurs, et ne servent pas à la publicité."] },
      { heading: '4. Protection', body: ['Elles sont chiffrées dans notre base, avec des clés gardées à part, et incluses dans ton export de données.'] },
      { heading: '5. Avertissement', body: ["Fitness League n'est pas un dispositif médical. Rien dans l'application ne remplace l'avis d'un professionnel de santé."] },
    ],
  },
};

const en: Record<LegalDocId, LegalDoc> = {
  terms: {
    title: 'Terms and conditions',
    summary: 'How Fitness League may be used: your account, workouts, the league, gyms and competitions.',
    sections: [
      { heading: '1. Purpose', body: ['Fitness League is a training and competition app for athletes, gyms and event organizers in Tunisia. These terms govern the use of the app and the website.', 'By creating an account you accept these terms and the privacy policy.'] },
      { heading: '2. Account', body: ['You must be at least the minimum age shown at registration and give accurate information.', 'Your account is personal: you are responsible for your password and for what is done with your account. Tell us at once about any use you did not allow.', 'Some actions, such as creating an event, need a verified email.'] },
      { heading: '3. Workouts, league and leaderboards', body: ['Points, divisions and leaderboards are computed from the workouts you log. They must reflect what you really did.', 'Unusual results may be checked, held or cancelled. Cheating (made-up results, misleading proof, several accounts) may lead to a sanction, up to the suspension of the account.'] },
      { heading: '4. Competitions', body: ['Each competition is run by its organizer, who sets its rules, categories, WODs, price and schedule. Fitness League provides the tool, not the event.', 'Scores are validated by judges: online from your video, on site by your lane’s judge after you confirm. You may appeal a score within the stated time; the head judge’s or the organizer’s decision is final.', 'Registration and its payment are settled with the organizer under their conditions, refunds included.'] },
      { heading: '5. Content', body: ['You keep the rights to what you post (photos, comments, video links). You allow us to show it in the app with the visibility you choose.', 'Forbidden: illegal, hateful, harassing, sexual or misleading content, and using other people’s work without the right to. Any content may be reported and removed.'] },
      { heading: '6. Health and safety', body: ['Sport carries risks. Train at your level, warm up and see a doctor when in doubt. The app’s WODs and challenges are not medical advice.', 'You take part in workouts, challenges and competitions at your own risk.'] },
      { heading: '7. Availability', body: ['We do our best to keep the service running without interruption, without being able to guarantee it. Features may change or be withdrawn.'] },
      { heading: '8. Closing the account', body: ['You can delete your account at any time in Settings. It is deactivated at once and erased after 30 days; signing in during that time cancels the deletion.', 'We may suspend or close an account that breaks these terms.'] },
      { heading: '9. Governing law', body: ['These terms are governed by Tunisian law. We may change them; the new version is published in the app with its date.'] },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    summary: 'The data we process, why, for how long, and your rights.',
    sections: [
      { heading: '1. Controller', body: ['Fitness League processes your personal data under Tunisian organic law no. 2004-63 of 27 July 2004 on the protection of personal data.'] },
      { heading: '2. Data processed', body: ['Account: email, username, full name, password (never stored in clear), date of birth, governorate and city.', 'Activity: workouts, points, league, badges, challenges, friends, gyms, comments and reactions.', 'Competitions: registrations, category, payments recorded by the organizer, scores, video links, lanes and heats.', 'Health data, only with your consent: see the « Health data » document.', 'Technical: device, language, notification tokens, security logs.'] },
      { heading: '3. Why', body: ['To run your account and the app, compute points and leaderboards, run and judge competitions, send you useful emails and notifications, prevent cheating and abuse, and keep the service secure.'] },
      { heading: '4. Who sees it', body: ['Other users see what your privacy settings allow (workout visibility, presence on leaderboards, age bracket). Your date of birth is never shown.', 'A competition’s organizer and judges see what they need to run it: your name, category, registration, scores and videos.', 'We do not sell your data. Technical providers (hosting, email delivery, notifications) process it on our behalf.'] },
      { heading: '5. How long', body: ['As long as your account exists. After a deletion request the account is erased or anonymised after 30 days; published competition results stay in anonymous form.'] },
      { heading: '6. Security', body: ['Encrypted connections, hashed passwords, encrypted health data, limited and logged access.'] },
      { heading: '7. Your rights', body: ['You can see and correct your data in your profile, export it and delete your account in Settings, withdraw your health-data consent, and set your visibility.', 'You may also contact the national personal data protection authority (INPDP).'] },
      { heading: '8. Changes', body: ['Any new version will be published in the app with its date; an important change will be pointed out to you.'] },
    ],
  },
  health: {
    title: 'Health data',
    summary: 'Body measurements and health data: optional, encrypted, never public.',
    sections: [
      { heading: '1. Which data', body: ['Weight, body measurements you log in « Body », and the health data you choose to attach to your workouts.'] },
      { heading: '2. Your consent', body: ['This data is processed only if you consented, at registration or later. Without consent the app works without it.', 'You can withdraw your consent at any time: the data concerned is no longer used.'] },
      { heading: '3. Use', body: ['Only to show you your progress. It is never shown to other users, gyms or organizers, and never used for advertising.'] },
      { heading: '4. Protection', body: ['It is encrypted in our database with keys kept apart, and included in your data export.'] },
      { heading: '5. Warning', body: ['Fitness League is not a medical device. Nothing in the app replaces the advice of a health professional.'] },
    ],
  },
};

const ar: Record<LegalDocId, LegalDoc> = {
  terms: {
    title: 'الشروط العامة للاستخدام',
    summary: 'قواعد استخدام Fitness League: حسابك والتمارين والدوري والقاعات والمسابقات.',
    sections: [
      { heading: '1. الموضوع', body: ['Fitness League تطبيق للتمرين والمنافسة موجّه للرياضيين والقاعات ومنظمي الأحداث في تونس. تنظم هذه الشروط استخدام التطبيق والموقع.', 'بإنشاء حساب، فإنك تقبل هذه الشروط وسياسة الخصوصية.'] },
      { heading: '2. الحساب', body: ['يجب أن تبلغ السن الأدنى المبيّن عند التسجيل وأن تقدّم معلومات صحيحة.', 'حسابك شخصي: أنت مسؤول عن كلمة المرور وعن كل ما يُفعل بحسابك. أعلمنا فورًا بأي استخدام لم تأذن به.', 'بعض العمليات، مثل إنشاء حدث، تتطلب بريدًا إلكترونيًا مؤكَّدًا.'] },
      { heading: '3. التمارين والدوري والترتيب', body: ['تُحسب النقاط والأقسام والترتيب من التمارين التي تسجّلها، ويجب أن تعكس ما قمت به فعلًا.', 'قد تُراجَع النتائج غير العادية أو تُعلَّق أو تُلغى. الغش (نتائج مختلقة، إثباتات مضلِّلة، حسابات متعددة) قد يؤدي إلى عقوبة تصل إلى تعليق الحساب.'] },
      { heading: '4. المسابقات', body: ['ينظّم كل مسابقة منظّمها، وهو من يحدد قواعدها وفئاتها وتمارينها وسعرها وبرنامجها. يوفّر Fitness League الأداة لا الحدث.', 'يعتمد الحكام النتائج: عن بُعد انطلاقًا من الفيديو، وفي المكان من طرف حكم ممرّك بعد تأكيدك. يمكنك الطعن في نتيجة خلال الأجل المحدد، وقرار الحكم الرئيسي أو المنظّم نهائي.', 'تتم تسوية التسجيل ودفعه مع المنظّم وفق شروطه، بما في ذلك الاسترجاع.'] },
      { heading: '5. المحتوى', body: ['تبقى مالكًا لما تنشره (صور، تعليقات، روابط فيديو)، وتأذن لنا بعرضه في التطبيق حسب درجة الظهور التي تختارها.', 'يُمنع المحتوى غير القانوني أو المحرّض على الكراهية أو المضايقة أو الجنسي أو المضلِّل، واستعمال أعمال الغير دون حق. يمكن الإبلاغ عن أي محتوى وحذفه.'] },
      { heading: '6. الصحة والسلامة', body: ['للرياضة مخاطر. تمرّن حسب مستواك، قم بالإحماء واستشر طبيبًا عند الشك. تمارين التطبيق وتحدياته ليست نصائح طبية.', 'تشارك في التمارين والتحديات والمسابقات على مسؤوليتك.'] },
      { heading: '7. توفر الخدمة', body: ['نبذل جهدنا لتعمل الخدمة دون انقطاع دون أن نضمن ذلك، وقد تتغير بعض الوظائف أو تُسحب.'] },
      { heading: '8. إنهاء الحساب', body: ['يمكنك حذف حسابك في أي وقت من الإعدادات. يُعطَّل فورًا ويُمحى بعد 30 يومًا، وتسجيل الدخول خلال هذه المدة يلغي الحذف.', 'يمكننا تعليق أو غلق حساب لا يحترم هذه الشروط.'] },
      { heading: '9. القانون المنطبق', body: ['تخضع هذه الشروط للقانون التونسي. يمكننا تعديلها وتُنشر النسخة الجديدة في التطبيق مع تاريخها.'] },
    ],
  },
  privacy: {
    title: 'سياسة الخصوصية',
    summary: 'البيانات التي نعالجها، ولماذا، ولأي مدة، وحقوقك.',
    sections: [
      { heading: '1. المسؤول', body: ['يعالج Fitness League بياناتك الشخصية طبقًا للقانون الأساسي التونسي عدد 63 لسنة 2004 المؤرخ في 27 جويلية 2004 المتعلق بحماية المعطيات الشخصية.'] },
      { heading: '2. البيانات المعالَجة', body: ['الحساب: البريد الإلكتروني، اسم المستخدم، الاسم الكامل، كلمة المرور (لا تُحفظ أبدًا بشكل واضح)، تاريخ الولادة، الولاية والمدينة.', 'النشاط: التمارين، النقاط، الدوري، الشارات، التحديات، الأصدقاء، القاعات، التعليقات والتفاعلات.', 'المسابقات: التسجيلات، الفئة، المدفوعات التي يسجّلها المنظّم، النتائج، روابط الفيديو، الممرات والهيتات.', 'البيانات الصحية، بموافقتك فقط: انظر وثيقة «البيانات الصحية».', 'بيانات تقنية: الجهاز، اللغة، رموز الإشعارات، سجلات الأمان.'] },
      { heading: '3. لماذا', body: ['لتشغيل حسابك والتطبيق، وحساب النقاط والترتيب، وتنظيم المسابقات وتحكيمها، وإرسال الرسائل والإشعارات المفيدة، ومنع الغش والتجاوزات، وضمان الأمان.'] },
      { heading: '4. من يطّلع عليها', body: ['يرى المستخدمون الآخرون ما تسمح به إعدادات خصوصيتك (ظهور التمارين، الظهور في الترتيب، الفئة العمرية). لا يُعرض تاريخ ولادتك أبدًا.', 'يرى منظّم المسابقة وحكامها ما يلزم لإدارتها: اسمك وفئتك وتسجيلك ونتائجك ومقاطع الفيديو.', 'لا نبيع بياناتك. يعالجها مزوّدون تقنيون (الاستضافة، إرسال البريد، الإشعارات) لحسابنا.'] },
      { heading: '5. المدة', body: ['ما دام حسابك موجودًا. بعد طلب الحذف، يُمحى الحساب أو يُجهَّل بعد 30 يومًا، وتبقى نتائج المسابقات المنشورة بشكل مجهول.'] },
      { heading: '6. الأمان', body: ['اتصالات مشفّرة، كلمات مرور مجزّأة، بيانات صحية مشفّرة، ونفاذ محدود ومسجَّل.'] },
      { heading: '7. حقوقك', body: ['يمكنك الاطلاع على بياناتك وتصحيحها في ملفك، وتصديرها وحذف حسابك من الإعدادات، وسحب موافقتك على البيانات الصحية، وضبط درجة الظهور.', 'يمكنك أيضًا التوجه إلى الهيئة الوطنية لحماية المعطيات الشخصية (INPDP).'] },
      { heading: '8. التعديلات', body: ['سننشر كل نسخة جديدة في التطبيق مع تاريخها، وسنعلمك بأي تغيير مهم.'] },
    ],
  },
  health: {
    title: 'البيانات الصحية',
    summary: 'القياسات الجسدية والبيانات الصحية: اختيارية، مشفّرة، وغير علنية أبدًا.',
    sections: [
      { heading: '1. أي بيانات', body: ['الوزن والقياسات التي تسجّلها في «الجسم»، والبيانات الصحية التي تختار ربطها بتمارينك.'] },
      { heading: '2. موافقتك', body: ['لا تُعالج هذه البيانات إلا بموافقتك، عند التسجيل أو لاحقًا. دون موافقة، يعمل التطبيق دونها.', 'يمكنك سحب موافقتك في أي وقت، فلا تُستعمل البيانات المعنية بعد ذلك.'] },
      { heading: '3. الاستعمال', body: ['فقط لعرض تقدّمك. لا تُعرض أبدًا على المستخدمين الآخرين أو القاعات أو المنظمين، ولا تُستعمل للإشهار.'] },
      { heading: '4. الحماية', body: ['تُشفَّر في قاعدة بياناتنا بمفاتيح محفوظة على حدة، وتُضمَّن في تصدير بياناتك.'] },
      { heading: '5. تنبيه', body: ['Fitness League ليس جهازًا طبيًا، ولا شيء في التطبيق يعوّض رأي مختص في الصحة.'] },
    ],
  },
};

const DOCS: Record<Locale, Record<LegalDocId, LegalDoc>> = { fr, en, ar };

export function legalDoc(id: string, locale: Locale): LegalDoc | null {
  return (LEGAL_DOCS as string[]).includes(id) ? DOCS[locale][id as LegalDocId] : null;
}
