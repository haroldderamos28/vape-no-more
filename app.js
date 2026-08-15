const STORAGE_KEY = "tapr_state_v1";

const PROTOCOL_PHASES = [
  { dayStart: 1, dayEnd: 3, restrictedMin: 60, allowedMin: 5 },
  { dayStart: 4, dayEnd: 7, restrictedMin: 90, allowedMin: 5 },
  { dayStart: 8, dayEnd: 12, restrictedMin: 120, allowedMin: 5 },
  { dayStart: 13, dayEnd: 21, restrictedMin: 150, allowedMin: 5 }
];

function defaultState() {
  return {
    onboarded: false,
    costPerVape: 450,
    ratedPuffs: 10000,
    costPerPuff: 0.045,
    baselinePerHour: 89,
    startDate: null,
    programPhase: "MANDATORY_21",
    postProgramMode: null,
    currentRestrictedMin: 150,
    currentAllowedMin: 5,
    customAllowedMin: null,
    currentWindow: { type: "RESTRICTED", startedAt: null, endsAt: null },
    puffLog: [],
    moodLog: [],
    slipLog: [],
    rewards: [],
    pendingMoodForWindowEnd: null
  };
}

let state = loadState();
let tempSlipType = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2200);
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-" + name).classList.remove("hidden");
  if (name === "home") renderHome();
  if (name === "puffLog") renderPuffLog();
  if (name === "rewards") renderRewards();
  if (name === "settings") renderSettings();
}

/* ---------- ONBOARDING ---------- */

function goToStep(n) {
  document.querySelectorAll(".ob-step").forEach(s => s.classList.add("hidden"));
  document.getElementById("ob-step-" + n).classList.remove("hidden");
}

function lookupVape() {
  const name = document.getElementById("ob-vape-name").value;
  const result = lookupVapePuffs(name);
  const box = document.getElementById("ob-lookup-result");
  box.classList.remove("hidden");
  if (result) {
    document.getElementById("ob-puffs").value = result.puffs;
    box.textContent = "Matched \"" + result.name + "\" - " + result.puffs.toLocaleString() + " puffs";
  } else {
    document.getElementById("ob-puffs").value = 10000;
    box.textContent = "Couldn't find that one, using a typical estimate of 10,000. You can adjust it below.";
  }
}

function computeBaseline() {
  const cost = parseFloat(document.getElementById("ob-cost").value);
  const duration = parseFloat(document.getElementById("ob-duration").value);
  const unit = document.getElementById("ob-duration-unit").value;
  const puffs = parseFloat(document.getElementById("ob-puffs").value);
  const errEl = document.getElementById("ob-error-2");

  if (!cost || cost <= 0 || !duration || duration <= 0 || !puffs || puffs <= 0) {
    errEl.textContent = "Fill in cost, duration, and puff rating first.";
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");

  const days = unit === "weeks" ? duration * 7 : duration;
  const puffsPerDay = puffs / days;
  const baselinePerHour = Math.round(puffsPerDay / 16); // assume ~16 waking hours
  const costPerPuff = cost / puffs;

  state.costPerVape = cost;
  state.ratedPuffs = puffs;
  state.costPerPuff = costPerPuff;
  state.baselinePerHour = baselinePerHour;

  document.getElementById("ob-baseline-display").textContent = baselinePerHour;
  document.getElementById("ob-baseline-input").value = baselinePerHour;
  document.getElementById("ob-cost-per-puff").textContent =
    "\u20b1" + costPerPuff.toFixed(3) + " per puff, from your numbers above.";

  goToStep(3);
}

function finishOnboarding() {
  const editedBaseline = parseFloat(document.getElementById("ob-baseline-input").value);
  if (editedBaseline && editedBaseline > 0) state.baselinePerHour = editedBaseline;

  state.onboarded = true;
  state.startDate = new Date().toISOString();
  const phase = PROTOCOL_PHASES[0];
  state.currentRestrictedMin = phase.restrictedMin;
  state.currentAllowedMin = phase.allowedMin;
  startWindow("RESTRICTED", phase.restrictedMin);
  saveState();
  showView("home");
}

/* ---------- PROTOCOL / DAY LOGIC ---------- */

function getCurrentDay() {
  if (!state.startDate) return 1;
  const start = new Date(state.startDate);
  const now = new Date();
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nowMidnight - startMidnight) / (24 * 60 * 60 * 1000));
  return diffDays + 1;
}

