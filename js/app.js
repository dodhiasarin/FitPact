// ============================================================
// FitPact — app.js
// All state, Firestore logic, and rendering lives in this one file.
// ============================================================

const state = {
  uid: null,
  pactId: null,
  pact: null,
  cycle: null,
  prevCycleStats: null,
  notifPrefs: { times: {}, couple: {} },
  lastLogDate: null,
  activeTab: 'home',
  pactUnsub: null,
  cycleUnsub: null,
};

const appEl = document.getElementById('app');
const mainEl = document.getElementById('mainContent');
const bottomNav = document.getElementById('bottomNav');
const fabBtn = document.getElementById('fabWorkout');
const sheetOverlay = document.getElementById('workoutSheet');

function formatMoney(amount) {
  return `KES ${Math.round(amount || 0).toLocaleString()}`;
}

function cycleIdFor(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function effectiveWorkouts(stat) {
  if (!stat) return 0;
  return (stat.gymWorkouts || 0) + Math.floor((stat.homeWorkouts || 0) / 3);
}

function isComplete(stat, target) {
  return effectiveWorkouts(stat) >= target;
}

function partnerUidOf() {
  return (state.pact.memberIds || []).find(id => id !== state.uid);
}

function ringSVG(pct, size, strokeWidth, color) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(pct, 0), 1));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="var(--card-2)" stroke-width="${strokeWidth}" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 ${size / 2} ${size / 2})" style="transition: stroke-dashoffset 0.4s;"/>
  </svg>`;
}

// ------------------------------------------------------------
// Auth state
// ------------------------------------------------------------

auth.onAuthStateChanged(async (user) => {
  if (user) {
    state.uid = user.uid;
    await tryLoadPact();
  } else {
    state.uid = null;
    teardownListeners();
    hideShell();
    renderLogin();
  }
});

function teardownListeners() {
  if (state.pactUnsub) state.pactUnsub();
  if (state.cycleUnsub) state.cycleUnsub();
  state.pactUnsub = null;
  state.cycleUnsub = null;
}

async function tryLoadPact() {
  const snap = await db.collection('pacts').where('memberIds', 'array-contains', state.uid).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    state.pactId = doc.id;
    state.pact = doc.data();
    attachListeners();
  } else {
    hideShell();
    renderSetup();
  }
}

function attachListeners() {
  teardownListeners();

  state.pactUnsub = db.collection('pacts').doc(state.pactId).onSnapshot((doc) => {
    if (!doc.exists) return;
    state.pact = doc.data();
    if (state.activeTab === 'home') renderHome();
    if (state.activeTab === 'pool') renderPool();
  });

  loadNotifPrefs();
  ensureCurrentCycle();
}

async function ensureCurrentCycle() {
  const pactRef = db.collection('pacts').doc(state.pactId);

  const last = new Date();
  last.setMonth(last.getMonth() - 1);
  const lastId = cycleIdFor(last);
  const lastRef = pactRef.collection('cycles').doc(lastId);
  const lastSnap = await lastRef.get();
  if (lastSnap.exists) {
    const lastCycle = lastSnap.data();
    if (!lastCycle.isClosed) await settleCycle(lastRef, lastCycle);
  }

  const thisId = cycleIdFor(new Date());
  const thisRef = pactRef.collection('cycles').doc(thisId);
  const thisSnap = await thisRef.get();
  if (!thisSnap.exists) {
    const stats = {};
    state.pact.memberIds.forEach(uid => {
      stats[uid] = { gymWorkouts: 0, homeWorkouts: 0, deposited: false, refunded: false };
    });
    await thisRef.set({
      target: state.pact.monthlyTarget,
      depositAmount: state.pact.depositAmount,
      isClosed: false,
      stats,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  state.cycleUnsub = thisRef.onSnapshot((doc) => {
    const newData = { id: doc.id, ...doc.data() };
    handleCycleDiff(state.prevCycleStats, newData.stats);
    state.prevCycleStats = JSON.parse(JSON.stringify(newData.stats || {}));
    state.cycle = newData;
    showShell();
    switchTab(state.activeTab, true);
    checkDailyReminder();
  });
}

async function settleCycle(ref, cycle) {
  let forfeited = 0;
  const updates = { isClosed: true };
  Object.entries(cycle.stats || {}).forEach(([uid, stat]) => {
    if (isComplete(stat, cycle.target)) {
      updates[`stats.${uid}.refunded`] = true;
    } else if (stat.deposited) {
      forfeited += cycle.depositAmount;
    }
  });
  await ref.update(updates);
  if (forfeited > 0) {
    await db.collection('pacts').doc(state.pactId).update({
      poolTotal: firebase.firestore.FieldValue.increment(forfeited),
    });
  }
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

async function markMyDeposit() {
  const ref = db.collection('pacts').doc(state.pactId).collection('cycles').doc(state.cycle.id);
  await ref.update({ [`stats.${state.uid}.deposited`]: true });
}

async function logWorkout(type) {
  const pactRef = db.collection('pacts').doc(state.pactId);
  const partnerUid = partnerUidOf();

  const beforeStat = { ...(state.cycle.stats[state.uid] || {}) };
  const prevEff = effectiveWorkouts(beforeStat);
  state.lastLogDate = new Date().toDateString();

  await pactRef.collection('workoutLogs').add({
    uid: state.uid,
    type,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });
  const field = type === 'gym' ? 'gymWorkouts' : 'homeWorkouts';
  const cycleRef = pactRef.collection('cycles').doc(state.cycle.id);
  await cycleRef.update({ [`stats.${state.uid}.${field}`]: firebase.firestore.FieldValue.increment(1) });

  const afterStat = { ...beforeStat, [field]: (beforeStat[field] || 0) + 1 };
  const newEff = effectiveWorkouts(afterStat);
  const target = state.cycle.target;

  if (newEff > prevEff) {
    notify('FitPact', `🔥 Workout complete.\n${prevEff} → ${newEff}` +
      (newEff >= target ? `\n💰 Your deposit is officially secured.` : ''));

    if (partnerUid) {
      const partnerEff = effectiveWorkouts(state.cycle.stats[partnerUid] || {});
      const leadDiff = newEff - partnerEff;
      if (leadDiff > 0) {
        notify('FitPact', `🏆 You're currently ahead by ${leadDiff} workout${leadDiff === 1 ? '' : 's'}.`);
      }
    }
  }
}

