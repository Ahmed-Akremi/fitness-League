/** Push titles and bodies (the app shows the detailed text in-app). Keyed by notification type, then locale. */
type Texts = Record<'fr' | 'en' | 'ar', [title: string, body: string]>;

const TEXTS: Record<string, Texts> = {
  FRIEND_REQUEST: { fr: ['Nouvelle demande', "Quelqu'un veut devenir ton ami"], en: ['Friend request', 'Someone wants to be your friend'], ar: ['طلب صداقة', 'شخص ما يريد أن يكون صديقك'] },
  FRIEND_ACCEPTED: { fr: ['Ami ajouté', 'Ta demande a été acceptée'], en: ['New friend', 'Your request was accepted'], ar: ['صديق جديد', 'تم قبول طلبك'] },
  BATTLE_INVITE: { fr: ['Nouveau défi', "Un ami te lance une battle"], en: ['New battle', 'A friend challenged you'], ar: ['تحدٍ جديد', 'صديق يتحداك'] },
  BATTLE_STARTED: { fr: ['Battle lancée', "C'est parti !"], en: ['Battle on', "It's on!"], ar: ['بدأ التحدي', 'انطلق!'] },
  BATTLE_DECLINED: { fr: ['Battle refusée', 'Ton défi a été décliné'], en: ['Battle declined', 'Your challenge was declined'], ar: ['تم رفض التحدي', 'تم رفض تحديك'] },
  BATTLE_RESULT: { fr: ['Battle terminée', 'Découvre le résultat'], en: ['Battle over', 'See the result'], ar: ['انتهى التحدي', 'اطلع على النتيجة'] },
  DUEL_MATCHED: { fr: ['Duel de la semaine', 'Ton adversaire est trouvé !'], en: ['Weekly Duel', 'Your opponent is here!'], ar: ['مبارزة الأسبوع', 'تم العثور على منافسك!'] },
  DUEL_GHOST: { fr: ['Duel fantôme', 'Bats ta semaine dernière'], en: ['Ghost duel', 'Beat your last week'], ar: ['مبارزة الظل', 'تفوّق على أسبوعك الماضي'] },
  GYM_WAR_STARTED: { fr: ['Guerre de salles', 'Ta salle entre en guerre cette semaine'], en: ['Gym War', 'Your gym goes to war this week'], ar: ['حرب الصالات', 'صالتك تدخل الحرب هذا الأسبوع'] },
  GYM_WAR_RESULT: { fr: ['Guerre de salles', 'Le résultat est tombé'], en: ['Gym War', 'The result is in'], ar: ['حرب الصالات', 'النتيجة متاحة'] },
  BADGE_AWARDED: { fr: ['Nouveau badge', 'Tu as débloqué un badge'], en: ['New badge', 'You unlocked a badge'], ar: ['شارة جديدة', 'لقد فتحت شارة'] },
  CHALLENGE_COMPLETED: { fr: ['Challenge réussi', 'Bien joué !'], en: ['Challenge completed', 'Well done!'], ar: ['تم إنجاز التحدي', 'أحسنت!'] },
  ACTIVITY_REACTION: { fr: ['Réaction', 'Quelqu\'un a réagi à ton activité'], en: ['Reaction', 'Someone reacted to your activity'], ar: ['تفاعل', 'تفاعل أحدهم مع نشاطك'] },
  ACTIVITY_COMMENT: { fr: ['Commentaire', 'Nouveau commentaire sur ton activité'], en: ['Comment', 'New comment on your activity'], ar: ['تعليق', 'تعليق جديد على نشاطك'] },
  GYM_WOD_SCORE_INVALIDATED: { fr: ['WOD', 'Un coach a invalidé ton score'], en: ['WOD', 'A coach invalidated your score'], ar: ['WOD', 'ألغى مدرب نتيجتك'] },
};

const FALLBACK: Texts = { fr: ['Fitness League', 'Tu as une nouvelle notification'], en: ['Fitness League', 'You have a new notification'], ar: ['Fitness League', 'لديك إشعار جديد'] };

export function pushText(type: string, locale: string): { title: string; body: string } {
  const t = TEXTS[type] ?? FALLBACK;
  const [title, body] = t[(locale as keyof Texts) in t ? (locale as keyof Texts) : 'fr'];
  return { title, body };
}