function getPhaseForDay(day) {
  for (const p of PROTOCOL_PHASES) {
    if (day >= p.dayStart && day <= p.dayEnd) return p;
  }
  return PROTOCOL_PHASES[PROTOCOL_PHASES.length - 1];
}

function updateProtocolForToday() {
  const day = getCurrentDay();

  if (day > 21 && state.programPhase === "MANDATORY_21") {
    state.programPhase = "AWAITING_CHOICE";
    saveState();
    showView("choice");
    return;
  }

  if (state.programPhase === "MANDATORY_21") {
    const phase = getPhaseForDay(day);
    state.currentRestrictedMin = phase.restrictedMin;
    state.currentAllowedMin = state.customAllowedMin || phase.allowedMin;
  }
}

function chooseMode(mode) {
  state.postProgramMode = mode;
  state.programPhase = "POST_PROGRAM";
  saveState();
  startWindow("RESTRICTED", state.currentRestrictedMin);
  showView("home");
}

/* post-day-21 step-up, called on window transitions */
function maybeStepUpPostProgram() {
  if (state.programPhase !== "POST_PROGRAM") return;
  if (state.postProgramMode === "CONTINUE_INTERVAL") {
    const day = getCurrentDay();
    const daysSince21 = day - 21;
    const stepsEarned = Math.floor(daysSince21 / 9);
    state.currentRestrictedMin = 150 + stepsEarned * 30;
  }
  // SELF_PACED mode is handled by streak logic in transitionWindow()
}

/* ---------- WINDOW / TIMER ---------- */

let timerInterval = null;
let consecutiveCleanWindows = 0;

function startWindow(type, durationMin) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationMin * 60 * 1000);
  state.currentWindow = { type, startedAt: now.toISOString(), endsAt: endsAt.toISOString(), puffsThisWindow: 0 };
  saveState();
  scheduleNotifications(type, durationMin);
}

function transitionWindow() {
  const finishedType = state.currentWindow.type;

  if (finishedType === "RESTRICTED") {
    if ((state.currentWindow.puffsThisWindow || 0) === 0) consecutiveCleanWindows++;
    else consecutiveCleanWindows = 0;

    if (state.programPhase === "POST_PROGRAM" && state.postProgramMode === "SELF_PACED") {
      if (consecutiveCleanWindows >= 2) {
        state.currentRestrictedMin = Math.round(state.currentRestrictedMin * 1.2);
        consecutiveCleanWindows = 0;
      }
    }

    state.pendingMoodForWindowEnd = true;
    updateProtocolForToday();
    maybeStepUpPostProgram();
    startWindow("ALLOWED", state.currentAllowedMin);
  } else {
    startWindow("RESTRICTED", state.currentRestrictedMin);
  }
  saveState();

  if (state.pendingMoodForWindowEnd) {
    state.pendingMoodForWindowEnd = false;
    saveState();
    showView("mood");
  } else {
    renderHome();
  }
}