// ------------------------------------------------------------
// Shell: bottom nav + FAB + workout sheet (persistent across tabs)
// ------------------------------------------------------------

function showShell() {
  bottomNav.classList.remove('hidden');
  fabBtn.classList.remove('hidden');
}
function hideShell() {
  bottomNav.classList.add('hidden');
  fabBtn.classList.add('hidden');
  sheetOverlay.classList.add('hidden');
}

bottomNav.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

fabBtn.addEventListener('click', () => sheetOverlay.classList.remove('hidden'));
document.getElementById('sheetCancel').addEventListener('click', () => sheetOverlay.classList.add('hidden'));
document.getElementById('sheetGym').addEventListener('click', () => { sheetOverlay.classList.add('hidden'); logWorkout('gym'); });
document.getElementById('sheetHome').addEventListener('click', () => { sheetOverlay.classList.add('hidden'); logWorkout('home'); });

function switchTab(tab, silent) {
  state.activeTab = tab;
  bottomNav.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'home') renderHome();
  else if (tab === 'calendar') renderCalendar(new Date());
  else if (tab === 'us') renderUs();
  else if (tab === 'pool') renderPool();
}

// ------------------------------------------------------------
// Rendering: auth screens
// ------------------------------------------------------------

function clone(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function renderLogin() {
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-login'));

  const tabs = mainEl.querySelectorAll('.tab');
  const signupExtra = mainEl.querySelector('#signupExtra');
  const submitBtn = mainEl.querySelector('#authSubmit');
  let mode = 'login';

  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    mode = tab.dataset.tab;
    signupExtra.classList.toggle('hidden', mode !== 'signup');
    submitBtn.textContent = mode === 'signup' ? 'Create Account' : 'Log In';
  }));

  submitBtn.addEventListener('click', async () => {
    const email = mainEl.querySelector('#email').value.trim();
    const password = mainEl.querySelector('#password').value;
    const errorEl = mainEl.querySelector('#authError');
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    try {
      if (mode === 'signup') {
        const name = mainEl.querySelector('#displayName').value.trim() || 'Me';
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });
      } else {
        await auth.signInWithEmailAndPassword(email, password);
      }
    } catch (e) {
      errorEl.textContent = e.message;
      errorEl.classList.remove('hidden');
    }
    submitBtn.disabled = false;
  });
}

