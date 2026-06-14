(() => {
  "use strict";

  const STORAGE_KEY = "sistema-consistencia-v1";
  const MAX_COUNT = Number.MAX_SAFE_INTEGER;
  const COMMERCIAL_FIELDS = ["prospects", "calls", "appointments", "talks", "enrollments"];
  const SATURATION_LABELS = {
    green: "Verde",
    yellow: "Amarillo",
    red: "Rojo",
    none: "Sin registro"
  };

  const defaultWeek = (startDate = getMondayKey(new Date())) => ({
    id: `week-${startDate}-${Date.now()}`,
    startDate,
    daily: {},
    weekly: {
      ayrton: false,
      claribel: false,
      expenses: false,
      church: false
    },
    closed: false
  });

  const defaultState = () => ({
    version: 1,
    currentWeek: defaultWeek(),
    history: [],
    weeksWithoutReset: 0,
    lastResetAt: null
  });

  let state = loadState();
  let toastTimer;
  let noteTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDate(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function getMondayKey(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const day = copy.getDay() || 7;
    copy.setDate(copy.getDate() - day + 1);
    return dateKey(copy);
  }

  function addDays(key, amount) {
    const date = parseDate(key);
    date.setDate(date.getDate() + amount);
    return dateKey(date);
  }

  function formatDate(key, options) {
    return new Intl.DateTimeFormat("es-MX", options).format(parseDate(key));
  }

  function formatWeekRange(startDate) {
    return `${formatDate(startDate, { day: "numeric", month: "short" })} — ${formatDate(addDays(startDate, 6), { day: "numeric", month: "short" })}`;
  }

  function safeNumber(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  }

  function safeCount(value) {
    return Math.floor(safeNumber(value, 0, MAX_COUNT));
  }

  function normalizeDaily(daily, legacyWeekly = {}) {
    const normalized = {};

    Object.entries(daily || {}).forEach(([key, entry]) => {
      normalized[key] = {
        saturation: entry?.saturation || null,
        medication: entry?.medication == null ? null : Boolean(entry.medication),
        exercise: entry?.exercise == null ? null : Boolean(entry.exercise),
        meals: entry?.meals == null ? null : Boolean(entry.meals),
        gratitude: entry?.gratitude == null ? null : Boolean(entry.gratitude),
        sleep: entry?.sleep || null,
        note: typeof entry?.note === "string" ? entry.note : "",
        completedAt: entry?.completedAt || null,
        commercial: Object.fromEntries(
          COMMERCIAL_FIELDS.map(field => [field, safeCount(entry?.commercial?.[field])])
        )
      };
    });

    const hasCommercialActivity = Object.values(normalized).some(entry =>
      COMMERCIAL_FIELDS.some(field => entry.commercial[field] > 0)
    );

    if (!hasCommercialActivity && (legacyWeekly.talks || legacyWeekly.enrollments)) {
      const today = dateKey(new Date());
      normalized[today] ||= {
        saturation: null,
        medication: null,
        exercise: null,
        meals: null,
        gratitude: null,
        sleep: null,
        note: "",
        completedAt: null,
        commercial: Object.fromEntries(COMMERCIAL_FIELDS.map(field => [field, 0]))
      };
      normalized[today].commercial.talks = safeCount(legacyWeekly.talks);
      normalized[today].commercial.enrollments = safeCount(legacyWeekly.enrollments);
    }

    return normalized;
  }

  function normalizeState(raw) {
    const fallback = defaultState();
    if (!raw || typeof raw !== "object") return fallback;

    const week = raw.currentWeek && typeof raw.currentWeek === "object"
      ? raw.currentWeek
      : fallback.currentWeek;

    return {
      version: 1,
      currentWeek: {
        id: typeof week.id === "string" ? week.id : fallback.currentWeek.id,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(week.startDate || "") ? week.startDate : fallback.currentWeek.startDate,
        daily: normalizeDaily(week.daily, week.weekly),
        weekly: {
          ayrton: Boolean(week.weekly?.ayrton),
          claribel: Boolean(week.weekly?.claribel),
          expenses: Boolean(week.weekly?.expenses),
          church: Boolean(week.weekly?.church)
        },
        closed: Boolean(week.closed)
      },
      history: Array.isArray(raw.history) ? raw.history : [],
      weeksWithoutReset: Math.max(0, Number(raw.weeksWithoutReset) || 0),
      lastResetAt: raw.lastResetAt || null
    };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      return defaultState();
    }
  }

  function saveState(showFeedback = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (showFeedback) {
      const status = $("#save-status");
      if (status) {
        status.textContent = "Guardado";
        status.animate(
          [{ opacity: .45 }, { opacity: 1 }],
          { duration: 220, easing: "ease-out" }
        );
      }
    }
  }

  function getTodayEntry() {
    const today = dateKey(new Date());
    if (!state.currentWeek.daily[today]) {
      state.currentWeek.daily[today] = {
        saturation: null,
        medication: null,
        exercise: null,
        meals: null,
        gratitude: null,
        sleep: null,
        note: "",
        completedAt: null,
        commercial: Object.fromEntries(COMMERCIAL_FIELDS.map(field => [field, 0]))
      };
    }
    const entry = state.currentWeek.daily[today];
    entry.commercial ||= Object.fromEntries(COMMERCIAL_FIELDS.map(field => [field, 0]));
    COMMERCIAL_FIELDS.forEach(field => {
      entry.commercial[field] = safeCount(entry.commercial[field]);
    });
    return entry;
  }

  function getCommercialTotals(week = state.currentWeek) {
    const totals = Object.fromEntries(COMMERCIAL_FIELDS.map(field => [field, 0]));
    Object.values(week.daily || {}).forEach(entry => {
      COMMERCIAL_FIELDS.forEach(field => {
        totals[field] += safeCount(entry?.commercial?.[field]);
      });
    });
    return totals;
  }

  function conversionRate(result, base) {
    if (!base) return 0;
    return Math.round((result / base) * 100);
  }

  function calculateScore(week = state.currentWeek) {
    const entries = Object.values(week.daily || {});
    const medicationDays = entries.filter(entry => entry.medication === true).length;
    const exerciseDays = entries.filter(entry => entry.exercise === true).length;
    const weekly = week.weekly || {};
    const commercial = getCommercialTotals(week);

    const parts = {
      medication: Math.min(35, medicationDays * 5),
      exercise: Math.min(35, exerciseDays * 5),
      talks: Math.min(10, commercial.talks * (10 / 7)),
      enrollments: commercial.enrollments >= 1 ? 5 : 0,
      ayrton: weekly.ayrton ? 5 : 0,
      claribel: weekly.claribel ? 5 : 0,
      expenses: weekly.expenses ? 5 : 0
    };

    return {
      total: Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0)),
      parts,
      medicationDays,
      exerciseDays,
      commercial
    };
  }

  function scoreState(score) {
    if (score >= 80) return { key: "green", label: "Verde", message: "La semana tiene una base sólida." };
    if (score >= 50) return { key: "yellow", label: "Amarillo", message: "Vas avanzando. Prioriza lo esencial." };
    return { key: "red", label: "Rojo", message: "Empieza con una acción pequeña." };
  }

  function predominantSaturation(week) {
    const counts = { green: 0, yellow: 0, red: 0 };
    Object.values(week.daily || {}).forEach(entry => {
      if (entry.saturation in counts) counts[entry.saturation] += 1;
    });
    const highest = Math.max(...Object.values(counts));
    if (highest === 0) return "none";
    return ["red", "yellow", "green"].find(key => counts[key] === highest) || "none";
  }

  function renderToday() {
    const now = new Date();
    $("#today-date").textContent = new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(now);

    const entry = getTodayEntry();
    const totals = getCommercialTotals();
    COMMERCIAL_FIELDS.forEach(field => {
      $(`#${field === "talks" || field === "enrollments" ? `daily-${field}` : field}-value`).textContent = entry.commercial[field];
    });
    const movement = Object.values(totals).reduce((sum, value) => sum + value, 0);
    $("#today-weekly-movement").textContent = `${movement} ${movement === 1 ? "movimiento" : "movimientos"}`;
    selectSegment("#saturation-control", entry.saturation);
    selectSegment("#medication-control", entry.medication === null ? null : String(entry.medication));
    selectSegment("#exercise-control", entry.exercise === null ? null : String(entry.exercise));
    selectSegment("#meals-control", entry.meals == null ? null : String(entry.meals));
    selectSegment("#gratitude-control", entry.gratitude == null ? null : String(entry.gratitude));
    selectSegment("#sleep-control", entry.sleep || null);
    $$("#view-today button, #view-today textarea").forEach(control => {
      control.disabled = state.currentWeek.closed;
    });

    const dot = $("#saturation-dot");
    dot.className = `status-dot ${entry.saturation || "neutral"}`;

    const note = $("#daily-note");
    if (document.activeElement !== note) note.value = entry.note || "";
    $("#note-count").textContent = `${note.value.length}/240`;

    const finishButton = $("#finish-day");
    const isComplete = Boolean(entry.completedAt) && isDailyEntryComplete(entry);
    finishButton.textContent = isComplete ? "✓ Registro de hoy completo" : "3 · Terminé por hoy";
    finishButton.classList.toggle("is-complete", isComplete);
  }

  function selectSegment(selector, value) {
    $$(`${selector} button`).forEach(button => {
      const selected = button.dataset.value === value;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function isDailyEntryComplete(entry) {
    return Boolean(entry.saturation)
      && entry.medication != null
      && entry.exercise != null
      && entry.meals != null
      && entry.gratitude != null
      && Boolean(entry.sleep);
  }

  function renderWeek() {
    const week = state.currentWeek;
    const totals = getCommercialTotals(week);
    $("#week-range").textContent = formatWeekRange(week.startDate);
    $("#week-state").textContent = week.closed ? "Cerrada" : "En curso";
    COMMERCIAL_FIELDS.forEach(field => {
      $(`#week-${field}`).textContent = totals[field];
    });
    $("#appointment-conversion").textContent = `${conversionRate(totals.talks, totals.appointments)}%`;
    $("#talk-conversion").textContent = `${conversionRate(totals.enrollments, totals.talks)}%`;
    $$("#view-week button").forEach(button => {
      button.disabled = week.closed;
    });

    $$("[data-week-toggle]").forEach(button => {
      const checked = Boolean(week.weekly[button.dataset.weekToggle]);
      button.classList.toggle("is-checked", checked);
      button.setAttribute("aria-pressed", String(checked));
    });
  }

  function renderScore() {
    const result = calculateScore();
    const stateInfo = scoreState(result.total);
    const card = $("#score-card");
    const ring = $("#score-ring");

    $("#score-value").textContent = result.total;
    $("#score-label").textContent = stateInfo.label;
    $("#score-message").textContent = stateInfo.message;
    $("#streak-value").textContent = state.weeksWithoutReset;

    card.className = `score-card state-${stateInfo.key}`;
    ring.style.setProperty("--score", result.total);
    ring.style.setProperty("--score-color", `var(--${stateInfo.key})`);

    const breakdown = [
      ["Medicación", `${result.medicationDays}/7 días`, result.parts.medication, 35],
      ["Ejercicio", `${result.exerciseDays}/7 días`, result.parts.exercise, 35],
      ["Charlas", `${result.commercial.talks} (referencia 7)`, Math.round(result.parts.talks), 10],
      ["Inscripciones", `${result.commercial.enrollments} (referencia 1)`, result.parts.enrollments, 5],
      ["Sesión Ayrton", state.currentWeek.weekly.ayrton ? "Sí" : "No", result.parts.ayrton, 5],
      ["Sesión Claribel", state.currentWeek.weekly.claribel ? "Sí" : "No", result.parts.claribel, 5],
      ["Gastos registrados", state.currentWeek.weekly.expenses ? "Sí" : "No", result.parts.expenses, 5]
    ];

    $("#score-breakdown").innerHTML = breakdown.map(([label, detail, points, max]) => `
      <div class="breakdown-row">
        <span>${escapeHtml(label)} · ${escapeHtml(detail)}</span>
        <strong>${points}/${max}</strong>
      </div>
    `).join("");

    $("#close-week").disabled = state.currentWeek.closed;
    $("#close-week").textContent = state.currentWeek.closed ? "Semana cerrada" : "Cerrar semana";
  }

  function renderHistory() {
    const history = [...state.history].sort((a, b) => b.startDate.localeCompare(a.startDate));
    $("#history-count").textContent = `${history.length} ${history.length === 1 ? "semana" : "semanas"}`;
    $("#history-list").innerHTML = history.map(item => {
      const color = scoreState(item.score).key;
      const saturation = item.predominantSaturation || "none";
      const commercial = item.commercial || {
        prospects: 0,
        calls: 0,
        appointments: 0,
        talks: item.talks || 0,
        enrollments: item.enrollments || 0
      };
      return `
        <article class="card history-card">
          <div>
            <p class="card-kicker">Semana del</p>
            <h3 class="history-date">${escapeHtml(formatDate(item.startDate, { day: "numeric", month: "long", year: "numeric" }))}</h3>
            <div class="history-stats">
              <span>👥 ${safeCount(commercial.prospects)} prospectos</span>
              <span>📞 ${safeCount(commercial.calls)} llamadas</span>
              <span>📅 ${safeCount(commercial.appointments)} citas</span>
              <span>🎤 ${safeCount(commercial.talks)} charlas</span>
              <span>✍️ ${safeCount(commercial.enrollments)} inscripciones</span>
              <span>Saturación: ${escapeHtml(SATURATION_LABELS[saturation] || SATURATION_LABELS.none)}</span>
            </div>
          </div>
          <div class="history-score ${color}" aria-label="Score ${item.score}">${item.score}</div>
        </article>
      `;
    }).join("");
  }

  function renderAll() {
    renderToday();
    renderWeek();
    renderScore();
    renderHistory();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function closeWeek() {
    if (state.currentWeek.closed) return;

    const score = calculateScore(state.currentWeek).total;
    const commercial = getCommercialTotals(state.currentWeek);
    const snapshot = {
      id: state.currentWeek.id,
      startDate: state.currentWeek.startDate,
      closedAt: new Date().toISOString(),
      score,
      talks: commercial.talks,
      enrollments: commercial.enrollments,
      commercial,
      ayrton: state.currentWeek.weekly.ayrton,
      claribel: state.currentWeek.weekly.claribel,
      expenses: state.currentWeek.weekly.expenses,
      church: state.currentWeek.weekly.church,
      predominantSaturation: predominantSaturation(state.currentWeek),
      daily: structuredCloneSafe(state.currentWeek.daily)
    };

    state.history = state.history.filter(item => item.id !== snapshot.id);
    state.history.push(snapshot);
    state.currentWeek.closed = true;
    state.weeksWithoutReset += 1;
    saveState();
    renderAll();
    showToast("Semana guardada en el historial.");
  }

  function newWeek() {
    if (!state.currentWeek.closed) {
      const proceed = window.confirm("La semana actual no está cerrada. ¿Crear una nueva sin guardarla en el historial?");
      if (!proceed) return;
    }

    state.currentWeek = defaultWeek(dateKey(new Date()));
    saveState();
    renderAll();
    activateTab("today");
    showToast("Nueva semana lista.");
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function activateTab(name) {
    $$(".tab").forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });

    $$(".view").forEach(view => {
      const active = view.dataset.view === name;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    });

    if (name === "week") renderWeek();
    if (name === "score") renderScore();
    if (name === "history") renderHistory();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindEvents() {
    $$(".tab").forEach(tab => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    });

    $$("#saturation-control button").forEach(button => {
      button.addEventListener("click", () => {
        getTodayEntry().saturation = button.dataset.value;
        saveState();
        renderToday();
      });
    });

    $$("[data-daily-counter]").forEach(counter => {
      counter.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        const field = counter.dataset.dailyCounter;
        const change = button.dataset.action === "increase" ? 1 : -1;
        const entry = getTodayEntry();
        entry.commercial[field] = safeCount(entry.commercial[field] + change);
        saveState();
        renderToday();
      });
    });

    ["medication", "exercise", "meals", "gratitude"].forEach(field => {
      $$(`#${field}-control button`).forEach(button => {
        button.addEventListener("click", () => {
          getTodayEntry()[field] = button.dataset.value === "true";
          saveState();
          renderToday();
        });
      });
    });

    $$("#sleep-control button").forEach(button => {
      button.addEventListener("click", () => {
        getTodayEntry().sleep = button.dataset.value;
        saveState();
        renderToday();
      });
    });

    $("#daily-note").addEventListener("input", event => {
      getTodayEntry().note = event.target.value;
      $("#note-count").textContent = `${event.target.value.length}/240`;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => saveState(), 250);
    });

    $("#finish-day").addEventListener("click", () => {
      const entry = getTodayEntry();
      const requiredComplete = isDailyEntryComplete(entry);

      if (!requiredComplete) {
        showToast("Completa los seis registros del día.");
        return;
      }

      entry.completedAt = new Date().toISOString();
      saveState();
      renderToday();
      showToast("Registro de hoy completo.");
    });

    $$("[data-week-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const field = button.dataset.weekToggle;
        state.currentWeek.weekly[field] = !state.currentWeek.weekly[field];
        saveState();
        renderWeek();
      });
    });

    $("#close-week").addEventListener("click", closeWeek);
    $("#new-week").addEventListener("click", newWeek);

    $("#reset-streak").addEventListener("click", () => {
      if (!window.confirm("¿Confirmas que reiniciaste? El historial no se borrará.")) return;
      state.weeksWithoutReset = 0;
      state.lastResetAt = new Date().toISOString();
      saveState();
      renderScore();
      showToast("Contador reiniciado. Tu historial sigue intacto.");
    });

    $("#export-data").addEventListener("click", () => {
      const content = JSON.stringify(state, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sistema-consistencia-${dateKey(new Date())}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Datos exportados.");
    });

    $("#delete-data").addEventListener("click", () => {
      const confirmed = window.confirm("Esto borrará todos tus registros de este dispositivo. ¿Continuar?");
      if (!confirmed) return;
      localStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      saveState(false);
      renderAll();
      activateTab("today");
      showToast("Todos los datos fueron borrados.");
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) renderAll();
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        // La app sigue funcionando sin conexión desde localStorage aunque falle el registro.
      });
    }
  }

  bindEvents();
  renderAll();
  registerServiceWorker();
})();
