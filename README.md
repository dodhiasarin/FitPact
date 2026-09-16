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

## Appearance (dark/light)

Settings now has a Dark/Light toggle. It's saved per-device (in that
browser's local storage), so you and your partner can each pick your own
without affecting the other's phone.

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

## Push notifications (real, works when the app is closed)

This version adds actual push notifications via Firebase Cloud Messaging
(FCM), on top of the foreground notifications from before. Getting this
fully working takes a bit more setup than the rest of the app — here's
exactly what's needed.

### 1. Generate a VAPID key

Firebase Console → Project Settings → **Cloud Messaging** tab → under "Web
configuration", click **Generate key pair**. Copy the key it gives you and
paste it into `js/firebase-config.js` → the `VAPID_KEY` constant.

### 2. Fill in your Firebase config in the service worker

`firebase-messaging-sw.js` (at the root of the project, next to `index.html`)
needs the **same** `firebaseConfig` values you already put in
`js/firebase-config.js` — service workers can't import your other JS files,
so this file has its own copy. Paste your real values into both places.

### 3. Deploy the service worker at your site's root

Make sure `firebase-messaging-sw.js` ends up at the same level as
`index.html` in whatever you deploy (GitHub Pages, Netlify, etc.) — not
inside a subfolder. If you've been dragging the whole `FitPactWeb` folder in,
this already happens automatically.

### 4. Enable push in the app

Open Settings (gear icon on Home) → tap **Enable Push Notifications** → allow
the permission prompt. Do this on both phones. This registers each device
and saves its push token to Firestore.

### 5. Deploy the Cloud Functions backend (the part that actually sends pushes)

Without this step, tokens get saved but nothing ever sends them a push — the
functions in `functions/index.js` are what actually fire on schedule and on
partner events.

```bash
npm install -g firebase-tools   # if you don't have it already
firebase login
cd path/to/FitPactWeb
firebase init functions         # choose JavaScript, don't overwrite functions/index.js
cd functions
npm install
cd ..
firebase deploy --only functions
```

**This requires upgrading to the Blaze (pay-as-you-go) plan** — scheduled
functions need Cloud Scheduler, which isn't available on the free Spark
plan. Firebase Console → click the plan name (bottom-left) → Upgrade. Blaze
still has a generous free tier underneath it; for two people getting a
handful of pushes a day, real cost is effectively $0 — but Blaze does
require a card on file, unlike Spark.

The functions default to `Africa/Nairobi` timezone (matching the KES
currency) — change the `TIMEZONE` constant at the top of `functions/index.js`
if you're elsewhere, then redeploy.

### What happens without the Cloud Functions deployed

The app still works and still shows notifications — just only the
foreground kind from before (while the app is actually open), using the
same message templates. The push setup above is what upgrades those to
real, phone-buzzes-even-when-closed notifications.

---

## Project structure

```
FitPactWeb/
  index.html                 # App shell + all screen templates
  css/style.css               # Mobile-first theme (dark + light)
  js/firebase-config.js       # Your Firebase project keys + VAPID key go here
  js/app.js                   # All logic: auth, Firestore sync, rendering, rollover
  firebase-messaging-sw.js    # Service worker for background push (needs its own copy of your config)
  manifest.json               # PWA metadata (icons optional — see below)
  firestore.rules             # Security rules to paste into Firebase Console
  functions/                  # Cloud Functions backend for real push (optional, needs Blaze plan)
    index.js
    package.json
  .nojekyll                   # Tells GitHub Pages not to run Jekyll on this static site
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