function renderSetup() {
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-setup'));

  const tabs = mainEl.querySelectorAll('.tab');
  const createFields = mainEl.querySelector('#createFields');
  const joinFields = mainEl.querySelector('#joinFields');

  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    createFields.classList.toggle('hidden', mode !== 'create');
    joinFields.classList.toggle('hidden', mode !== 'join');
  }));

  const errorEl = mainEl.querySelector('#setupError');
  const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };

  mainEl.querySelector('#createPactBtn').addEventListener('click', async () => {
    const name = mainEl.querySelector('#setupName').value.trim() || 'Me';
    const deposit = parseFloat(mainEl.querySelector('#depositAmount').value) || 5000;
    const target = parseInt(mainEl.querySelector('#targetCount').value) || 17;
    try {
      const ref = await db.collection('pacts').add({
        memberIds: [state.uid],
        memberNames: { [state.uid]: name },
        depositAmount: deposit,
        monthlyTarget: target,
        poolTotal: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      state.pactId = ref.id;
      mainEl.querySelector('#pactIdReveal').classList.remove('hidden');
      mainEl.querySelector('#pactIdText').textContent = ref.id;
      const snap = await ref.get();
      state.pact = snap.data();
      attachListeners();
    } catch (e) { showError(e.message); }
  });

  mainEl.querySelector('#joinPactBtn').addEventListener('click', async () => {
    const name = mainEl.querySelector('#setupName').value.trim() || 'Me';
    const pactId = mainEl.querySelector('#joinPactId').value.trim();
    if (!pactId) { showError('Enter a Pact ID.'); return; }
    try {
      const ref = db.collection('pacts').doc(pactId);
      const snap = await ref.get();
      if (!snap.exists) { showError('No pact found with that ID.'); return; }
      await ref.update({
        memberIds: firebase.firestore.FieldValue.arrayUnion(state.uid),
        [`memberNames.${state.uid}`]: name,
      });
      state.pactId = pactId;
      const updated = await ref.get();
      state.pact = updated.data();
      attachListeners();
    } catch (e) { showError(e.message); }
  });
}

// ------------------------------------------------------------
// Home tab
// ------------------------------------------------------------

async function renderHome() {
  if (!state.pact || !state.cycle) return;
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-home'));
  mainEl.querySelector('#settingsBtn').addEventListener('click', renderSettings);

  const target = state.cycle.target;
  const myStat = state.cycle.stats[state.uid] || {};
  const eff = effectiveWorkouts(myStat);
  const pct = target > 0 ? eff / target : 0;

  mainEl.querySelector('#ringWrap').innerHTML = `
    ${ringSVG(pct, 130, 12, pct >= 1 ? 'var(--accent)' : 'var(--accent-2)')}
    <div class="ring-center">
      <div class="ring-num">${eff}</div>
      <div class="ring-label">of ${target} workouts</div>
    </div>`;

  const depositCard = mainEl.querySelector('#depositCard');
  if (myStat.deposited) {
    depositCard.innerHTML = `<p>✅ Deposit confirmed for this month</p>`;
  } else {
    depositCard.innerHTML = `
      <p>Confirm you've put in your ${formatMoney(state.pact.depositAmount)} deposit for this month.</p>
      <button id="markDepositBtn" class="btn primary full">Mark My Deposit as Paid</button>`;
    depositCard.querySelector('#markDepositBtn').addEventListener('click', markMyDeposit);
  }

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - now.getDate(), 0);
  const remaining = Math.max(target - eff, 0);
  const atRisk = myStat.deposited ? state.pact.depositAmount : 0;

  const { current: streak } = await computeStreak(state.uid);

  mainEl.querySelector('#homeTiles').innerHTML = `
    <div class="tile tile-purple">
      <span class="tile-label">🔥 Streak</span>
      <span class="tile-value">${streak} day${streak === 1 ? '' : 's'}</span>
    </div>
    <div class="tile tile-blue">
      <span class="tile-label">📅 Days Left</span>
      <span class="tile-value">${daysLeft}</span>
    </div>
    <div class="tile tile-orange">
      <span class="tile-label">🏋️ To Go</span>
      <span class="tile-value">${remaining}</span>
    </div>
    <div class="tile ${remaining === 0 ? 'tile-green' : 'tile-red'}">
      <span class="tile-label">💰 At Risk</span>
      <span class="tile-value">${formatMoney(atRisk)}</span>
    </div>`;
}

