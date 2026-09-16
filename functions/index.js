/**
 * FitPact push notification backend.
 *
 * Deploy with: firebase deploy --only functions
 * Requires the Blaze (pay-as-you-go) plan — scheduled functions and the
 * underlying Cloud Scheduler / Pub/Sub don't run on the free Spark plan.
 * At two users sending a handful of pushes a day, actual cost is
 * effectively $0, but Blaze does require a card on file.
 *
 * Change TIMEZONE below to your local timezone if you're not in Kenya.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const TIMEZONE = 'Africa/Nairobi';

function effectiveWorkouts(stat) {
  if (!stat) return 0;
  return (stat.gymWorkouts || 0) + Math.floor((stat.homeWorkouts || 0) / 3);
}

function cycleIdFor(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMoney(amount) {
  return `KES ${Math.round(amount || 0).toLocaleString()}`;
}

async function sendPush(uid, title, body) {
  const pactSnap = await db.collection('pacts').where('memberIds', 'array-contains', uid).limit(1).get();
  if (pactSnap.empty) return;
  const pactRef = pactSnap.docs[0].ref;
  const prefDoc = await pactRef.collection('notifPrefs').doc(uid).get();
  if (!prefDoc.exists) return;
  const token = prefDoc.data().fcmToken;
  if (!token) return;

  try {
    await admin.messaging().send({ token, notification: { title, body } });
  } catch (e) {
    console.error(`Push failed for ${uid}:`, e.message);
  }
}

async function hasLoggedToday(pactId, uid) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const snap = await db.collection('pacts').doc(pactId).collection('workoutLogs')
    .where('uid', '==', uid)
    .where('timestamp', '>=', start)
    .limit(1)
    .get();
  return !snap.empty;
}

async function runDailySlot(slot) {
  const now = new Date();
  const cycleId = cycleIdFor(now);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();

  const pactsSnap = await db.collection('pacts').get();
  for (const pactDoc of pactsSnap.docs) {
    const pact = pactDoc.data();
    const cycleRef = pactDoc.ref.collection('cycles').doc(cycleId);
    const cycleSnap = await cycleRef.get();
    if (!cycleSnap.exists) continue;
    const cycle = cycleSnap.data();

    for (const uid of pact.memberIds || []) {
      const prefDoc = await pactDoc.ref.collection('notifPrefs').doc(uid).get();
      if (!prefDoc.exists) continue;
      const prefs = prefDoc.data();
      if (!prefs.times || !prefs.times[slot]) continue;

      const stat = (cycle.stats || {})[uid] || {};
      const target = cycle.target;
      const remaining = Math.max(target - effectiveWorkouts(stat), 0);
      if (remaining === 0) continue;

      if (daysLeft <= 4) {
        await sendPush(uid, 'FitPact',
          `🚨 ${daysLeft} day${daysLeft === 1 ? '' : 's'} left\nYou need ${remaining} more workout${remaining === 1 ? '' : 's'} to protect your ${formatMoney(pact.depositAmount)}.`);
        continue;
      }

      const done = await hasLoggedToday(pactDoc.id, uid);
      if (done) continue;

      const monthName = now.toLocaleString('default', { month: 'long' });
      if (slot === '08:00') {
        await sendPush(uid, 'FitPact', `☀️ Good morning. ${monthName} isn't going to complete itself.`);
      } else if (slot === '12:00') {
        await sendPush(uid, 'FitPact', `🏋️ No workout logged today. You've got time.`);
      } else if (slot === '18:00') {
        await sendPush(uid, 'FitPact', `⚠️ 6:00 PM — You still need today's workout.`);
      } else if (slot === '20:30') {
        await sendPush(uid, 'FitPact', `⚠️ 8:30 PM — You still need today's workout.`);
      }
    }
  }
}

exports.dailyReminder0800 = onSchedule({ schedule: '0 8 * * *', timeZone: TIMEZONE }, () => runDailySlot('08:00'));
exports.dailyReminder1200 = onSchedule({ schedule: '0 12 * * *', timeZone: TIMEZONE }, () => runDailySlot('12:00'));
exports.dailyReminder1800 = onSchedule({ schedule: '0 18 * * *', timeZone: TIMEZONE }, () => runDailySlot('18:00'));
exports.dailyReminder2030 = onSchedule({ schedule: '30 20 * * *', timeZone: TIMEZONE }, () => runDailySlot('20:30'));

// Fires whenever a cycle document changes (i.e. someone logs a workout or
// deposits) and notifies the OTHER member based on their own preferences.
exports.onCycleUpdate = onDocumentUpdated('pacts/{pactId}/cycles/{cycleId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const pactId = event.params.pactId;

  const pactSnap = await db.collection('pacts').doc(pactId).get();
  if (!pactSnap.exists) return;
  const pact = pactSnap.data();
  const memberIds = pact.memberIds || [];
  if (memberIds.length < 2) return;

  for (const actingUid of memberIds) {
    const recipientUid = memberIds.find(id => id !== actingUid);
    if (!recipientUid) continue;

    const beforeEff = effectiveWorkouts((before.stats || {})[actingUid]);
    const afterEff = effectiveWorkouts((after.stats || {})[actingUid]);
    if (afterEff <= beforeEff) continue; // this member didn't just log a workout

    const recipientEff = effectiveWorkouts((after.stats || {})[recipientUid]);
    const actorName = pact.memberNames[actingUid] || 'Your partner';

    const prefDoc = await pactSnap.ref.collection('notifPrefs').doc(recipientUid).get();
    if (!prefDoc.exists) continue;
    const prefs = prefDoc.data().couple || {};

    const wasAheadOfRecipient = beforeEff > effectiveWorkouts((before.stats || {})[recipientUid]);
    const isAheadOfRecipientNow = afterEff > recipientEff;

    if (!wasAheadOfRecipient && isAheadOfRecipientNow && prefs.partnerTookLead) {
      const diff = afterEff - recipientEff;
      await sendPush(recipientUid, 'FitPact',
        `${actorName} is now ${diff} workout${diff === 1 ? '' : 's'} ahead of you.`);
    } else if (prefs.partnerCompleted) {
      await sendPush(recipientUid, 'FitPact', `👀 ${actorName} just completed a workout.\nYour move.`);
    }

    const gap = afterEff - recipientEff;
    if (gap >= 3 && prefs.fallingBehind) {
      await sendPush(recipientUid, 'FitPact', `You're falling behind — ${actorName} is ${gap} workouts ahead.`);
    }
  }
});