function tick() {
  if (!state.onboarded) return;
  if (state.programPhase === "AWAITING_CHOICE") return;

  const now = new Date();
  const endsAt = new Date(state.currentWindow.endsAt);
  const remainingMs = endsAt - now;

  if (remainingMs <= 0) {
    transitionWindow();
    return;
  }

  if (!document.getElementById("view-home").classList.contains("hidden")) {
    renderRingTime(remainingMs);
  }
  if (!document.getElementById("view-puffLog").classList.contains("hidden")) {
    renderPuffWindowTime(remainingMs);
  }
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

/* ---------- NOTIFICATIONS ---------- */

let scheduledTimeouts = [];

function clearScheduledNotifications() {
  scheduledTimeouts.forEach(id => clearTimeout(id));
  scheduledTimeouts = [];
}

function scheduleNotifications(type, durationMin) {
  clearScheduledNotifications();
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const durationMs = durationMin * 60 * 1000;

  if (durationMin > 5) {
    const warnMs = durationMs - 5 * 60 * 1000;
    scheduledTimeouts.push(setTimeout(() => {
      if (type === "ALLOWED") {
        notify("5 min left to vape", "Your allowed window closes soon.");
      } else {
        notify("Almost there", "5 min until your next allowed window.");
      }
    }, warnMs));
  }

  scheduledTimeouts.push(setTimeout(() => {
    if (type === "ALLOWED") {
      notify("Restricted window started", "No vaping for a while. You've got this.");
    } else {
      notify("You made it", "Allowed window is open. Log your puffs when you're ready.");
    }
  }, durationMs));
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: "icons/icon-192.png" }));
  } else {
    new Notification(title, { body });
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

/* ---------- HOME RENDER ---------- */

function renderHome() {
  const day = Math.min(getCurrentDay(), 21);
  document.getElementById("home-day-label").textContent =
    state.programPhase === "POST_PROGRAM" ? "Day " + getCurrentDay() + " (post-program)" : "Day " + day + " of 21";
  document.getElementById("home-progress-fill").style.width = Math.min(100, (day / 21) * 100) + "%";

  const type = state.currentWindow.type;
  document.getElementById("ring-window-type").textContent = type === "RESTRICTED" ? "Restricted" : "Allowed";
  document.getElementById("ring-sub").textContent =
    (type === "RESTRICTED" ? state.currentRestrictedMin : state.currentAllowedMin) + " min window";
  document.getElementById("ring-end").textContent =
    "Ends at " + formatClockTime(new Date(state.currentWindow.endsAt));

  const banner = document.getElementById("status-banner");
  const statusText = document.getElementById("status-text");
  if (type === "RESTRICTED") {
    banner.className = "status-banner";
    statusText.textContent = (state.currentWindow.puffsThisWindow || 0) === 0 ? "No vapes yet this window" : "Puffs logged this window";
  } else {
    banner.className = "status-banner warning";
    statusText.textContent = "Allowed window is open";
  }

  document.getElementById("allowed-window-btn").style.display = type === "ALLOWED" ? "block" : "none";

  document.getElementById("home-saved").textContent = "\u20b1" + computeTotalSaved().toFixed(0);
  const lastMood = state.moodLog.length ? state.moodLog[state.moodLog.length - 1] : null;
  document.getElementById("home-last-mood").textContent = lastMood ? lastMood.mood : "--";

  const now = new Date();
  const endsAt = new Date(state.currentWindow.endsAt);
  renderRingTime(endsAt - now);
}

function renderRingTime(remainingMs) {
  document.getElementById("ring-time").textContent = formatDuration(remainingMs);
  const total = (state.currentWindow.type === "RESTRICTED" ? state.currentRestrictedMin : state.currentAllowedMin) * 60 * 1000;
  const elapsed = total - remainingMs;
  const circumference = 2 * Math.PI * 78;
  const fraction = Math.max(0, Math.min(1, elapsed / total));
  const offset = circumference * (1 - fraction);
  const ring = document.getElementById("ring-fg");
  if (ring) {
    ring.setAttribute("stroke-dasharray", circumference);
    ring.setAttribute("stroke-dashoffset", offset);
  }
}

/* ---------- PUFF LOG ---------- */

function renderPuffLog() {
  const type = state.currentWindow.type;
  document.getElementById("puff-window-status").textContent = type === "ALLOWED" ? "Allowed window" : "Restricted window";
  document.getElementById("puff-count").textContent = state.currentWindow.puffsThisWindow || 0;
  document.getElementById("puff-baseline-note").textContent = "Your unrestricted baseline: ~" + state.baselinePerHour + "/hr";
  const now = new Date();
  renderPuffWindowTime(new Date(state.currentWindow.endsAt) - now);
  updatePuffSavingsPreview();
}

function renderPuffWindowTime(remainingMs) {
  document.getElementById("puff-window-time").textContent = formatDuration(remainingMs) + " left";
  document.getElementById("puff-window-end").textContent =
    "Ends at " + formatClockTime(new Date(state.currentWindow.endsAt));
}

function changePuff(delta) {
  const current = state.currentWindow.puffsThisWindow || 0;
  state.currentWindow.puffsThisWindow = Math.max(0, current + delta);
  saveState();
  document.getElementById("puff-count").textContent = state.currentWindow.puffsThisWindow;
  updatePuffSavingsPreview();
}

function updatePuffSavingsPreview() {
  const puffs = state.currentWindow.puffsThisWindow || 0;
  const puffsSaved = Math.max(state.baselinePerHour - puffs, 0);
  const saved = puffsSaved * state.costPerPuff;
  document.getElementById("puff-saved").textContent = "\u20b1" + saved.toFixed(2);
  const pct = state.baselinePerHour > 0 ? Math.max(0, Math.min(100, (puffsSaved / state.baselinePerHour) * 100)) : 0;
  document.getElementById("puff-bar").style.width = pct + "%";
}

function lockPuffWindow() {
  state.puffLog.push({
    windowType: state.currentWindow.type,
    count: state.currentWindow.puffsThisWindow || 0,
    timestamp: new Date().toISOString()
  });
  saveState();
  showToast("Logged " + (state.currentWindow.puffsThisWindow || 0) + " puffs");
  showView("home");
}

/* ---------- MOOD ---------- */

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".mood-btn");
  if (!btn) return;
  document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  btn.dataset.selected = "true";
  document.getElementById("mood-error").classList.add("hidden");
});