function progressCardHTML(title, stat, target) {
  const eff = effectiveWorkouts(stat);
  const pct = Math.min((eff / target) * 100, 100);
  const complete = eff >= target;
  return `
    <div class="row">
      <h3>${title}</h3>
      <span>${eff} / ${target}</span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div>
    </div>
    <div class="progress-meta">
      <span>🏋️ ${stat.gymWorkouts || 0} gym</span>
      <span>🏠 ${stat.homeWorkouts || 0} home</span>
    </div>`;
}

// ------------------------------------------------------------
// Calendar tab
// ------------------------------------------------------------

let calViewDate = new Date();

async function renderCalendar(monthDate) {
  calViewDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-calendar'));
  mainEl.querySelector('#calPrevBtn').addEventListener('click', () => {
    const d = new Date(calViewDate); d.setMonth(d.getMonth() - 1);
    renderCalendar(d);
  });
  mainEl.querySelector('#calNextBtn').addEventListener('click', () => {
    const d = new Date(calViewDate); d.setMonth(d.getMonth() + 1);
    renderCalendar(d);
  });

  const partnerUid = partnerUidOf();
  const partnerName = partnerUid ? (state.pact.memberNames[partnerUid] || 'Partner') : 'Partner';
  mainEl.querySelector('#calPartnerName').textContent = partnerName;
  mainEl.querySelector('#calMonthLabel').textContent =
    calViewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const cycleId = cycleIdFor(calViewDate);
  const monthStart = new Date(calViewDate.getFullYear(), calViewDate.getMonth(), 1);
  const monthEnd = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);

  const [cycleSnap, logsSnap] = await Promise.all([
    db.collection('pacts').doc(state.pactId).collection('cycles').doc(cycleId).get(),
    db.collection('pacts').doc(state.pactId).collection('workoutLogs')
      .where('timestamp', '>=', monthStart)
      .where('timestamp', '<', monthEnd)
      .get(),
  ]);
  const cycleData = cycleSnap.exists ? cycleSnap.data() : null;
  const target = cycleData ? cycleData.target : (state.pact.monthlyTarget || 17);
  const myStat = cycleData ? (cycleData.stats[state.uid] || {}) : {};
  const partnerStat = cycleData && partnerUid ? (cycleData.stats[partnerUid] || {}) : {};

  mainEl.querySelector('#calStats').innerHTML = `
    <div class="stat-pill ${isComplete(myStat, target) ? 'complete' : ''}">
      <span class="name">You</span>
      <span class="count">${effectiveWorkouts(myStat)}/${target}</span>
    </div>
    <div class="stat-pill ${isComplete(partnerStat, target) ? 'complete' : ''}">
      <span class="name">${partnerName}</span>
      <span class="count">${effectiveWorkouts(partnerStat)}/${target}</span>
    </div>`;

  const byDay = {};
  logsSnap.forEach(doc => {
    const d = doc.data();
    if (!d.timestamp) return;
    const day = d.timestamp.toDate().getDate();
    byDay[day] = byDay[day] || {};
    byDay[day][d.uid] = byDay[day][d.uid] || { gym: 0, home: 0 };
    byDay[day][d.uid][d.type] += 1;
  });

  const daysInMonth = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 0).getDate();
  const startDow = monthStart.getDay();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calViewDate.getFullYear() && today.getMonth() === calViewDate.getMonth();

  const gridEl = mainEl.querySelector('#calGrid');
  let html = '';
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayData = byDay[day] || {};
    const isToday = isCurrentMonth && today.getDate() === day;
    const marks = dayMarksHTML(dayData[state.uid], 'me') + dayMarksHTML(dayData[partnerUid], 'partner');
    html += `<button class="cal-day ${isToday ? 'today' : ''}" data-day="${day}">
      <span>${day}</span>
      <span class="marks">${marks}</span>
    </button>`;
  }
  gridEl.innerHTML = html;

  gridEl.querySelectorAll('.cal-day[data-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      gridEl.querySelectorAll('.cal-day').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const day = parseInt(btn.dataset.day, 10);
      showDayDetail(day, byDay[day] || {}, partnerUid, partnerName);
    });
  });
}

