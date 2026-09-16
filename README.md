# FitPact (Web)

A real-time, two-person accountability tracker: each month you and your
partner deposit money (tracked, not real payment processing — you just tap
"mark as paid"), commit to a workout target, and whoever misses it forfeits
their deposit to a shared, ever-growing pool. Home workouts count too — 3
home workouts = 1 gym-equivalent workout.

This is a plain static website (no build step, no Mac needed) backed by
**Firebase** (Auth + Firestore) for real-time sync between your two phones.
You'll host it yourself for free and add it to your iPhone home screens from
Safari.

---

## 1. Create a free Firebase project (10–15 min)

1. Go to https://console.firebase.google.com → **Add project** → name it
   anything (e.g. "fitpact") → you can skip Google Analytics.
2. Inside the project, click the **web icon (`</>`)** to register a web app.
   Name it anything, and **skip** the "also set up Firebase Hosting" checkbox
   for now (we'll do it via CLI below).
3. Firebase shows you a `firebaseConfig` object like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "fitpact-xxxx.firebaseapp.com",
     projectId: "fitpact-xxxx",
     storageBucket: "fitpact-xxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```
   Copy these values into **`js/firebase-config.js`** in this project,
   replacing the `PASTE_YOUR_...` placeholders.
4. In the left sidebar: **Build → Authentication → Get started → Email/Password
   → enable it**.
5. In the left sidebar: **Build → Firestore Database → Create database →
   Production mode** → pick any region close to you.
6. Once created, go to the **Rules** tab of Firestore and paste in the
   contents of `firestore.rules` from this project, then **Publish**.
   (This lets any signed-in user of your app read/write — perfectly fine
   since only you two will ever have accounts in this project.)

---

## 2. Host it for free with Firebase Hosting

You'll need Node.js installed on whatever computer you use for this one-time
setup (doesn't have to be a Mac — Windows/Linux is fine).

```bash
npm install -g firebase-tools
firebase login
cd path/to/FitPactWeb
firebase init hosting
```

When prompted:
- "What do you want to use as your public directory?" → type `.` (this folder)
- "Configure as a single-page app?" → **No**
- "Set up automatic builds with GitHub?" → No
- It may ask to overwrite `index.html` — say **No**

Then deploy:
```bash
firebase deploy --only hosting
```

You'll get a live URL like `https://fitpact-xxxx.web.app` — that's your
real-time website, live on the internet, for free.

**No computer at all?** You can alternatively drag-and-drop this whole folder
into Netlify (https://app.netlify.com/drop) for an instant free URL — skips
the Firebase Hosting CLI step entirely, though Firebase Hosting is a nice
touch since it's the same ecosystem as your database.

---

## 3. Add it to your iPhone home screen

1. Open the live URL in **Safari** on your iPhone (must be Safari, not Chrome,
   for "Add to Home Screen" to create an app-like icon).
2. Tap the **Share button** (square with an arrow) → **Add to Home Screen**.
3. Do this on both of your phones.

It'll now open full-screen, without Safari's address bar, just like a native
app.

---

## 4. Using it

1. On one phone: **Sign Up** with an email/password, then **Start a Pact** —
   set your monthly deposit amount and workout target (default 17). You'll get
   a **Pact ID**.
2. On the other phone: **Sign Up**, then **Join Partner's Pact** using that ID.
3. Both dashboards now update live — logging a workout on one phone updates
   the other's view within a second or two.

---

## Navigation

The app now uses a bottom tab bar with four tabs, plus a floating **+ Workout**
button that's always available:

- **🏠 Home** — this month's challenge: your progress, deposit status, and a
  quick days-left / at-risk summary.
- **📅 Calendar** — the month grid showing which days each of you worked out.
- **❤️ Us** — side-by-side progress, both streaks, and unlockable achievements
  (7-day streak, perfect month, team effort, current leader).
- **🏦 Pool** — the forfeited pool total, your at-risk amount and pace for
  this month, and a history of past months' outcomes.

Settings (notification preferences, sign out) live behind the gear icon on
the Home tab.

**Currency:** all amounts now show in **KES** (Kenyan Shillings) instead of
USD. The pact setup screen's default deposit is now 5000 — change it to
whatever figure makes sense for you two.

## What's new: streaks, money at risk, and notifications

- **🔥 Streak card** on the dashboard — current consecutive-day streak
  (logging any workout keeps it alive) and your best-ever streak.
- **💰 Money at Risk screen** — your deposit amount, workouts remaining,
  days left in the month, required pace, and the exact deadline date.
- **🔔 Notification settings screen** — toggle four daily reminder times
  (8am / 12pm / 6pm / 8:30pm) and four couple notifications (partner
  completed a workout, partner took the lead, partner's streak ended,
  you're falling behind). Preferences save per-person to Firestore under
  `pacts/{pactId}/notifPrefs/{uid}` — **if you already deployed Firestore
  rules earlier, re-paste the updated `firestore.rules` and Publish again**,
  since this version adds a rule for that new subcollection.

## About notifications

This version shows notifications for:
- Daily check-ins at whichever of the four times you've enabled (skipped
  automatically once you've already logged a workout that day)
- A message the moment you complete a workout (with a deposit-secured note
  once you hit target)
- An automatic switch to an urgent "N days left" message in the final 4
  days of the month, regardless of time slot
- Partner-triggered messages (completed a workout, took the lead, their
  streak ended, you're falling behind) — computed by comparing live
  Firestore updates, so this only works while your app is open to receive them

**What it can't do (without more setup):** true background push notifications
— the kind that arrive daily at 6pm even if you haven't opened the app — need
a paid Firebase plan (Blaze) plus a scheduled Cloud Function and Web Push
(FCM) wiring. It's genuinely doable since iOS 16.4+ supports web push for
home-screen apps, but it's a meaningfully bigger lift. If you want it, the
building blocks are:
1. Firebase Console → Project Settings → Cloud Messaging → generate a **Web
   Push certificate (VAPID key)**.
2. Add a `firebase-messaging-sw.js` service worker to request a push token
   and save it to Firestore per user.
3. Upgrade to the **Blaze** (pay-as-you-go) plan — cost for two users sending
   a few pushes a day is effectively $0, but Blaze requires a card on file.
4. Write scheduled + Firestore-triggered Cloud Functions that read each
   user's pace/prefs and send the same message templates via the Firebase
   Admin SDK's messaging API.

Happy to build that out for you if you decide you want it later — just ask.

---

## Project structure

```
FitPactWeb/
  index.html              # App shell + all screen templates
  css/style.css            # Mobile-first dark theme
  js/firebase-config.js    # Your Firebase project keys go here
  js/app.js                # All logic: auth, Firestore sync, rendering, rollover
  manifest.json            # PWA metadata (icons optional — see below)
  firestore.rules          # Security rules to paste into Firebase Console
```

### Optional: home screen icon

Right now iOS will use a plain screenshot as your home-screen icon since no
custom icon file is included. If you want a proper icon, create a 192x192 and
512x512 PNG (any logo/image you like) and save them as `icons/icon-192.png`
and `icons/icon-512.png` in this folder before deploying — `index.html` and
`manifest.json` already reference those paths.

## How the month-rollover works

Every time either of you opens the app, it checks: does *last* month's cycle
document still say `isClosed: false`? If so, it settles it — anyone who
didn't reach the target (accounting for the 3-home-workouts-equals-1-gym-workout
rule) has their deposit added to the shared pool total; anyone who did is
marked refunded (a ledger entry only — no real money moves). Then it creates
this month's fresh cycle, requiring a new deposit confirmation from both of
you.

There's no server-side scheduler — it resolves client-side whenever someone
opens the app, which is reliable enough for two people (worst case: the
rollover is a few hours late the first time either of you opens the app in a
new month).

## Adjusting the numbers

Change the monthly deposit amount or workout target any time by editing the
`pacts/{pactId}` document directly in the Firebase Console — Firestore
Database tab — no code changes needed.
