# Fitness League — brag plan

## The questions

- **What is it?** A phone app (iOS, Android) that turns training into a fair league: log workouts, earn League
  Points, climb the rankings of your country, your city and your gym. It launches in Tunisia, in English, French
  and Arabic.
- **Who is it for?** Gym-goers and athletes of every level, plus the gyms and event organizers around them.
- **What sets it apart?** It ranks **progress, consistency and verified effort, not absolute strength**: « A beginner
  who improves can overtake an elite athlete who stands still. »
- **Most impressive / funniest claim:** the FAQ's own « Do I need to be strong to rank high? » → « No. »
- **Visual hook:** that question in huge condensed type, slammed shut by a lime « NO. »
- **Real UI to show:** the app itself (Expo web build, offline demo data): Home (Gold, 1 240 LP, #2 in Tunisia),
  Log workout, League (Tunisia → Sousse → gym), Battles, the gym page, a competition.
- **Tone:** `default`, with sport energy: dark graphite, lime accent, Barlow Condensed ExtraBold, hard hits on the beat.
- **Share caption:** « The strongest lifter in the gym isn't automatically #1 here. »

## Angle

Open on the question every beginner asks, answer it with the app's own « No. », then prove it with the real
app: where you stand, how you earn points, where you climb, and who you take on.

## Identity

- Background `#0E0F12`, surfaces `#17191E` / `#20232A`, text `#E6E8EC`, muted `#8C919B`
- Accent lime `#C6F432` (black text on it); Gold `#FFD166`, Platinum `#7FDBDA`
- Display: Barlow Condensed ExtraBold (uppercase), body: Inter
- Logo: lime rounded square with a black bolt (`apps/landing/public/media/logo.svg`)

## Storyboard (1920×1080, 30 fps, 22 s, music at 120 BPM: a bar = 2 s)

| # | Time | Scene | On screen | Motion | Sound |
|---|---|---|---|---|---|
| 1 | 0.0–3.0 | Hook | « DO YOU NEED TO BE / STRONG / TO RANK HIGH? » | words snap in by 0.6 s on the heartbeat kicks, slow push-in | F drone, ticks, riser |
| 2 | 3.0–4.0 | Slam | Giant lime « NO. » | hits on 3.0 with a shake, scales away at 3.7 | impact + sub drop, a beat of air |
| 3 | 4.0–8.0 | Reveal | Logo + FITNESS LEAGUE, « Progress. Consistency. Verified effort. », phone on the real Home screen | phone springs up, lines stagger in, the LP card lights up | the groove drops at 4.0 |
| 4 | 8.0–12.0 | Log | « LOG A WORKOUT. EARN LEAGUE POINTS. », phone: « + » → sport sheet → Powerlifting → Add exercise → Back squat → 5 reps × 105 kg typed → Save → « Workout saved » | 8 simulated taps, keystroke cuts, push / sheet / pop | quiet tuned taps, F5 chime on « saved » |
| 5 | 12.0–16.0 | Climb | « CLIMB YOUR COUNTRY. REGION. GYM. » (the active word lights up) with « #2 in Tunisia » → « #1 in Sousse » → « #1 at Bodynade », phone on League | taps on the scopes | arp enters, Ab5 and C6 chimes on each #1 |
| 6 | 16.0–19.0 | Take them on | « TAKE THEM ON. » + three phones: New battle · Bodynade gym page · the championship, labels « Challenge a friend », « Represent your gym », « Judged on video » | the hero phone slides left, two more spring in | fill into 19.0 |
| 7 | 19.0–22.0 | Outro | Logo, « CLIMB THE LEAGUE. », « Coming soon · App Store · Google Play », « English · Français · العربية » | settle, hold | final hit, Fm chord rings out |

Readability: the hook's 8 words are fully on screen from 0.6 s to 3.0 s (2.4 s); every later line holds ≥ 0.3 s per word.

## Source captures

Real screens of `apps/mobile-rn` (branch `feat/floor-judging`), exported for the web with `EXPO_PUBLIC_DEMO=true`
and captured in headless Chrome at 390×844, 3×, with iPhone safe areas (47 / 34 px). One substitution: the demo
competition banner (`assets/competition-cover.jpg`) carries Alamy watermarks, so the captures show the landing's
Unsplash photo `athletes.webp` (Meghan Holmes) in its place, swapped in the export only.

## Sound

Written to picture by `work/synth.mjs`: 120 BPM in F minor (Fm – Db – Ab – Eb), four-on-the-floor with a
sidechained sub. The effects are synthesized in the same key (taps on C6, the fifth of F) and go through the same
reverb as the music. Mastered to −14 LUFS at the mux.