function iconSVG(type) {
  if (type === 'gym') {
    // Simple dumbbell glyph
    return `<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor">
      <rect x="1" y="9" width="3" height="6" rx="1"/>
      <rect x="20" y="9" width="3" height="6" rx="1"/>
      <rect x="5" y="10.5" width="14" height="3" rx="1"/>
    </svg>`;
  }
  // Simple home glyph
  return `<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor">
    <polygon points="12,3 21,11 18.5,11 18.5,21 5.5,21 5.5,11 3,11"/>
  </svg>`;
}

function dayMarksHTML(stat, personClass) {
  if (!stat) return '';
  let html = '';
  if (stat.gym) html += `<span class="mark ${personClass}">${iconSVG('gym')}</span>`;
  if (stat.home) html += `<span class="mark ${personClass}">${iconSVG('home')}</span>`;
  return html;
}

function showDayDetail(day, dayData, partnerUid, partnerName) {
  const detail = mainEl.querySelector('#calDayDetail');
  detail.classList.remove('hidden');
  const dateLabel = new Date(calViewDate.getFullYear(), calViewDate.getMonth(), day)
    .toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });

  const me = dayData[state.uid] || { gym: 0, home: 0 };
  const partner = partnerUid ? (dayData[partnerUid] || { gym: 0, home: 0 }) : { gym: 0, home: 0 };

  const row = (label, stat) => {
    if (!stat.gym && !stat.home) return `<div class="detail-row"><span>${label}</span><span class="muted">Rest day</span></div>`;
    const parts = [];
    if (stat.gym) parts.push(`${stat.gym} gym`);
    if (stat.home) parts.push(`${stat.home} home`);
    return `<div class="detail-row"><span>${label}</span><span>${parts.join(', ')}</span></div>`;
  };

  detail.innerHTML = `<h4>${dateLabel}</h4>${row('You', me)}${row(partnerName, partner)}`;
}

// ------------------------------------------------------------
// Us tab — comparison, streaks, achievements
// ------------------------------------------------------------