function saveMood() {
  const selected = document.querySelector(".mood-btn.selected");
  if (!selected) {
    document.getElementById("mood-error").classList.remove("hidden");
    return;
  }
  const note = document.getElementById("mood-note").value;
  state.moodLog.push({ mood: selected.dataset.mood, note, timestamp: new Date().toISOString() });
  saveState();
  document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("mood-note").value = "";
  showToast("Check-in saved");
  showView("home");
}

/* ---------- SLIP LOG ---------- */

function setSlipType(type) {
  tempSlipType = type;
  document.getElementById("slip-survived-btn").className = type === "survived" ? "full primary" : "full";
  document.getElementById("slip-gave-in-btn").className = type === "gave_in" ? "full primary" : "full";
}

function saveSlip() {
  if (!tempSlipType) {
    showToast("Pick an option first");
    return;
  }
  state.slipLog.push({ type: tempSlipType, note: document.getElementById("slip-note").value, timestamp: new Date().toISOString() });
  saveState();
  tempSlipType = null;
  document.getElementById("slip-note").value = "";
  document.getElementById("slip-survived-btn").className = "full";
  document.getElementById("slip-gave-in-btn").className = "full";
  showToast("Logged");
  showView("home");
}

/* ---------- SAVINGS / REWARDS ---------- */

function computeTotalSaved() {
  let totalPuffsSaved = 0;
  const start = state.startDate ? new Date(state.startDate) : new Date();
  const now = new Date();
  const elapsedHours = Math.max(0, (now - start) / (1000 * 60 * 60));
  const expectedBaselinePuffs = elapsedHours * state.baselinePerHour;

  const actualPuffs = state.puffLog.reduce((sum, entry) => sum + entry.count, 0);
  totalPuffsSaved = Math.max(0, expectedBaselinePuffs - actualPuffs);

  return totalPuffsSaved * state.costPerPuff;
}