async function fetchClosedCycles() {
  const snap = await db.collection('pacts').doc(state.pactId).collection('cycles')
    .where('isClosed', '==', true)
    .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function renderUs() {
  if (!state.pact || !state.cycle) return;
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-us'));

  const target = state.cycle.target;
  const myStat = state.cycle.stats[state.uid] || {};
  const partnerUid = partnerUidOf();
  const partnerStat = partnerUid ? (state.cycle.stats[partnerUid] || {}) : {};
  const partnerName = partnerUid ? (state.pact.memberNames[partnerUid] || 'Partner') : 'Partner (waiting to join)';

  mainEl.querySelector('#usProgress').innerHTML = `
    <div class="card progress-card">${progressCardHTML('You', myStat, target)}</div>
    <div class="card progress-card">${progressCardHTML(partnerName, partnerStat, target)}</div>`;

  const [myStreak, partnerStreak, closedCycles] = await Promise.all([
    computeStreak(state.uid),
    partnerUid ? computeStreak(partnerUid) : Promise.resolve({ current: 0, best: 0 }),
    fetchClosedCycles(),
  ]);
  checkPartnerStreakDrop(partnerStreak.current);

  mainEl.querySelector('#usStreaks').innerHTML = `
    <div class="card">
      <span class="flame">🔥</span>
      <div class="streak-num">${myStreak.current}</div>
      <div class="who">You · best ${myStreak.best}</div>
    </div>
    <div class="card">
      <span class="flame">🔥</span>
      <div class="streak-num">${partnerStreak.current}</div>
      <div class="who">${partnerName} · best ${partnerStreak.best}</div>
    </div>`;

  const achievements = computeAchievements({ myStreak, partnerStreak, myStat, partnerStat, target, closedCycles });
  mainEl.querySelector('#usAchievements').innerHTML = achievements.map(a => `
    <div class="achv-badge ${a.unlocked ? 'unlocked' : ''}">
      <span class="achv-icon">${a.icon}</span>
      <span class="achv-label">${a.label}</span>
    </div>`).join('');
}

function computeAchievements({ myStreak, myStat, partnerStat, target, closedCycles }) {
  const perfectMonth = closedCycles.some(c => isComplete(c.stats[state.uid] || {}, c.target));
  const teamEffort = !!(myStat.deposited && partnerStat.deposited);
  const currentLeader = effectiveWorkouts(myStat) > effectiveWorkouts(partnerStat);
  return [
    { id: 'streak7', icon: '🔥', label: '7-day streak', unlocked: myStreak.best >= 7 },
    { id: 'perfect', icon: '💯', label: 'Perfect month', unlocked: perfectMonth },
    { id: 'team', icon: '🤝', label: 'Team effort', unlocked: teamEffort },
    { id: 'leader', icon: '🏆', label: 'Current leader', unlocked: currentLeader },
  ];
}

// ------------------------------------------------------------
// Pool tab — money + history
// ------------------------------------------------------------

async function renderPool() {
  if (!state.pact || !state.cycle) return;
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-pool'));

  mainEl.querySelector('#poolTotal').textContent = formatMoney(state.pact.poolTotal);

  const myStat = state.cycle.stats[state.uid] || {};
  const target = state.cycle.target;
  const eff = effectiveWorkouts(myStat);
  const remaining = Math.max(target - eff, 0);
  const atRisk = myStat.deposited ? state.pact.depositAmount : 0;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - now.getDate(), 0);
  const deadline = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const weeksLeft = Math.max(daysLeft / 7, 0.1);
  const perWeek = remaining > 0 ? Math.ceil(remaining / weeksLeft) : 0;

  mainEl.querySelector('#riskSummary').innerHTML = `
    <div class="risk-row"><span>At risk this month</span><span class="value">${formatMoney(atRisk)}</span></div>
    <div class="risk-row"><span>Workouts remaining</span><span class="value">${remaining}</span></div>
    <div class="risk-row"><span>Days left</span><span class="value">${daysLeft}</span></div>
    <div class="risk-row"><span>Pace needed</span><span class="value">${remaining === 0 ? '—' : `${perWeek}/week`}</span></div>
    <div class="risk-row"><span>Deadline</span><span class="value">${deadline.toLocaleDateString('default', { month: 'short', day: 'numeric' })}</span></div>`;

  const closedCycles = await fetchClosedCycles();
  const historyEl = mainEl.querySelector('#poolHistory');
  if (closedCycles.length === 0) {
    historyEl.innerHTML = `<p class="center muted small">No completed months yet.</p>`;
    return;
  }
  historyEl.innerHTML = closedCycles.map(cycle => {
    const rows = Object.entries(cycle.stats || {}).map(([uid, stat]) => {
      const name = state.pact.memberNames[uid] || uid;
      const done = isComplete(stat, cycle.target);
      return `<div class="history-row"><span>${name}</span><span>${effectiveWorkouts(stat)}/${cycle.target} ${done ? `✅ ${formatMoney(cycle.depositAmount)} back` : `❌ ${formatMoney(cycle.depositAmount)} lost`}</span></div>`;
    }).join('');
    return `<div class="history-cycle"><h4>${cycle.id}</h4>${rows}</div>`;
  }).join('');
}

// ------------------------------------------------------------
// Settings screen (notifications + sign out)
// ------------------------------------------------------------

async function registerPush() {
  const statusEl = mainEl.querySelector('#pushStatus');
  if (!messaging) {
    if (statusEl) statusEl.textContent = 'Push isn\'t supported in this browser.';
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (statusEl) statusEl.textContent = 'Permission denied — enable notifications for this site in your phone settings.';
      return;
    }
    const registration = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) {
      await notifPrefsRef().set({ fcmToken: token }, { merge: true });
      if (statusEl) statusEl.textContent = '✅ Push notifications enabled on this device.';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Couldn't enable push: ${e.message}`;
  }
}

function renderSettings() {
  hideShell();
  mainEl.innerHTML = '';
  mainEl.appendChild(clone('tpl-notifsettings'));
  mainEl.querySelector('#backBtn').addEventListener('click', () => { showShell(); switchTab(state.activeTab); });
  mainEl.querySelector('#signOutBtn').addEventListener('click', () => auth.signOut());

  mainEl.querySelector('#settingsPactId').textContent = state.pactId;

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  mainEl.querySelectorAll('[data-theme-choice]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === currentTheme);
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeChoice;
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('fitpact_theme', theme); } catch (e) {}
      mainEl.querySelectorAll('[data-theme-choice]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  mainEl.querySelector('#sharePactIdBtn').addEventListener('click', async () => {
    const text = `Join my FitPact! Pact ID: ${state.pactId}`;
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(state.pactId);
        const btn = mainEl.querySelector('#sharePactIdBtn');
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (e) { /* clipboard unavailable */ }
    }
  });

  mainEl.querySelector('#enablePushBtn').addEventListener('click', registerPush);
  (async () => {
    const statusEl = mainEl.querySelector('#pushStatus');
    if (!messaging) { statusEl.textContent = "Push isn't supported in this browser."; return; }
    if (Notification.permission === 'granted') {
      const snap = await notifPrefsRef().get().catch(() => null);
      statusEl.textContent = (snap && snap.exists && snap.data().fcmToken)
        ? '✅ Push notifications enabled on this device.'
        : 'Permission granted — tap below to finish setup.';
    } else {
      statusEl.textContent = 'Not enabled yet.';
    }
  })();

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  mainEl.querySelectorAll('input[type=checkbox]').forEach(input => {
    const group = input.dataset.pref;
    const key = input.dataset.key;
    input.checked = !!(state.notifPrefs[group] || {})[key];
    input.addEventListener('change', async () => {
      state.notifPrefs[group] = state.notifPrefs[group] || {};
      state.notifPrefs[group][key] = input.checked;
      try { await notifPrefsRef().set(state.notifPrefs, { merge: true }); } catch (e) {}
    });
  });
}

// ------------------------------------------------------------
// Streaks
// ------------------------------------------------------------

async function computeStreak(uid) {
  const snap = await db.collection('pacts').doc(state.pactId).collection('workoutLogs')
    .where('uid', '==', uid)
    .orderBy('timestamp', 'desc')
    .limit(400)
    .get();

  const days = new Set();
  snap.forEach(doc => {
    const d = doc.data();
    if (d.timestamp) days.add(d.timestamp.toDate().toDateString());
  });

  let cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (days.has(cursor.toDateString())) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sorted = Array.from(days).map(d => new Date(d)).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  sorted.forEach(d => {
    if (prev && (d - prev) / 86400000 === 1) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  });

  return { current, best: Math.max(best, current) };
}

async function renderStreakCard() {
  const card = mainEl.querySelector('#streakCard');
  if (!card) return;
  const { current, best } = await computeStreak(state.uid);
  card.innerHTML = `
    <div class="streak-main">
      <span class="flame">🔥</span>
      <div>
        <div class="streak-num">${current} day${current === 1 ? '' : 's'}</div>
        <div class="streak-label">Current streak</div>
      </div>
    </div>
    <div class="streak-best">Best<br/><strong>${best}</strong></div>`;
}

function checkPartnerStreakDrop(newStreak) {
  const key = `fitpact_partner_streak_${state.pactId}`;
  const prev = parseInt(localStorage.getItem(key) || '0', 10);
  if (newStreak < prev && prev >= 2 && state.notifPrefs.couple.partnerLostStreak) {
    const partnerUid = partnerUidOf();
    const partnerName = partnerUid ? (state.pact.memberNames[partnerUid] || 'Your partner') : 'Your partner';
    notify('FitPact', `${partnerName}'s ${prev}-day streak just ended.`);
  }
  localStorage.setItem(key, String(newStreak));
}

// ------------------------------------------------------------
// Notification prefs
// ------------------------------------------------------------

function notifPrefsRef() {
  return db.collection('pacts').doc(state.pactId).collection('notifPrefs').doc(state.uid);
}