function computeTotalPuffsSaved() {
  const start = state.startDate ? new Date(state.startDate) : new Date();
  const now = new Date();
  const elapsedHours = Math.max(0, (now - start) / (1000 * 60 * 60));
  const expectedBaselinePuffs = elapsedHours * state.baselinePerHour;
  const actualPuffs = state.puffLog.reduce((sum, entry) => sum + entry.count, 0);
  return Math.max(0, Math.round(expectedBaselinePuffs - actualPuffs));
}

function renderRewards() {
  const total = computeTotalSaved();
  document.getElementById("rewards-total").textContent = "\u20b1" + total.toFixed(0);
  document.getElementById("rewards-puffs").textContent = computeTotalPuffsSaved().toLocaleString() + " puffs not taken";

  const banner = document.getElementById("rewards-milestone-banner");
  const vapePct = Math.min(100, (total / state.costPerVape) * 100);
  if (vapePct >= 100) {
    banner.textContent = "You've saved the cost of a whole vape";
    banner.style.display = "block";
  } else if (vapePct >= 25) {
    banner.textContent = "That's already " + vapePct.toFixed(0) + "% of one whole vape";
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }

  const list = document.getElementById("rewards-list");
  list.innerHTML = "";

  const sorted = [...state.rewards].sort((a, b) => a.cost - b.cost);

  sorted.forEach((r) => {
    const card = document.createElement("div");
    const unlocked = total >= r.cost;
    card.className = "reward-card" + (!unlocked && total < r.cost * 0.3 ? " dim" : "");

    if (r.status === "claimed") {
      card.innerHTML =
        '<div class="row space-between"><span class="reward-title">' + escapeHtml(r.title) + '</span>' +
        '<span class="reward-status">Claimed</span></div>' +
        '<p class="hint">Bought: ' + escapeHtml(r.claimedItem || r.title) +
        (r.claimedAmount ? " \u00b7 \u20b1" + r.claimedAmount : "") + '</p>';
    } else if (unlocked) {
      card.innerHTML =
        '<div class="row space-between"><span class="reward-title">' + escapeHtml(r.title) + '</span>' +
        '<span class="reward-status unlocked">Unlocked</span></div>' +
        '<button class="full" onclick="openClaim(\'' + r.id + '\')">Claim reward</button>';
    } else {
      const pct = Math.max(0, Math.min(100, (total / r.cost) * 100));
      card.innerHTML =
        '<div class="row space-between"><span class="reward-title">' + escapeHtml(r.title) + '</span>' +
        '<span class="hint">\u20b1' + total.toFixed(0) + ' / \u20b1' + r.cost + '</span></div>' +
        '<div class="progress-bar small"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<p class="hint">\u20b1' + Math.max(0, r.cost - total).toFixed(0) + ' to go</p>';
    }
    list.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function addReward() {
  const title = document.getElementById("reward-title").value.trim();
  const cost = parseFloat(document.getElementById("reward-cost").value);
  const errEl = document.getElementById("reward-error");
  if (!title || !cost || cost <= 0) {
    errEl.textContent = "Enter a reward name and a valid cost.";
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");
  state.rewards.push({ id: "r" + Date.now(), title, cost, status: "active" });
  saveState();
  document.getElementById("reward-title").value = "";
  document.getElementById("reward-cost").value = "";
  showView("rewards");
}

let claimingRewardId = null;
function openClaim(id) {
  claimingRewardId = id;
  const reward = state.rewards.find(r => r.id === id);
  document.getElementById("claim-item").value = reward ? reward.title : "";
  document.getElementById("claim-amount").value = "";
  showView("claimReward");
}

function claimReward() {
  const reward = state.rewards.find(r => r.id === claimingRewardId);
  if (!reward) { showView("rewards"); return; }
  reward.status = "claimed";
  reward.claimedItem = document.getElementById("claim-item").value.trim() || reward.title;
  const amt = parseFloat(document.getElementById("claim-amount").value);
  if (amt) reward.claimedAmount = amt;
  saveState();
  showToast("Reward claimed");
  showView("rewards");
}

/* ---------- SETTINGS ---------- */

function renderSettings() {
  document.getElementById("set-cost").value = state.costPerVape;
  document.getElementById("set-puffs").value = state.ratedPuffs;
  document.getElementById("set-baseline").value = state.baselinePerHour;
  document.getElementById("set-allowed").value = state.currentAllowedMin;
}

function saveSettings() {
  const cost = parseFloat(document.getElementById("set-cost").value);
  const puffs = parseFloat(document.getElementById("set-puffs").value);
  const baseline = parseFloat(document.getElementById("set-baseline").value);
  const allowedMin = parseFloat(document.getElementById("set-allowed").value);
  if (cost > 0) { state.costPerVape = cost; state.costPerPuff = cost / (puffs || state.ratedPuffs); }
  if (puffs > 0) { state.ratedPuffs = puffs; state.costPerPuff = state.costPerVape / puffs; }
  if (baseline > 0) state.baselinePerHour = baseline;
  if (allowedMin > 0) {
    state.customAllowedMin = allowedMin;
    state.currentAllowedMin = allowedMin;
    if (state.currentWindow.type === "ALLOWED") {
      startWindow("ALLOWED", allowedMin);
    }
  }
  saveState();
  showToast("Settings saved");
  showView("home");
}

function resetApp() {
  if (!confirm("This clears all your data. Are you sure?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  location.reload();
}

function swooshMarkup(extraClass) {
  return '<svg class="corner-swoosh ' + (extraClass || "") + '" viewBox="0 0 320 180" aria-hidden="true">' +
    '<polygon points="320,0 320,140 0,0" fill="#3D4A17"></polygon>' +
    '<path d="M -20 60 Q 140 -10 320 90 L 320 0 L 0 0 Z" fill="var(--surface-0)"></path>' +
    '<path d="M -20 60 Q 140 -10 320 90" stroke="var(--silver)" stroke-width="6" fill="none"></path>' +
    '</svg>';
}

const SWOOSH_CONFIG = {
  "view-home": { top: true, bottom: true },
  "view-rewards": { top: true, bottom: true },
  "view-settings": { top: true, bottom: true },
  "view-onboarding": { top: true, bottom: true },
  "view-choice": { top: true, bottom: false, compact: true },
  "view-puffLog": { top: true, bottom: false, compact: true },
  "view-mood": { top: true, bottom: false, compact: true },
  "view-slip": { top: true, bottom: false, compact: true },
  "view-addReward": { top: true, bottom: false, compact: true },
  "view-claimReward": { top: true, bottom: false, compact: true }
};

function injectSwooshes() {
  Object.keys(SWOOSH_CONFIG).forEach((viewId) => {
    const view = document.getElementById(viewId);
    if (!view) return;
    const screen = view.querySelector(".screen");
    if (!screen || screen.dataset.swooshApplied) return;
    const cfg = SWOOSH_CONFIG[viewId];
    const cls = cfg.compact ? "compact" : "";
    let html = swooshMarkup(cls);
    if (cfg.bottom) html += swooshMarkup("bottom " + cls);
    screen.insertAdjacentHTML("afterbegin", html);
    screen.dataset.swooshApplied = "true";
  });
}

/* ---------- INIT ---------- */

function init() {
  injectSwooshes();
  requestNotificationPermission();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  if (!state.onboarded) {
    showView("onboarding");
  } else {
    if (state.programPhase === "AWAITING_CHOICE") {
      showView("choice");
    } else {
      updateProtocolForToday();
      if (state.currentWindow.endsAt && new Date(state.currentWindow.endsAt) < new Date()) {
        transitionWindow();
      } else {
        showView("home");
      }
    }
  }

  timerInterval = setInterval(tick, 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}

init();