async function loadNotifPrefs() {
  try {
    const snap = await notifPrefsRef().get();
    if (snap.exists) {
      const d = snap.data();
      state.notifPrefs = { times: d.times || {}, couple: d.couple || {} };
    }
  } catch (e) {}
}

// ------------------------------------------------------------
// Message templates + delivery (foreground only)
// ------------------------------------------------------------

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body });
}

if (messaging) {
  messaging.onMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'FitPact';
    const body = (payload.notification && payload.notification.body) || '';
    notify(title, body);
  });
}

function monthName() {
  return new Date().toLocaleString('default', { month: 'long' });
}

const firedToday = new Set();

function checkDailyReminder() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  if (Notification.permission !== 'granted') return;
  if (!state.cycle) return;

  const now = new Date();
  const todayKey = now.toDateString();
  const slots = ['08:00', '12:00', '18:00', '20:30'];

  const myStat = state.cycle.stats[state.uid] || {};
  const target = state.cycle.target;
  const eff = effectiveWorkouts(myStat);
  const doneToday = hasLoggedToday(state.uid);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();
  const remaining = Math.max(target - eff, 0);

  slots.forEach(slot => {
    const fireKey = `${todayKey}-${slot}`;
    if (firedToday.has(fireKey)) return;
    if (!state.notifPrefs.times[slot]) return;

    const [slotH, slotM] = slot.split(':').map(Number);
    const slotMinutes = slotH * 60 + slotM;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < slotMinutes) return;

    firedToday.add(fireKey);
    if (remaining === 0) return;

    if (daysLeft <= 4) {
      notify('FitPact', `🚨 ${daysLeft} day${daysLeft === 1 ? '' : 's'} left\nYou need ${remaining} more workout${remaining === 1 ? '' : 's'} to protect your ${formatMoney(state.pact.depositAmount)}.`);
      return;
    }

    if (doneToday) return;

    if (slot === '08:00') {
      notify('FitPact', `☀️ Good morning. ${monthName()} isn't going to complete itself.`);
    } else if (slot === '12:00') {
      notify('FitPact', `🏋️ No workout logged today. You've got time.`);
    } else if (slot === '18:00' || slot === '20:30') {
      const timeLabel = slot === '18:00' ? '6:00 PM' : '8:30 PM';
      notify('FitPact', `⚠️ ${timeLabel} — You still need today's workout.`);
    }
  });
}

function hasLoggedToday(uid) {
  if (uid !== state.uid) return false;
  return state.lastLogDate === new Date().toDateString();
}

function handleCycleDiff(prevStats, newStats) {
  if (!prevStats || !newStats || !state.pact) return;
  const partnerUid = partnerUidOf();
  if (!partnerUid) return;

  const prevPartner = prevStats[partnerUid] || {};
  const newPartner = newStats[partnerUid] || {};
  const prevPartnerEff = effectiveWorkouts(prevPartner);
  const newPartnerEff = effectiveWorkouts(newPartner);
  if (newPartnerEff <= prevPartnerEff) return;

  const myEff = effectiveWorkouts(newStats[state.uid] || {});
  const partnerName = state.pact.memberNames[partnerUid] || 'Your partner';
  const wasAheadOfMe = prevPartnerEff > effectiveWorkouts(prevStats[state.uid] || {});
  const isAheadOfMeNow = newPartnerEff > myEff;

  if (!wasAheadOfMe && isAheadOfMeNow && state.notifPrefs.couple.partnerTookLead) {
    notify('FitPact', `${partnerName} is now ${newPartnerEff - myEff} workout${(newPartnerEff - myEff) === 1 ? '' : 's'} ahead of you.`);
  } else if (state.notifPrefs.couple.partnerCompleted) {
    notify('FitPact', `👀 ${partnerName} just completed a workout.\nYour move.`);
  }

  const gap = newPartnerEff - myEff;
  if (gap >= 3 && state.notifPrefs.couple.fallingBehind) {
    notify('FitPact', `You're falling behind — ${partnerName} is ${gap} workouts ahead.`);
  }
}

setInterval(() => { if (state.cycle) checkDailyReminder(); }, 5 * 60 * 1000);
