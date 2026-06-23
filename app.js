const STATES = ["", "LIMPIAR", "OCUPADA", "LISTA", "LIMPIADA"];
const STORAGE_KEY = "housekeeping-v2";
const BLOCK_RESET_DELAY = 900;
const SESSION_TICK_MS = 1000;
const RECENT_SESSIONS_LIMIT = 8;

const DEFAULT_TASKS = [
  { id: "cama", label: "Cama", emoji: "🛏️", occupied: true },
  { id: "bano", label: "Baño", emoji: "🚿", occupied: false },
  { id: "toallas", label: "Toallas", emoji: "🧺", occupied: true },
  { id: "suministros", label: "Suministros", emoji: "🧴", occupied: true },
  { id: "cristales", label: "Cristales", emoji: "🪟", occupied: false },
  { id: "aspirar", label: "Aspirar", emoji: "🧹", occupied: false },
  { id: "fregar", label: "Fregar", emoji: "🪣", occupied: false }
];

const DEFAULT_DATA = {
  selectedHotelId: "steinbock",
  hotels: [
    {
      id: "steinbock",
      name: "Steinbock",
      tasks: clone(DEFAULT_TASKS),
      rooms: ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "201", "202", "203", "204", "205", "206"].map(number => ({
        id: uid("room"),
        number,
        state: "",
        checks: {},
        inProgressBlock: false,
        progressBaseState: null
      }))
    },
    {
      id: "baeren",
      name: "Bären",
      tasks: clone(DEFAULT_TASKS),
      rooms: []
    }
  ]
};

const STATE_PRIORITY = {
  LIMPIAR: 0,
  OCUPADA: 1,
  LISTA: 2,
  LIMPIADA: 3,
  "": 4
};

let data = null;
let dbRef = null;
let firebaseReady = false;
let firebaseSaving = false;
const pendingBlockResets = new Map();
let sessionTickerId = null;
let roomEditContext = null;
let roomEditTags = [];
let currentView = "rooms";
let quickModeOpen = false;
let quickModeHotelId = null;
let quickModeSelection = new Set();
let quickModeTargetState = "LIMPIAR";
const statsSectionState = {
  busiest: false,
  byRoom: false,
  byGroup: false,
  roomActivity: false,
  recentSessions: false,
  recentStatus: false,
  timeHeavy: false
};

const $hotelTitle = document.querySelector("#hotelTitle");
const $globalPercent = document.querySelector("#globalPercent");
const $globalBar = document.querySelector("#globalBar");
const $progressHint = document.querySelector("#progressHint");
const $todoCount = document.querySelector("#todoCount");
const $occupiedCount = document.querySelector("#occupiedCount");
const $cleanCount = document.querySelector("#cleanCount");
const $roomsView = document.querySelector("#roomsView");
const $statsView = document.querySelector("#statsView");
const $hotelTabs = document.querySelector("#hotelTabs");
const $quickModePanel = document.querySelector("#quickModePanel");
const $rooms = document.querySelector("#rooms");
const $statusMessage = document.querySelector("#statusMessage");
const $templatePanel = document.querySelector("#templatePanel");
const $templateModal = document.querySelector("#templateModal");
const $statsContent = document.querySelector("#statsContent");
const $roomEditModal = document.querySelector("#roomEditModal");
const $hotelModal = document.querySelector("#hotelModal");
const $taskEditorList = document.querySelector("#taskEditorList");
const $addTaskForm = document.querySelector("#addTaskForm");
const $taskEmojiInput = document.querySelector("#taskEmojiInput");
const $taskLabelInput = document.querySelector("#taskLabelInput");
const $taskOccupiedInput = document.querySelector("#taskOccupiedInput");
const $roomEditForm = document.querySelector("#roomEditForm");
const $roomEditHotelIdInput = document.querySelector("#roomEditHotelIdInput");
const $roomEditIdInput = document.querySelector("#roomEditIdInput");
const $roomEditNumberInput = document.querySelector("#roomEditNumberInput");
const $roomEditGroupInput = document.querySelector("#roomEditGroupInput");
const $roomTagInput = document.querySelector("#roomTagInput");
const $addRoomTagButton = document.querySelector("#addRoomTagButton");
const $roomTagEditorList = document.querySelector("#roomTagEditorList");
const $roomEditTitle = document.querySelector("#roomEditTitle");
const $saveRoomEditButton = document.querySelector("#saveRoomEditButton");
const $hotelForm = document.querySelector("#hotelForm");
const $hotelNameInput = document.querySelector("#hotelNameInput");
const $hotelCopyTemplateInput = document.querySelector("#hotelCopyTemplateInput");

const $addHotelButton = document.querySelector("#addHotelButton");
const $deleteHotelButton = document.querySelector("#deleteHotelButton");
const $addRoomButton = document.querySelector("#addRoomButton");
const $quickModeButton = document.querySelector("#quickModeButton");
const $templateButton = document.querySelector("#templateButton");
const $statsButton = document.querySelector("#statsButton");
const $backToRoomsButton = document.querySelector("#backToRoomsButton");
const $closeTemplateButton = document.querySelector("#closeTemplateButton");
const $closeHotelModalButton = document.querySelector("#closeHotelModalButton");
const $closeRoomEditModalButton = document.querySelector("#closeRoomEditModalButton");
const $cancelHotelModalButton = document.querySelector("#cancelHotelModalButton");
const $cancelRoomEditButton = document.querySelector("#cancelRoomEditButton");
const $resetButton = document.querySelector("#resetButton");
const $syncButton = document.querySelector("#syncButton");

init();

function init() {
  data = loadLocalData();
  ensureDataShape();
  setupFirebase();
  bindGlobalEvents();
  render();
}

function bindGlobalEvents() {
  $addHotelButton.addEventListener("click", addHotel);
  $deleteHotelButton.addEventListener("click", deleteCurrentHotel);
  $addRoomButton.addEventListener("click", addRoom);
  $quickModeButton.addEventListener("click", handleQuickModeButton);
  $templateButton.addEventListener("click", openTemplateModal);
  $statsButton.addEventListener("click", openStatsView);
  $backToRoomsButton.addEventListener("click", openRoomsView);
  $closeTemplateButton.addEventListener("click", closeTemplateModal);
  $closeHotelModalButton.addEventListener("click", closeHotelModal);
  $closeRoomEditModalButton.addEventListener("click", closeRoomEditModal);
  $cancelHotelModalButton.addEventListener("click", closeHotelModal);
  $cancelRoomEditButton.addEventListener("click", closeRoomEditModal);
  [$templateModal, $roomEditModal, $hotelModal].forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target !== modal) return;
      if (modal === $templateModal) closeTemplateModal();
      if (modal === $roomEditModal) closeRoomEditModal();
      if (modal === $hotelModal) closeHotelModal();
    });
  });
  $resetButton.addEventListener("click", resetLocalData);
  $syncButton.addEventListener("click", syncNow);
  $addTaskForm.addEventListener("submit", addTask);
  $roomEditForm.addEventListener("submit", submitRoomEdit);
  $roomEditForm.addEventListener("click", handleRoomEditFormClick);
  $hotelForm.addEventListener("submit", submitHotelForm);
  $addRoomTagButton.addEventListener("click", addRoomTagFromInput);
  $roomTagInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addRoomTagFromInput();
  });
}

function setupFirebase() {
  const config = window.FIREBASE_CONFIG || {};
  const hasFirebaseConfig = Boolean(config.apiKey && config.databaseURL && config.projectId);

  if (!hasFirebaseConfig || !window.firebase) {
    setStatus("Modo local. Firebase pendiente.");
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    dbRef = firebase.database().ref(window.FIREBASE_DB_PATH || "housekeeping/app");
    firebaseReady = true;

    dbRef.on("value", snapshot => {
      if (firebaseSaving) return;
      const remoteData = snapshot.val();
      if (!remoteData) return;

      data = normalizeData(remoteData);
      saveLocalData();
      render();
      setStatus("Sincronizado con Firebase.");
    });

    setStatus("Firebase conectado.");
  } catch (error) {
    console.error(error);
    setStatus("Firebase no conectado. Sigo en local.");
  }
}

function loadLocalData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.hotels)) return normalizeData(saved);
  } catch (error) {
    console.warn(error);
  }

  return normalizeData(clone(DEFAULT_DATA));
}

function normalizeData(input) {
  const fallback = clone(DEFAULT_DATA);
  const hotels = Array.isArray(input.hotels) && input.hotels.length ? input.hotels : fallback.hotels;

  const normalizedHotels = hotels.map(hotel => {
    const tasks = normalizeTasks(hotel.tasks);
    const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];

    const normalizedHotel = {
      id: String(hotel.id || uid("hotel")),
      name: String(hotel.name || "Hotel"),
      tasks,
      rooms: []
    };

    normalizedHotel.rooms = rooms.map(room => {
      const normalizedRoom = ensureRoomChecks(normalizedHotel, {
        id: String(room.id || uid("room")),
        number: String(room.number || ""),
        group: normalizeRoomGroup(room.group),
        tags: normalizeRoomTags(room.tags),
        state: normalizeState(room.state),
        checks: room.checks || room.tasks || {},
        inProgressBlock: inferInProgressBlock(room),
        progressBaseState: normalizeProgressBaseState(room.progressBaseState, room.state)
      });

      return syncRoomState(normalizedHotel, normalizedRoom);
    });

    return normalizedHotel;
  });

  const selectedHotelId = normalizedHotels.some(hotel => hotel.id === input.selectedHotelId)
    ? input.selectedHotelId
    : normalizedHotels[0].id;

  // Export-ready structures for a future Google Sheets sync via Apps Script.
  const timeLogs = Array.isArray(input.timeLogs)
    ? consolidateTimeLogs(input.timeLogs.map(normalizeTimeLog).filter(Boolean))
    : [];
  const statusLogs = Array.isArray(input.statusLogs) ? input.statusLogs.map(normalizeStatusLog).filter(Boolean) : [];

  const normalizedData = {
    selectedHotelId,
    hotels: normalizedHotels,
    timeLogs,
    statusLogs,
    activeSession: normalizeActiveSession(input.activeSession, normalizedHotels)
  };

  return normalizedData;
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) return clone(DEFAULT_TASKS);

  return tasks.map(task => ({
    id: String(task.id || slugify(task.label) || uid("task")),
    label: String(task.label || "Tarea"),
    emoji: String(task.emoji || "✅"),
    occupied: Boolean(task.occupied)
  }));
}

function normalizeState(state) {
  if (state === "PENDIENTE") return "LISTA";
  return STATES.includes(state) ? state : "";
}

function getStateLabel(state) {
  return state || "SIN ESTADO";
}

function normalizePauseIntervals(intervals) {
  if (!Array.isArray(intervals)) return [];

  return intervals
    .map(interval => {
      if (!interval || !interval.pausedAt) return null;

      return {
        pausedAt: Number(interval.pausedAt),
        resumedAt: interval.resumedAt ? Number(interval.resumedAt) : null
      };
    })
    .filter(Boolean);
}

function normalizeSessionDateKey(date, timestamp) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (timestamp) return formatSessionDateKey(timestamp);
  return "";
}

function normalizeRoomGroup(group) {
  return String(group || "").trim();
}

function normalizeRoomTags(tags) {
  const source = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const seen = new Set();

  return source.reduce((list, tag) => {
    const value = String(tag || "").trim().replace(/\s+/g, " ");
    if (!value) return list;

    const key = value.toLocaleLowerCase("es-ES");
    if (seen.has(key)) return list;

    seen.add(key);
    list.push(value);
    return list;
  }, []);
}

function normalizeProgressBaseState(progressBaseState, state) {
  if (progressBaseState === "PENDIENTE") return "LIMPIAR";
  if (progressBaseState === "LIMPIAR" || progressBaseState === "OCUPADA") return progressBaseState;
  if (state === "OCUPADA") return "OCUPADA";
  if (state === "LIMPIAR" || state === "LISTA") return "LIMPIAR";
  return null;
}

function inferInProgressBlock(room) {
  if (typeof room.inProgressBlock === "boolean") return room.inProgressBlock;
  return room.state === "LIMPIAR" || room.state === "OCUPADA" || room.state === "LISTA";
}

function normalizeTimeLog(log) {
  if (!log) return null;

  const startedAt = Number(log.startedAt || 0);
  const endedAt = Number(log.endedAt || 0);
  const totalActiveMs = Math.max(0, Number(
    log.totalActiveMs !== undefined
      ? log.totalActiveMs
      : Number(log.durationSeconds || 0) * 1000
  ));
  const durationSeconds = Math.max(0, Math.round(totalActiveMs / 1000));
  const date = normalizeSessionDateKey(log.date, startedAt);

  return {
    id: String(log.id || uid("timelog")),
    hotelId: String(log.hotelId || ""),
    hotelName: String(log.hotelName || ""),
    roomId: String(log.roomId || ""),
    roomNumber: String(log.roomNumber || ""),
    roomGroup: String(log.roomGroup || ""),
    workType: log.workType === "refresh" ? "refresh" : "cleaning",
    statusAtStart: normalizeState(log.statusAtStart),
    date,
    startTime: String(log.startTime || formatTimeLabel(startedAt || endedAt || Date.now())),
    endTime: String(log.endTime || formatTimeLabel(endedAt || startedAt || Date.now())),
    startedAt,
    pausedAt: log.pausedAt ? Number(log.pausedAt) : null,
    resumedAt: log.resumedAt ? Number(log.resumedAt) : null,
    endedAt,
    totalActiveMs,
    isPaused: Boolean(log.isPaused),
    pauseIntervals: normalizePauseIntervals(log.pauseIntervals),
    durationSeconds,
    durationReadable: String(log.durationReadable || formatDuration(durationSeconds))
  };
}

function normalizeStatusLog(log) {
  if (!log) return null;

  return {
    id: String(log.id || uid("statuslog")),
    hotelId: String(log.hotelId || ""),
    hotelName: String(log.hotelName || ""),
    roomId: String(log.roomId || ""),
    roomNumber: String(log.roomNumber || ""),
    fromStatus: normalizeState(log.fromStatus),
    toStatus: normalizeState(log.toStatus),
    date: String(log.date || ""),
    timestamp: Number(log.timestamp || 0)
  };
}

function normalizeActiveSession(session, hotels) {
  if (!session || !session.hotelId || !session.roomId || !session.startedAt) return null;

  const hotel = hotels.find(item => item.id === String(session.hotelId));
  if (!hotel) return null;

  const room = hotel.rooms.find(item => item.id === String(session.roomId));
  if (!room) return null;

  return {
    id: String(session.id || uid("session")),
    hotelId: hotel.id,
    hotelName: String(session.hotelName || hotel.name),
    roomId: room.id,
    roomNumber: String(session.roomNumber || room.number),
    roomGroup: String(session.roomGroup || getRoomGroup(room)),
    statusAtStart: normalizeState(session.statusAtStart),
    workType: session.workType === "refresh" ? "refresh" : "cleaning",
    date: normalizeSessionDateKey(session.date, Number(session.startedAt)),
    startedAt: Number(session.startedAt),
    pausedAt: session.pausedAt ? Number(session.pausedAt) : null,
    resumedAt: session.resumedAt ? Number(session.resumedAt) : null,
    endedAt: session.endedAt ? Number(session.endedAt) : null,
    totalActiveMs: Math.max(0, Number(session.totalActiveMs || 0)),
    isPaused: Boolean(session.isPaused),
    pauseIntervals: normalizePauseIntervals(session.pauseIntervals),
    startedDate: String(session.startedDate || formatDateKey(Number(session.startedAt))),
    startedTimeLabel: String(session.startedTimeLabel || formatTimeLabel(Number(session.startedAt)))
  };
}

function buildDailyTimeLogKey(log) {
  return `${log.hotelId}:${log.roomId}:${log.date || normalizeSessionDateKey("", log.startedAt)}`;
}

function mergeTimeLogs(existingLog, incomingLog) {
  const base = { ...existingLog };
  const startA = base.startedAt || Number.MAX_SAFE_INTEGER;
  const startB = incomingLog.startedAt || Number.MAX_SAFE_INTEGER;

  base.startedAt = Math.min(startA, startB);
  if (base.startedAt === Number.MAX_SAFE_INTEGER) base.startedAt = 0;
  base.endedAt = Math.max(base.endedAt || 0, incomingLog.endedAt || 0);
  base.totalActiveMs = Math.max(0, Number(base.totalActiveMs || 0) + Number(incomingLog.totalActiveMs || 0));
  base.durationSeconds = Math.round(base.totalActiveMs / 1000);
  base.durationReadable = formatDuration(base.durationSeconds);
  base.date = base.date || incomingLog.date || normalizeSessionDateKey("", base.startedAt);
  base.startTime = formatTimeLabel(base.startedAt || Date.now());
  base.endTime = formatTimeLabel(base.endedAt || base.startedAt || Date.now());
  base.hotelName = incomingLog.hotelName || base.hotelName;
  base.roomNumber = incomingLog.roomNumber || base.roomNumber;
  base.roomGroup = incomingLog.roomGroup || base.roomGroup;
  base.statusAtStart = base.statusAtStart || incomingLog.statusAtStart;
  base.workType = base.workType || incomingLog.workType;
  base.pausedAt = incomingLog.pausedAt || base.pausedAt || null;
  base.resumedAt = incomingLog.resumedAt || base.resumedAt || null;
  base.pauseIntervals = [...normalizePauseIntervals(base.pauseIntervals), ...normalizePauseIntervals(incomingLog.pauseIntervals)];
  base.isPaused = false;
  return base;
}

function consolidateTimeLogs(logs) {
  const merged = new Map();

  logs.forEach(log => {
    const normalizedLog = normalizeTimeLog(log);
    if (!normalizedLog) return;

    const key = buildDailyTimeLogKey(normalizedLog);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...normalizedLog,
        date: normalizedLog.date || normalizeSessionDateKey("", normalizedLog.startedAt)
      });
      return;
    }

    merged.set(key, mergeTimeLogs(existing, normalizedLog));
  });

  return [...merged.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function getSessionRunningSince(session) {
  return session.resumedAt || session.startedAt;
}

function getSessionActiveMs(session, now = Date.now()) {
  if (!session) return 0;

  const totalActiveMs = Math.max(0, Number(session.totalActiveMs || 0));
  if (session.isPaused) return totalActiveMs;

  const runningSince = getSessionRunningSince(session);
  if (!runningSince) return totalActiveMs;

  return totalActiveMs + Math.max(0, now - runningSince);
}

function findDailyTimeLog(hotelId, roomId, date) {
  return data.timeLogs.find(log => log.hotelId === hotelId && log.roomId === roomId && log.date === date);
}

function getTodayRoomSummary(hotel, room) {
  const today = formatSessionDateKey(Date.now());
  const persistedLog = findDailyTimeLog(hotel.id, room.id, today);
  const activeSession = isRoomSessionActive(room) ? data.activeSession : null;

  let totalActiveMs = persistedLog ? Number(persistedLog.totalActiveMs || 0) : 0;
  let status = persistedLog ? "finalizada" : "sin_sesion";

  if (activeSession) {
    totalActiveMs += getSessionActiveMs(activeSession);
    status = activeSession.isPaused ? "pausada" : "activa";
  }

  return {
    totalActiveMs,
    totalActiveSeconds: Math.round(totalActiveMs / 1000),
    status,
    statusLabel:
      status === "activa"
        ? "Activa"
        : status === "pausada"
          ? "Pausada"
          : status === "finalizada"
            ? "Finalizada"
            : "Sin sesión"
  };
}

function ensureDataShape() {
  data = normalizeData(data || DEFAULT_DATA);
  saveLocalData();
}

function getCurrentHotel() {
  let hotel = data.hotels.find(item => item.id === data.selectedHotelId);
  if (!hotel) {
    hotel = data.hotels[0];
    data.selectedHotelId = hotel.id;
  }
  return hotel;
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function saveAll(message = "Guardado.") {
  saveLocalData();

  if (!firebaseReady || !dbRef) {
    setStatus(message);
    return;
  }

  try {
    firebaseSaving = true;
    await dbRef.set(data);
    setStatus(message);
  } catch (error) {
    console.error(error);
    setStatus("No se pudo guardar en Firebase. Guardado local.");
  } finally {
    firebaseSaving = false;
  }
}

function openRoomsView() {
  currentView = "rooms";
  render();
}

function openStatsView() {
  currentView = "stats";
  render();
}

function openTemplateModal() {
  $templateModal.classList.remove("hidden");
  $templateModal.setAttribute("aria-hidden", "false");
}

function closeTemplateModal() {
  $templateModal.classList.add("hidden");
  $templateModal.setAttribute("aria-hidden", "true");
}

function openHotelModal() {
  $hotelForm.reset();
  $hotelCopyTemplateInput.checked = true;
  $hotelModal.classList.remove("hidden");
  $hotelModal.setAttribute("aria-hidden", "false");
  setTimeout(() => $hotelNameInput.focus(), 0);
}

function closeHotelModal() {
  $hotelForm.reset();
  $hotelModal.classList.add("hidden");
  $hotelModal.setAttribute("aria-hidden", "true");
}

function render() {
  const hotel = getCurrentHotel();
  $hotelTitle.textContent = hotel.name;
  $roomsView.classList.toggle("hidden", currentView !== "rooms");
  $statsView.classList.toggle("hidden", currentView !== "stats");
  renderHotelTabs();
  renderSummary(hotel);
  renderQuickModePanel(hotel);
  renderTemplatePanel(hotel);
  renderStatsPanel();
  renderRooms(hotel);
  syncSessionTicker();
}

function renderHotelTabs() {
  $hotelTabs.innerHTML = data.hotels.map(hotel => {
    const active = hotel.id === data.selectedHotelId ? "active" : "";
    return `<button class="hotel-tab ${active}" type="button" data-hotel-id="${escapeHtml(hotel.id)}">${escapeHtml(hotel.name)}</button>`;
  }).join("");

  document.querySelectorAll(".hotel-tab").forEach(button => {
    button.addEventListener("click", async event => {
      data.selectedHotelId = event.currentTarget.dataset.hotelId;
      await saveAll("Hotel cambiado.");
      render();
    });
  });
}

function renderSummary(hotel) {
  const summary = calculateGlobalProgress(hotel);

  $globalPercent.textContent = formatPercent(summary.progress);
  $globalBar.style.width = `${Math.round(summary.progress * 100)}%`;
  $todoCount.textContent = hotel.rooms.filter(room => room.state === "LIMPIAR").length;
  $occupiedCount.textContent = hotel.rooms.filter(room => room.state === "OCUPADA").length;
  $cleanCount.textContent = hotel.rooms.filter(room => room.state === "LIMPIADA").length;

  if (summary.total > 0 && summary.shouldReset) {
    $progressHint.textContent = `${summary.marked}/${summary.total} tareas del bloque completadas. Cerrando bloque activo...`;
  } else if (summary.total > 0) {
    $progressHint.textContent = `${summary.marked}/${summary.total} tareas del bloque activo. Las habitaciones LISTA siguen contando hasta cerrar el bloque.`;
  } else if (hotel.rooms.some(room => room.state === "LISTA" || room.state === "LIMPIADA")) {
    $progressHint.textContent = "No hay tareas activas pendientes. Marca nuevas habitaciones o desmarca una tarea para abrir otro bloque.";
  } else {
    $progressHint.textContent = "Marca habitaciones como LIMPIAR u OCUPADA para crear progreso activo.";
  }

  scheduleBlockResetIfNeeded(hotel, summary);
}

function renderTemplatePanel(hotel) {
  $taskEditorList.innerHTML = hotel.tasks.map(task => `
    <div class="task-editor-row" data-task-id="${escapeHtml(task.id)}">
      <div class="task-editor-name">
        ${escapeHtml(task.emoji)} ${escapeHtml(task.label)}
        <small>${task.occupied ? "Cuenta en OCUPADA" : "Solo limpieza completa"}</small>
      </div>
      <label class="occupied-toggle">
        <input class="task-occupied-check" type="checkbox" ${task.occupied ? "checked" : ""}>
        <span>OCUPADA</span>
      </label>
      <div class="row-actions">
        <button class="tiny-btn edit-task-btn" type="button" aria-label="Editar tarea">✎</button>
        <button class="tiny-btn delete-task-btn" type="button" aria-label="Eliminar tarea">×</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".task-occupied-check").forEach(input => {
    input.addEventListener("change", async event => {
      const taskId = event.currentTarget.closest(".task-editor-row").dataset.taskId;
      const task = hotel.tasks.find(item => item.id === taskId);
      if (!task) return;

      task.occupied = event.currentTarget.checked;
      hotel.rooms = hotel.rooms.map(room => syncRoomState(hotel, room));
      await saveAll("Plantilla actualizada.");
      render();
    });
  });

  document.querySelectorAll(".edit-task-btn").forEach(button => {
    button.addEventListener("click", async event => {
      const taskId = event.currentTarget.closest(".task-editor-row").dataset.taskId;
      await editTask(taskId);
    });
  });

  document.querySelectorAll(".delete-task-btn").forEach(button => {
    button.addEventListener("click", async event => {
      const taskId = event.currentTarget.closest(".task-editor-row").dataset.taskId;
      await deleteTask(taskId);
    });
  });
}

function renderStatsPanel() {
  const stats = calculateStats();
  const topBusyRoom = stats.mostBusyRooms[0];

  $statsContent.innerHTML = `
    <div class="stats-grid">
      <article class="stats-card stats-hero">
        <p class="label">KPIs</p>
        <div class="stats-kpi-grid">
          <div class="stats-kpi">
            <strong>${formatDuration(stats.overview.cleaningAverageSeconds)}</strong>
            <span>Media limpieza</span>
          </div>
          <div class="stats-kpi">
            <strong>${formatDuration(stats.overview.refreshAverageSeconds)}</strong>
            <span>Media repaso</span>
          </div>
          <div class="stats-kpi">
            <strong>${stats.overview.totalSessions}</strong>
            <span>Sesiones</span>
          </div>
          <div class="stats-kpi">
            <strong>${topBusyRoom ? escapeHtml(topBusyRoom.roomLabel) : "—"}</strong>
            <span>Más concurrida</span>
          </div>
        </div>
      </article>

      <article class="stats-card stats-manage-card">
        <div class="stats-manage-head">
          <div>
            <p class="label">Gestión</p>
            <strong>Registros</strong>
          </div>
        </div>
        <div class="stats-actions compact">
          <button class="soft-btn stats-action-btn" type="button" data-clear-log-type="time">Borrar sesiones</button>
          <button class="soft-btn stats-action-btn" type="button" data-clear-log-type="status">Borrar cambios</button>
          <button class="soft-danger-btn stats-action-btn" type="button" data-clear-log-type="all">Borrar todo</button>
        </div>
      </article>
    </div>

    ${renderStatsCompactSection({
      key: "busiest",
      title: "Habitaciones más concurridas",
      items: stats.mostBusyRooms,
      collapsedByDefault: false,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.roomLabel)}</strong>
            <small>${item.refreshCount} repasos ocupada</small>
          </div>
          <span>${item.cleaningCount} veces</span>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "byRoom",
      title: "Media por habitación",
      items: stats.byRoom,
      collapsedByDefault: false,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.roomLabel)}</strong>
            <small>${escapeHtml(item.groupLabel)}</small>
          </div>
          <span class="${item.averageSeconds > stats.overview.cleaningAverageSeconds ? "slow" : "fast"}">${formatDuration(item.averageSeconds)}</span>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "byGroup",
      title: "Media por grupo",
      items: stats.byGroup,
      collapsedByDefault: false,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.groupLabel)}</strong>
            <small>${item.sessionCount} sesiones</small>
          </div>
          <span>${formatDuration(item.averageSeconds)}</span>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "timeHeavy",
      title: "Habitaciones que más tiempo consumen",
      items: stats.timeHeavyRooms,
      collapsedByDefault: true,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.roomLabel)}</strong>
            <small>${item.sessionCount} sesiones</small>
          </div>
          <span>${formatDuration(item.totalSeconds)}</span>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "roomActivity",
      title: "Actividad por habitación",
      items: stats.roomActivity,
      collapsedByDefault: true,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.roomLabel)}</strong>
            <small>${escapeHtml(item.groupLabel)}</small>
          </div>
          <span>${item.cleaningCount} L · ${item.refreshCount} O</span>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "recentSessions",
      title: "Sesiones recientes",
      items: stats.recentSessions,
      collapsedByDefault: true,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.dateLabel)}</strong>
            <small>${escapeHtml(item.roomLabel)} · ${escapeHtml(item.workTypeLabel)}</small>
          </div>
          <div class="stats-row-actions">
            <span>${escapeHtml(item.durationReadable)}</span>
            <button class="tiny-btn stats-delete-btn" type="button" data-delete-time-log-id="${escapeHtml(item.id)}" aria-label="Borrar sesión">×</button>
          </div>
        </div>
      `
    })}

    ${renderStatsCompactSection({
      key: "recentStatus",
      title: "Cambios de estado recientes",
      items: stats.recentStatusLogs,
      collapsedByDefault: true,
      renderItem: item => `
        <div class="stats-list-row compact">
          <div>
            <strong>${escapeHtml(item.dateLabel)}</strong>
            <small>${escapeHtml(item.roomLabel)} · ${escapeHtml(item.transitionLabel)}</small>
          </div>
          <div class="stats-row-actions">
            <span>${escapeHtml(item.toStatus || "SIN ESTADO")}</span>
            <button class="tiny-btn stats-delete-btn" type="button" data-delete-status-log-id="${escapeHtml(item.id)}" aria-label="Borrar cambio de estado">×</button>
          </div>
        </div>
      `
    })}
  `;

  bindStatsEvents();
}

function renderStatsCompactSection({ key, title, items, renderItem, collapsedByDefault }) {
  const hasMore = items.length > 3;
  const visibleItems = hasMore && !statsSectionState[key] ? items.slice(0, 3) : items;
  const toggleLabel = statsSectionState[key] ? "Ver menos" : "Ver más";

  const content = visibleItems.length
    ? visibleItems.map(renderItem).join("")
    : `<p class="stats-empty">Todavía no hay datos suficientes.</p>`;

  return `
    <section class="stats-section ${collapsedByDefault ? "collapsed" : ""}" data-stats-section="${escapeHtml(key)}">
      <button class="stats-section-toggle" type="button" data-toggle-stats-section="${escapeHtml(key)}" aria-expanded="${collapsedByDefault ? "false" : "true"}">
        <span>${escapeHtml(title)}</span>
        <span>${collapsedByDefault ? "Abrir" : "Ocultar"}</span>
      </button>
      <div class="stats-section-body ${collapsedByDefault ? "hidden" : ""}" data-stats-body="${escapeHtml(key)}">
        <div class="stats-list">${content}</div>
        ${hasMore ? `<button class="stats-more-btn" type="button" data-expand-stats-list="${escapeHtml(key)}">${toggleLabel}</button>` : ""}
      </div>
    </section>
  `;
}

function bindStatsEvents() {
  document.querySelectorAll("[data-toggle-stats-section]").forEach(button => {
    button.addEventListener("click", event => {
      const key = event.currentTarget.dataset.toggleStatsSection;
      const body = document.querySelector(`[data-stats-body="${key}"]`);
      if (!body) return;
      body.classList.toggle("hidden");
      event.currentTarget.setAttribute("aria-expanded", body.classList.contains("hidden") ? "false" : "true");
      event.currentTarget.lastElementChild.textContent = body.classList.contains("hidden") ? "Abrir" : "Ocultar";
    });
  });

  document.querySelectorAll("[data-expand-stats-list]").forEach(button => {
    button.addEventListener("click", event => {
      const key = event.currentTarget.dataset.expandStatsList;
      statsSectionState[key] = !statsSectionState[key];
      renderStatsPanel();
    });
  });

  document.querySelectorAll("[data-delete-time-log-id]").forEach(button => {
    button.addEventListener("click", async event => {
      const logId = event.currentTarget.dataset.deleteTimeLogId;
      await deleteTimeLog(logId);
    });
  });

  document.querySelectorAll("[data-delete-status-log-id]").forEach(button => {
    button.addEventListener("click", async event => {
      const logId = event.currentTarget.dataset.deleteStatusLogId;
      await deleteStatusLog(logId);
    });
  });

  document.querySelectorAll("[data-clear-log-type]").forEach(button => {
    button.addEventListener("click", async event => {
      const logType = event.currentTarget.dataset.clearLogType;
      await clearLogType(logType);
    });
  });
}

function renderQuickModePanel(hotel) {
  if (quickModeHotelId && quickModeHotelId !== hotel.id) {
    closeQuickMode();
  }

  const isVisible = currentView === "rooms" && quickModeOpen;
  if (isVisible) syncQuickModeSelection(hotel);
  $quickModeButton.classList.toggle("active", isVisible);
  $quickModeButton.textContent = "Modo rápido";

  if (!isVisible) {
    $quickModePanel.classList.add("hidden");
    $quickModePanel.innerHTML = "";
    return;
  }

  const sortedRooms = [...hotel.rooms].sort(compareRooms);
  const selectedLabel = quickModeSelection.size === 1
    ? "1 habitación seleccionada"
    : `${quickModeSelection.size} habitaciones seleccionadas`;

  $quickModePanel.classList.remove("hidden");
  $quickModePanel.innerHTML = `
    <div class="quick-mode-head">
      <div>
        <p class="label">Modo rápido</p>
        <h2>${escapeHtml(getStateLabel(quickModeTargetState))}</h2>
      </div>
      <span class="quick-mode-count">${selectedLabel}</span>
    </div>
    <div class="quick-mode-toolbar">
      <label class="quick-mode-state-field">
        <span>Estado a aplicar</span>
        <select id="quickModeStateSelect" class="state-select quick-mode-state-select" aria-label="Estado para marcar habitaciones">
          ${STATES.map(state => `<option value="${state}" ${quickModeTargetState === state ? "selected" : ""}>${escapeHtml(getStateLabel(state))}</option>`).join("")}
        </select>
      </label>
      <p class="quick-mode-hint">Elige un estado, toca las habitaciones y pulsa marcar. Se usa la misma lógica que el selector normal.</p>
    </div>
    <div class="quick-mode-grid" role="list">
      ${sortedRooms.map(room => {
        const selected = quickModeSelection.has(room.id);
        return `
          <label class="quick-mode-room ${selected ? "selected" : ""}" role="listitem">
            <input class="quick-mode-room-input" type="checkbox" data-quick-mode-room-id="${escapeHtml(room.id)}" ${selected ? "checked" : ""} aria-label="Seleccionar habitación ${escapeHtml(room.number)}">
            <span class="quick-mode-room-number">${escapeHtml(room.number)}</span>
          </label>
        `;
      }).join("")}
    </div>
    <div class="quick-mode-actions">
      <button class="soft-btn" type="button" data-quick-mode-cancel>Cancelar</button>
      <button class="primary-btn" type="button" data-quick-mode-apply ${quickModeSelection.size ? "" : "disabled"}>Marcar</button>
    </div>
  `;

  bindQuickModeEvents(hotel);
}

function bindQuickModeEvents(hotel) {
  document.querySelectorAll("[data-quick-mode-room-id]").forEach(input => {
    input.addEventListener("change", event => {
      const roomId = event.currentTarget.dataset.quickModeRoomId;
      if (!roomId) return;

      if (event.currentTarget.checked) quickModeSelection.add(roomId);
      else quickModeSelection.delete(roomId);

      renderQuickModePanel(hotel);
    });
  });

  const stateSelect = document.querySelector("#quickModeStateSelect");
  if (stateSelect) {
    stateSelect.addEventListener("change", event => {
      quickModeTargetState = normalizeState(event.currentTarget.value);
      renderQuickModePanel(hotel);
    });
  }

  document.querySelectorAll("[data-quick-mode-cancel]").forEach(button => {
    button.addEventListener("click", () => {
      closeQuickMode();
      render();
    });
  });

  document.querySelectorAll("[data-quick-mode-apply]").forEach(button => {
    button.addEventListener("click", async () => {
      await applyQuickModeSelection(hotel);
    });
  });
}

function renderRooms(hotel) {
  const sortedRooms = [...hotel.rooms].sort((a, b) => compareRoomsForHotel(hotel, a, b));

  if (!sortedRooms.length) {
    $rooms.innerHTML = `
      <section class="summary-card empty-state">
        No hay habitaciones todavía. Pulsa <b>+ Habitación</b> y empezamos.
      </section>
    `;
    return;
  }

  $rooms.innerHTML = sortedRooms.map(room => roomTemplate(hotel, room)).join("");
  bindRoomEvents(hotel);
}

function compareRoomsForHotel(hotel, a, b) {
  const activeRoomId =
    data.activeSession && data.activeSession.hotelId === hotel.id
      ? data.activeSession.roomId
      : null;

  const aIsActiveSessionRoom = activeRoomId === a.id;
  const bIsActiveSessionRoom = activeRoomId === b.id;

  if (aIsActiveSessionRoom !== bIsActiveSessionRoom) {
    return aIsActiveSessionRoom ? -1 : 1;
  }

  return compareRooms(a, b);
}

function roomTemplate(hotel, room) {
  const progress = calculateRoomProgress(hotel, room);
  const activeTaskIds = getVisualTaskIds(hotel, room);
  const activeSession = isRoomSessionActive(room) ? data.activeSession : null;
  const sessionSummary = getTodayRoomSummary(hotel, room);
  const roomGroup = getRoomGroup(room);
  const tags = normalizeRoomTags(room.tags);
  const sessionText = activeSession
    ? `${sessionSummary.statusLabel} · ${formatDuration(sessionSummary.totalActiveSeconds)}`
    : sessionSummary.statusLabel;

  const stateOptions = STATES.map(state => {
    const selected = room.state === state ? "selected" : "";
    return `<option value="${state}" ${selected}>${getStateLabel(state)}</option>`;
  }).join("");

  const tasks = hotel.tasks.map(task => {
    const checked = room.checks[task.id] ? "checked" : "";
    const inactive = activeTaskIds.length && !activeTaskIds.includes(task.id) ? "inactive" : "";

    return `
      <label class="task ${inactive}">
        <input data-room-id="${escapeHtml(room.id)}" data-task-id="${escapeHtml(task.id)}" type="checkbox" ${checked}>
        <span class="task-surface">
          <span class="task-copy">
            <span class="emoji-box" aria-hidden="true">
              <span class="emoji">${escapeHtml(task.emoji)}</span>
            </span>
            <span class="task-label">${escapeHtml(task.label)}</span>
          </span>
        </span>
      </label>
    `;
  }).join("");

  return `
    <article class="room-card" data-state="${escapeHtml(room.state)}" data-room-id="${escapeHtml(room.id)}" ${activeSession ? 'data-session-active="true"' : ""}>
      <div class="room-head">
        <button class="room-number" type="button" data-room-session-btn="${escapeHtml(room.id)}" aria-pressed="${activeSession ? "true" : "false"}" aria-label="${activeSession ? "Detener sesión" : "Iniciar sesión"} para habitación ${escapeHtml(room.number)}">
          ${escapeHtml(room.number)}
        </button>
        <div class="room-main">
          <div class="state-row">
            <select class="state-select" data-room-id="${escapeHtml(room.id)}" aria-label="Estado habitación ${escapeHtml(room.number)}">
              ${stateOptions}
            </select>
            <div class="row-progress">${formatPercent(progress)}</div>
          </div>
          <div class="room-meta">
            <span class="room-group">${escapeHtml(roomGroup)}</span>
            <span class="room-session-chip ${activeSession ? "active" : ""}" data-session-timer="${escapeHtml(room.id)}">${escapeHtml(sessionText)}</span>
            <span class="room-session-total-chip" data-session-total="${escapeHtml(room.id)}">${escapeHtml(`Hoy · ${formatDuration(sessionSummary.totalActiveSeconds)}`)}</span>
            ${activeSession ? `
              <button class="tiny-btn room-session-action-btn" type="button" data-room-session-pause-btn="${escapeHtml(room.id)}">
                ${activeSession.isPaused ? "Reanudar" : "Pausar"}
              </button>
            ` : ""}
            ${tags.length ? `
              <div class="room-tag-list" aria-label="Etiquetas habitación ${escapeHtml(room.number)}">
                ${tags.map(tag => `<span class="room-tag-chip">${escapeHtml(tag)}</span>`).join("")}
              </div>
            ` : ""}
          </div>
        </div>
        <button class="icon-btn small edit-room-btn" type="button" data-room-id="${escapeHtml(room.id)}" aria-label="Editar habitación">✎</button>
        <button class="icon-btn small delete-room-btn" type="button" data-room-id="${escapeHtml(room.id)}" aria-label="Eliminar habitación">×</button>
      </div>
      <div class="tasks">${tasks}</div>
    </article>
  `;
}

function bindRoomEvents(hotel) {
  document.querySelectorAll(".state-select").forEach(select => {
    select.addEventListener("change", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomId);
      if (!room) return;

      await updateRoomState(hotel, room, event.currentTarget.value);
    });
  });

  document.querySelectorAll(".task input").forEach(input => {
    input.addEventListener("change", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomId);
      if (!room) return;

      const checked = event.currentTarget.checked;
      const taskId = event.currentTarget.dataset.taskId;
      const previousState = room.state;

      room.checks[taskId] = checked;

      if (!checked && (room.state === "LISTA" || room.state === "LIMPIADA")) {
        room.state = "LIMPIAR";
        room.inProgressBlock = true;
        room.progressBaseState = "LIMPIAR";
      } else if (room.state === "") {
        room.state = "LIMPIAR";
        room.inProgressBlock = true;
        room.progressBaseState = "LIMPIAR";
      }

      syncRoomState(hotel, room);
      registerStatusChange(hotel, room, previousState, room.state);
      await closeSessionIfRoomCompleted(room, { persist: false });
      await saveAll();
      render();
    });
  });

  document.querySelectorAll("[data-room-session-btn]").forEach(button => {
    button.addEventListener("click", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomSessionBtn);
      if (!room) return;

      await toggleRoomSession(hotel, room);
    });
  });

  document.querySelectorAll("[data-room-session-pause-btn]").forEach(button => {
    button.addEventListener("click", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomSessionPauseBtn);
      if (!room || !isRoomSessionActive(room)) return;

      if (data.activeSession.isPaused) await resumeActiveSession(room);
      else await pauseActiveSession(room);
    });
  });

  document.querySelectorAll(".edit-room-btn").forEach(button => {
    button.addEventListener("click", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomId);
      if (!room) return;

      await editRoom(hotel, room);
    });
  });

  document.querySelectorAll(".delete-room-btn").forEach(button => {
    button.addEventListener("click", async event => {
      const room = findRoom(hotel, event.currentTarget.dataset.roomId);
      if (!room) return;

      const confirmed = confirm(`¿Eliminar habitación ${room.number}?`);
      if (!confirmed) return;

      if (isRoomSessionActive(room)) {
        await stopActiveSession({ saveMessage: `Sesión cerrada al eliminar ${room.number}.` });
      }

      hotel.rooms = hotel.rooms.filter(item => item.id !== room.id);
      await saveAll("Habitación eliminada.");
      render();
    });
  });
}

async function updateRoomState(hotel, room, nextState, options = {}) {
  const { persist = true, renderUi = true, saveMessage = "Guardado." } = options;
  const previousState = room.state;

  room.state = nextState;
  applyStateRules(hotel, room, true);
  syncRoomState(hotel, room);
  registerStatusChange(hotel, room, previousState, room.state);
  await closeSessionIfRoomCompleted(room, { persist: false });

  if (persist) await saveAll(saveMessage);
  if (renderUi) render();

  return room;
}

function syncQuickModeSelection(hotel) {
  const validRoomIds = new Set(hotel.rooms.map(room => room.id));
  quickModeSelection = new Set([...quickModeSelection].filter(roomId => validRoomIds.has(roomId)));
}

function openQuickMode(hotel) {
  quickModeOpen = true;
  quickModeHotelId = hotel.id;
  quickModeSelection = new Set();
  quickModeTargetState = STATES.includes(quickModeTargetState) ? quickModeTargetState : "LIMPIAR";
}

function closeQuickMode() {
  quickModeOpen = false;
  quickModeHotelId = null;
  quickModeSelection = new Set();
}

async function handleQuickModeButton() {
  const hotel = getCurrentHotel();

  if (!quickModeOpen || quickModeHotelId !== hotel.id) {
    openQuickMode(hotel);
  } else {
    closeQuickMode();
  }

  render();
}

async function applyQuickModeSelection(hotel) {
  syncQuickModeSelection(hotel);

  if (!quickModeSelection.size) {
    setStatus("Selecciona al menos una habitación.");
    return;
  }

  const targetRooms = [...quickModeSelection]
    .map(roomId => findRoom(hotel, roomId))
    .filter(Boolean);

  for (const room of targetRooms) {
    await updateRoomState(hotel, room, quickModeTargetState, {
      persist: false,
      renderUi: false
    });
  }

  const updatedCount = targetRooms.length;
  const targetStateLabel = getStateLabel(quickModeTargetState);
  closeQuickMode();
  await saveAll(updatedCount === 1
    ? `1 habitación marcada como ${targetStateLabel}.`
    : `${updatedCount} habitaciones marcadas como ${targetStateLabel}.`
  );
  render();
}

function addHotel() {
  openHotelModal();
}

async function deleteCurrentHotel() {
  const hotel = getCurrentHotel();

  if (data.hotels.length <= 1) {
    alert("No puedo borrar el único hotel. Crea otro primero.");
    return;
  }

  const confirmed = confirm(`¿Borrar ${hotel.name} y todas sus habitaciones?`);
  if (!confirmed) return;

  if (data.activeSession && data.activeSession.hotelId === hotel.id) {
    await stopActiveSession({ saveMessage: `Sesión cerrada al borrar ${hotel.name}.` });
  }

  data.hotels = data.hotels.filter(item => item.id !== hotel.id);
  data.selectedHotelId = data.hotels[0].id;
  await saveAll("Hotel borrado.");
  render();
}

function addRoom() {
  const hotel = getCurrentHotel();
  roomEditContext = { mode: "create", hotelId: hotel.id, roomId: null };
  roomEditTags = [];
  $roomEditTitle.textContent = "Añadir habitación";
  $saveRoomEditButton.textContent = "Crear";
  $roomEditHotelIdInput.value = hotel.id;
  $roomEditIdInput.value = "";
  $roomEditNumberInput.value = "";
  $roomEditGroupInput.value = "";
  $roomTagInput.value = "";
  renderRoomEditTags();
  $roomEditModal.classList.remove("hidden");
  $roomEditModal.setAttribute("aria-hidden", "false");
  setTimeout(() => $roomEditNumberInput.focus(), 0);
}

async function editRoom(hotel, room) {
  roomEditContext = { mode: "edit", hotelId: hotel.id, roomId: room.id };
  roomEditTags = normalizeRoomTags(room.tags);
  $roomEditTitle.textContent = "Editar habitación";
  $saveRoomEditButton.textContent = "Guardar";
  $roomEditHotelIdInput.value = hotel.id;
  $roomEditIdInput.value = room.id;
  $roomEditNumberInput.value = room.number;
  $roomEditGroupInput.value = room.group || inferRoomGroup(room.number);
  $roomTagInput.value = "";
  renderRoomEditTags();
  $roomEditModal.classList.remove("hidden");
  $roomEditModal.setAttribute("aria-hidden", "false");
  setTimeout(() => $roomEditNumberInput.focus(), 0);
}

function closeRoomEditModal() {
  roomEditContext = null;
  roomEditTags = [];
  $roomEditForm.reset();
  $roomTagEditorList.innerHTML = "";
  $roomEditTitle.textContent = "Editar habitación";
  $saveRoomEditButton.textContent = "Guardar";
  $roomEditModal.classList.add("hidden");
  $roomEditModal.setAttribute("aria-hidden", "true");
}

function renderRoomEditTags() {
  if (!roomEditTags.length) {
    $roomTagEditorList.innerHTML = `<p class="room-tag-empty">Sin etiquetas guardadas.</p>`;
    return;
  }

  $roomTagEditorList.innerHTML = roomEditTags.map(tag => `
    <span class="room-tag-chip editable">
      <span>${escapeHtml(tag)}</span>
      <button class="room-tag-remove" type="button" data-remove-room-tag="${escapeHtml(tag)}" aria-label="Quitar etiqueta ${escapeHtml(tag)}">×</button>
    </span>
  `).join("");
}

function addRoomTagFromInput() {
  const nextTag = $roomTagInput.value.trim();
  if (!nextTag) return;

  roomEditTags = normalizeRoomTags([...roomEditTags, nextTag]);
  $roomTagInput.value = "";
  renderRoomEditTags();
  $roomTagInput.focus();
}

function handleRoomEditFormClick(event) {
  const button = event.target.closest("[data-remove-room-tag]");
  if (!button) return;

  roomEditTags = roomEditTags.filter(tag => tag !== button.dataset.removeRoomTag);
  renderRoomEditTags();
}

async function submitRoomEdit(event) {
  event.preventDefault();
  if (!roomEditContext) return;

  const hotel = data.hotels.find(item => item.id === roomEditContext.hotelId);
  if (!hotel) return;

  const nextNumber = $roomEditNumberInput.value.trim();
  if (!nextNumber) return;

  if (roomEditContext.mode === "create") {
    const room = ensureRoomChecks(hotel, {
      id: uid("room"),
      number: nextNumber,
      group: normalizeRoomGroup($roomEditGroupInput.value),
      tags: normalizeRoomTags(roomEditTags),
      state: "LIMPIAR",
      checks: {},
      inProgressBlock: true,
      progressBaseState: "LIMPIAR"
    });

    applyStateRules(hotel, room, true);
    syncRoomState(hotel, room);
    hotel.rooms.push(room);
    registerStatusChange(hotel, room, "", room.state);
    closeRoomEditModal();
    await saveAll("Habitación creada.");
    render();
    return;
  }

  const room = hotel.rooms.find(item => item.id === roomEditContext.roomId);
  if (!room) return;

  room.number = nextNumber;
  room.group = normalizeRoomGroup($roomEditGroupInput.value);
  room.tags = normalizeRoomTags(roomEditTags);
  updateRoomReferencesInLogs(hotel, room);

  if (data.activeSession && data.activeSession.roomId === room.id && data.activeSession.hotelId === hotel.id) {
    data.activeSession.roomNumber = room.number;
    data.activeSession.roomGroup = getRoomGroup(room);
  }

  closeRoomEditModal();
  await saveAll("Habitación actualizada.");
  render();
}

async function submitHotelForm(event) {
  event.preventDefault();

  const name = $hotelNameInput.value.trim();
  if (!name) return;

  const currentHotel = getCurrentHotel();
  const hotel = {
    id: uid("hotel"),
    name,
    tasks: $hotelCopyTemplateInput.checked ? clone(currentHotel.tasks) : clone(DEFAULT_TASKS),
    rooms: []
  };

  data.hotels.push(hotel);
  data.selectedHotelId = hotel.id;
  closeHotelModal();
  await saveAll("Hotel creado.");
  render();
}
function updateRoomReferencesInLogs(hotel, room) {
  data.timeLogs.forEach(log => {
    if (log.hotelId === hotel.id && log.roomId === room.id) {
      log.hotelName = hotel.name;
      log.roomNumber = room.number;
      log.roomGroup = getRoomGroup(room);
    }
  });

  data.statusLogs.forEach(log => {
    if (log.hotelId === hotel.id && log.roomId === room.id) {
      log.hotelName = hotel.name;
      log.roomNumber = room.number;
    }
  });
}

async function addTask(event) {
  event.preventDefault();

  const hotel = getCurrentHotel();
  const label = $taskLabelInput.value.trim();
  const emoji = $taskEmojiInput.value.trim() || "✅";

  if (!label) return;

  const task = {
    id: uniqueTaskId(hotel, label),
    label,
    emoji,
    occupied: $taskOccupiedInput.checked
  };

  hotel.tasks.push(task);
  hotel.rooms.forEach(room => {
    const shouldStartChecked =
      room.state === "LIMPIADA" ||
      room.state === "LISTA" ||
      (room.state === "OCUPADA" && !task.occupied);

    room.checks[task.id] = shouldStartChecked;
    syncRoomState(hotel, room);
  });

  $taskEmojiInput.value = "";
  $taskLabelInput.value = "";
  $taskOccupiedInput.checked = true;

  await saveAll("Tarea añadida.");
  render();
}

async function editTask(taskId) {
  const hotel = getCurrentHotel();
  const task = hotel.tasks.find(item => item.id === taskId);
  if (!task) return;

  const emoji = prompt("Emoji:", task.emoji);
  if (emoji === null) return;

  const label = prompt("Nombre:", task.label);
  if (label === null || !label.trim()) return;

  task.emoji = emoji.trim() || "✅";
  task.label = label.trim();

  await saveAll("Tarea editada.");
  render();
}

async function deleteTask(taskId) {
  const hotel = getCurrentHotel();

  if (hotel.tasks.length <= 1) {
    alert("Tiene que quedar al menos una tarea.");
    return;
  }

  const task = hotel.tasks.find(item => item.id === taskId);
  if (!task) return;

  const confirmed = confirm(`¿Eliminar tarea ${task.emoji} ${task.label}?`);
  if (!confirmed) return;

  hotel.tasks = hotel.tasks.filter(item => item.id !== taskId);
  hotel.rooms.forEach(room => {
    delete room.checks[taskId];
    syncRoomState(hotel, room);
  });

  await saveAll("Tarea eliminada.");
  render();
}

function getRoomGroup(room) {
  return room.group || inferRoomGroup(room.number) || "Sin grupo";
}

function inferRoomGroup(roomNumber) {
  const trimmed = String(roomNumber || "").trim();
  const match = trimmed.match(/^(\d)/);
  if (!match) return "";
  return `Piso ${match[1]}`;
}

function isRoomSessionActive(room) {
  return Boolean(
    data.activeSession &&
    data.activeSession.roomId === room.id &&
    data.activeSession.hotelId === getCurrentHotel().id
  );
}

async function toggleRoomSession(hotel, room) {
  if (isRoomSessionActive(room)) {
    await stopActiveSession();
    render();
    return;
  }

  if (room.state !== "LIMPIAR" && room.state !== "OCUPADA") {
    alert("Solo puedes iniciar sesión en habitaciones LIMPIAR u OCUPADA.");
    return;
  }

  if (data.activeSession) {
    const confirmed = confirm(`Hay una sesión activa en ${data.activeSession.roomNumber}. ¿Cerrar esa sesión y empezar esta?`);
    if (!confirmed) return;
    await stopActiveSession({ saveMessage: "Sesión anterior cerrada." });
  }

  startRoomSession(hotel, room);
  await saveAll(`Sesión iniciada en ${room.number}.`);
  render();
}

async function closeSessionIfRoomCompleted(room, options = {}) {
  if (!isRoomSessionActive(room)) return null;
  if (!isRoomComplete(getCurrentHotel(), room)) return null;
  return stopActiveSession(options);
}

function startRoomSession(hotel, room) {
  const startedAt = Date.now();
  data.activeSession = {
    id: uid("session"),
    hotelId: hotel.id,
    hotelName: hotel.name,
    roomId: room.id,
    roomNumber: room.number,
    roomGroup: getRoomGroup(room),
    statusAtStart: room.state,
    workType: room.state === "OCUPADA" ? "refresh" : "cleaning",
    date: formatSessionDateKey(startedAt),
    startedAt,
    pausedAt: null,
    resumedAt: null,
    endedAt: null,
    totalActiveMs: 0,
    isPaused: false,
    pauseIntervals: [],
    startedDate: formatDateKey(startedAt),
    startedTimeLabel: formatTimeLabel(startedAt)
  };
  syncSessionTicker();
}

async function stopActiveSession(options = {}) {
  if (!data.activeSession) return null;

  const session = data.activeSession;
  const endedAt = Date.now();
  const totalActiveMs = Math.max(1000, getSessionActiveMs(session, endedAt));
  const durationSeconds = Math.max(1, Math.round(totalActiveMs / 1000));
  const date = session.date || formatSessionDateKey(session.startedAt);
  const existingTimeLog = findDailyTimeLog(session.hotelId, session.roomId, date);
  const nextTimeLog = {
    id: existingTimeLog ? existingTimeLog.id : uid("timelog"),
    hotelId: session.hotelId,
    hotelName: session.hotelName,
    roomId: session.roomId,
    roomNumber: session.roomNumber,
    roomGroup: session.roomGroup,
    workType: session.workType,
    statusAtStart: session.statusAtStart,
    date,
    startTime: formatTimeLabel(session.startedAt),
    endTime: formatTimeLabel(endedAt),
    startedAt: session.startedAt,
    pausedAt: session.pausedAt,
    resumedAt: session.resumedAt,
    endedAt,
    totalActiveMs,
    isPaused: false,
    pauseIntervals: normalizePauseIntervals(session.pauseIntervals),
    durationSeconds,
    durationReadable: formatDuration(durationSeconds)
  };
  const mergedTimeLog = existingTimeLog ? mergeTimeLogs(existingTimeLog, nextTimeLog) : nextTimeLog;

  data.timeLogs = consolidateTimeLogs([
    ...data.timeLogs.filter(log => !(log.hotelId === session.hotelId && log.roomId === session.roomId && log.date === date)),
    mergedTimeLog
  ]);
  data.activeSession = null;
  syncSessionTicker();

  if (options.persist !== false) {
    await saveAll(options.saveMessage || `Sesión guardada: ${mergedTimeLog.roomNumber}.`);
  }

  return mergedTimeLog;
}

async function pauseActiveSession(room) {
  if (!data.activeSession || data.activeSession.isPaused) return null;

  const pausedAt = Date.now();
  data.activeSession.totalActiveMs = getSessionActiveMs(data.activeSession, pausedAt);
  data.activeSession.pausedAt = pausedAt;
  data.activeSession.isPaused = true;
  data.activeSession.pauseIntervals = [
    ...normalizePauseIntervals(data.activeSession.pauseIntervals),
    {
      pausedAt,
      resumedAt: null
    }
  ];
  syncSessionTicker();
  await saveAll(`Sesión pausada: ${room.number}.`);
  render();
  return data.activeSession;
}

async function resumeActiveSession(room) {
  if (!data.activeSession || !data.activeSession.isPaused) return null;

  const resumedAt = Date.now();
  const intervals = normalizePauseIntervals(data.activeSession.pauseIntervals);
  const lastInterval = intervals[intervals.length - 1];
  if (lastInterval && !lastInterval.resumedAt) lastInterval.resumedAt = resumedAt;

  data.activeSession.pauseIntervals = intervals;
  data.activeSession.pausedAt = null;
  data.activeSession.resumedAt = resumedAt;
  data.activeSession.isPaused = false;
  syncSessionTicker();
  await saveAll(`Sesión reanudada: ${room.number}.`);
  render();
  return data.activeSession;
}

function registerStatusChange(hotel, room, previousState, nextState) {
  if (previousState === nextState) return;
  if (nextState !== "LIMPIAR" && nextState !== "OCUPADA") return;

  data.statusLogs.unshift({
    id: uid("statuslog"),
    hotelId: hotel.id,
    hotelName: hotel.name,
    roomId: room.id,
    roomNumber: room.number,
    fromStatus: previousState || "",
    toStatus: nextState,
    date: formatDateKey(Date.now()),
    timestamp: Date.now()
  });
}

function syncSessionTicker() {
  if (data.activeSession && !data.activeSession.isPaused) {
    if (!sessionTickerId) {
      sessionTickerId = setInterval(updateSessionTimerLabels, SESSION_TICK_MS);
    }
    updateSessionTimerLabels();
    return;
  }

  if (sessionTickerId) {
    clearInterval(sessionTickerId);
    sessionTickerId = null;
  }
}

function updateSessionTimerLabels() {
  if (!data.activeSession) return;

  const statusLabel = data.activeSession.isPaused ? "Pausada" : "Activa";
  const elapsedSeconds = getSessionElapsedSeconds(data.activeSession);
  const activeHotel = data.hotels.find(hotel => hotel.id === data.activeSession.hotelId);
  const activeRoom = activeHotel ? activeHotel.rooms.find(room => room.id === data.activeSession.roomId) : null;
  const todaySummary = activeHotel && activeRoom ? getTodayRoomSummary(activeHotel, activeRoom) : null;
  const timerText = `${statusLabel} · ${formatDuration(elapsedSeconds)}`;
  document.querySelectorAll(`[data-session-timer="${data.activeSession.roomId}"]`).forEach(node => {
    node.textContent = timerText;
  });
  document.querySelectorAll(`[data-session-total="${data.activeSession.roomId}"]`).forEach(node => {
    node.textContent = `Hoy · ${formatDuration(todaySummary ? todaySummary.totalActiveSeconds : elapsedSeconds)}`;
  });
}

function getSessionElapsedSeconds(session) {
  return Math.max(0, Math.round(getSessionActiveMs(session) / 1000));
}

function calculateStats() {
  const timeLogs = consolidateTimeLogs(data.timeLogs);
  const statusLogs = [...data.statusLogs];
  const roomMap = buildRoomStatsMap();

  const byRoomMap = new Map();
  timeLogs.forEach(log => {
    const key = `${log.hotelId}:${log.roomId}`;
    const entry = byRoomMap.get(key) || {
      roomLabel: buildRoomLabel(log.hotelName, log.roomNumber),
      groupLabel: log.roomGroup || "Sin grupo",
      totalSeconds: 0,
      sessionCount: 0
    };

    entry.totalSeconds += Math.round(Number(log.totalActiveMs || 0) / 1000);
    entry.sessionCount += 1;
    byRoomMap.set(key, entry);
  });

  const byGroupMap = new Map();
  timeLogs.forEach(log => {
    const key = `${log.hotelId}:${log.roomId}`;
    const groupKey = `${log.hotelId}:${log.roomGroup || "Sin grupo"}`;
    const entry = byGroupMap.get(groupKey) || {
      groupLabel: `${log.hotelName} · ${log.roomGroup || "Sin grupo"}`,
      totalSeconds: 0,
      sessionCount: 0
    };

    entry.totalSeconds += Math.round(Number(log.totalActiveMs || 0) / 1000);
    entry.sessionCount += 1;
    byGroupMap.set(groupKey, entry);

    const roomEntry = roomMap.get(key) || createRoomStatsEntry(log.hotelName, log.roomNumber, log.roomGroup);
    roomEntry.totalSeconds += Math.round(Number(log.totalActiveMs || 0) / 1000);
    roomEntry.sessionCount += 1;
    roomMap.set(key, roomEntry);
  });

  statusLogs.forEach(log => {
    const key = `${log.hotelId}:${log.roomId}`;
    const roomEntry = roomMap.get(key) || createRoomStatsEntry(log.hotelName, log.roomNumber, "");
    if (log.toStatus === "LIMPIAR") roomEntry.cleaningCount += 1;
    if (log.toStatus === "OCUPADA") roomEntry.refreshCount += 1;
    roomMap.set(key, roomEntry);
  });

  const cleaningLogs = timeLogs.filter(log => log.workType === "cleaning");
  const refreshLogs = timeLogs.filter(log => log.workType === "refresh");

  return {
    overview: {
      cleaningAverageSeconds: averageSeconds(cleaningLogs),
      refreshAverageSeconds: averageSeconds(refreshLogs),
      totalSessions: timeLogs.length,
      totalCleaningRuns: statusLogs.filter(log => log.toStatus === "LIMPIAR").length,
      totalRefreshRuns: statusLogs.filter(log => log.toStatus === "OCUPADA").length
    },
    byRoom: [...byRoomMap.values()]
      .map(entry => ({ ...entry, averageSeconds: Math.round(entry.totalSeconds / entry.sessionCount) }))
      .sort((a, b) => b.averageSeconds - a.averageSeconds)
      .slice(0, 8),
    byGroup: [...byGroupMap.values()]
      .map(entry => ({ ...entry, averageSeconds: Math.round(entry.totalSeconds / entry.sessionCount) }))
      .sort((a, b) => b.averageSeconds - a.averageSeconds)
      .slice(0, 8),
    mostBusyRooms: [...roomMap.values()]
      .filter(entry => entry.cleaningCount > 0 || entry.refreshCount > 0)
      .sort((a, b) => b.cleaningCount - a.cleaningCount || b.refreshCount - a.refreshCount)
      .slice(0, 8),
    roomActivity: [...roomMap.values()]
      .filter(entry => entry.cleaningCount > 0 || entry.refreshCount > 0)
      .sort((a, b) => b.cleaningCount - a.cleaningCount || b.refreshCount - a.refreshCount)
      .slice(0, 10),
    timeHeavyRooms: [...roomMap.values()]
      .filter(entry => entry.sessionCount > 0)
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, 8),
    recentSessions: timeLogs
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, RECENT_SESSIONS_LIMIT)
      .map(log => ({
        ...log,
        roomLabel: buildRoomLabel(log.hotelName, log.roomNumber),
        dateLabel: `${formatDateKey(log.startedAt)} · ${log.startTime}-${log.endTime}`,
        workTypeLabel: log.workType === "refresh" ? "Repaso ocupada" : "Limpieza completa"
      })),
    recentStatusLogs: statusLogs
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, RECENT_SESSIONS_LIMIT)
      .map(log => ({
        ...log,
        roomLabel: buildRoomLabel(log.hotelName, log.roomNumber),
        dateLabel: formatDateTimeLabel(log.timestamp),
        transitionLabel: `${log.fromStatus || "SIN ESTADO"} → ${log.toStatus || "SIN ESTADO"}`
      }))
  };
}

function buildRoomStatsMap() {
  const roomMap = new Map();

  data.hotels.forEach(hotel => {
    hotel.rooms.forEach(room => {
      roomMap.set(`${hotel.id}:${room.id}`, createRoomStatsEntry(hotel.name, room.number, getRoomGroup(room)));
    });
  });

  return roomMap;
}

function createRoomStatsEntry(hotelName, roomNumber, roomGroup) {
  return {
    roomLabel: buildRoomLabel(hotelName, roomNumber),
    groupLabel: roomGroup || "Sin grupo",
    totalSeconds: 0,
    sessionCount: 0,
    cleaningCount: 0,
    refreshCount: 0
  };
}

function buildRoomLabel(hotelName, roomNumber) {
  return `${hotelName} · ${roomNumber}`;
}

function averageSeconds(logs) {
  if (!logs.length) return 0;
  const total = logs.reduce((sum, log) => sum + log.durationSeconds, 0);
  return Math.round(total / logs.length);
}

async function deleteTimeLog(logId) {
  const log = data.timeLogs.find(item => item.id === logId);
  if (!log) return;

  const confirmed = confirm(`¿Borrar la sesión de ${log.roomNumber} del ${log.date}?`);
  if (!confirmed) return;

  data.timeLogs = data.timeLogs.filter(item => item.id !== logId);
  await saveAll("Sesión eliminada.");
  render();
}

async function deleteStatusLog(logId) {
  const log = data.statusLogs.find(item => item.id === logId);
  if (!log) return;

  const confirmed = confirm(`¿Borrar el cambio ${log.fromStatus || "SIN ESTADO"} → ${log.toStatus || "SIN ESTADO"} de ${log.roomNumber}?`);
  if (!confirmed) return;

  data.statusLogs = data.statusLogs.filter(item => item.id !== logId);
  await saveAll("Cambio de estado eliminado.");
  render();
}

async function clearLogType(logType) {
  const messages = {
    time: "¿Borrar todas las sesiones guardadas?",
    status: "¿Borrar todos los cambios de estado guardados?",
    all: "¿Borrar todos los registros de sesiones y cambios de estado?"
  };

  const confirmed = confirm(messages[logType] || "¿Borrar registros?");
  if (!confirmed) return;

  if (logType === "time" || logType === "all") data.timeLogs = [];
  if (logType === "status" || logType === "all") data.statusLogs = [];

  await saveAll("Registros limpiados.");
  render();
}

// These export helpers keep the data ready for future Google Sheets tabs:
// Hoteles, Habitaciones, Sesiones, CambiosEstado, ResumenHabitaciones,
// ResumenGrupos y ResumenGeneral.
function exportTimeLogsForSheets() {
  return consolidateTimeLogs(data.timeLogs).map(log => ({
    id: log.id,
    hotelId: log.hotelId,
    hotelName: log.hotelName,
    roomId: log.roomId,
    roomNumber: log.roomNumber,
    roomGroup: log.roomGroup,
    workType: log.workType,
    statusAtStart: log.statusAtStart,
    date: log.date,
    startTime: log.startTime,
    endTime: log.endTime,
    startedAt: log.startedAt,
    pausedAt: log.pausedAt,
    resumedAt: log.resumedAt,
    endedAt: log.endedAt,
    totalActiveMs: log.totalActiveMs,
    isPaused: log.isPaused,
    pauseIntervals: JSON.stringify(log.pauseIntervals || []),
    durationSeconds: log.durationSeconds,
    durationReadable: log.durationReadable
  }));
}

function exportStatusLogsForSheets() {
  return data.statusLogs.map(log => ({
    id: log.id,
    hotelId: log.hotelId,
    hotelName: log.hotelName,
    roomId: log.roomId,
    roomNumber: log.roomNumber,
    fromStatus: log.fromStatus,
    toStatus: log.toStatus,
    date: log.date,
    timestamp: log.timestamp
  }));
}

function exportRoomsForSheets() {
  return data.hotels.flatMap(hotel => hotel.rooms.map(room => ({
    hotelId: hotel.id,
    hotelName: hotel.name,
    roomId: room.id,
    roomNumber: room.number,
    roomGroup: getRoomGroup(room),
    roomState: room.state,
    inProgressBlock: room.inProgressBlock,
    progressBaseState: room.progressBaseState
  })));
}

function buildSheetsPayload() {
  return {
    generatedAt: new Date().toISOString(),
    hotels: data.hotels.map(hotel => ({
      id: hotel.id,
      name: hotel.name
    })),
    rooms: exportRoomsForSheets(),
    timeLogs: exportTimeLogsForSheets(),
    statusLogs: exportStatusLogsForSheets()
  };
}

async function syncToGoogleSheets() {
  const url = String(window.GOOGLE_SHEETS_WEBAPP_URL || "").trim();

  if (!url) {
    setStatus("Google Sheets no configurado todavía.");
    return { ok: false, reason: "missing_url" };
  }

  const payload = buildSheetsPayload();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Google Sheets respondió ${response.status}`);
  }

  setStatus("Datos enviados a Google Sheets.");
  return { ok: true };
}

function ensureRoomChecks(hotel, room) {
  const checks = { ...(room.checks || {}) };

  hotel.tasks.forEach(task => {
    if (typeof checks[task.id] !== "boolean") {
      checks[task.id] =
        room.state === "LIMPIADA" ||
        room.state === "LISTA" ||
        (room.state === "OCUPADA" && !task.occupied);
    }
  });

  Object.keys(checks).forEach(taskId => {
    if (!hotel.tasks.some(task => task.id === taskId)) delete checks[taskId];
  });

  room.checks = checks;
  room.tags = normalizeRoomTags(room.tags);
  return room;
}

function applyStateRules(hotel, room, resetTasks) {
  ensureRoomChecks(hotel, room);
  if (!resetTasks) return room;

  if (room.state === "") {
    room.inProgressBlock = false;
    room.progressBaseState = null;
    hotel.tasks.forEach(task => {
      room.checks[task.id] = false;
    });
    return room;
  }

  if (room.state === "LIMPIAR") {
    room.inProgressBlock = true;
    room.progressBaseState = "LIMPIAR";
    hotel.tasks.forEach(task => {
      room.checks[task.id] = false;
    });
    return room;
  }

  if (room.state === "OCUPADA") {
    room.inProgressBlock = true;
    room.progressBaseState = "OCUPADA";
    hotel.tasks.forEach(task => {
      room.checks[task.id] = !task.occupied;
    });
    return room;
  }

  if (room.state === "LISTA") {
    room.inProgressBlock = true;
    room.progressBaseState = room.progressBaseState || "LIMPIAR";
    hotel.tasks.forEach(task => {
      room.checks[task.id] = true;
    });
    return room;
  }

  if (room.state === "LIMPIADA") {
    room.inProgressBlock = false;
    room.progressBaseState = null;
    hotel.tasks.forEach(task => {
      room.checks[task.id] = true;
    });
  }

  return room;
}

function syncRoomState(hotel, room) {
  ensureRoomChecks(hotel, room);

  if (room.state === "") {
    room.inProgressBlock = false;
    room.progressBaseState = null;
    return room;
  }

  if (room.state === "LIMPIADA") {
    room.inProgressBlock = false;
    room.progressBaseState = null;
    return room;
  }

  if (room.state === "LIMPIAR" || room.state === "OCUPADA") {
    room.inProgressBlock = true;
    room.progressBaseState = room.state;

    if (isRoomComplete(hotel, room)) {
      room.state = "LISTA";
    }

    return room;
  }

  if (room.state === "LISTA") {
    room.inProgressBlock = true;
    room.progressBaseState = room.progressBaseState || "LIMPIAR";

    if (!isRoomComplete(hotel, room)) {
      room.state = room.progressBaseState;
    }
  }

  return room;
}

function getProgressTaskIds(hotel, room) {
  const progressState = room.state === "LISTA" ? room.progressBaseState : room.state;

  if (progressState === "LIMPIAR") return hotel.tasks.map(task => task.id);
  if (progressState === "OCUPADA") return hotel.tasks.filter(task => task.occupied).map(task => task.id);
  return [];
}

function getVisualTaskIds(hotel, room) {
  if (room.state === "LIMPIADA") return hotel.tasks.map(task => task.id);
  return getProgressTaskIds(hotel, room);
}

function calculateRoomProgress(hotel, room) {
  if (room.state === "") return null;
  if (room.state === "LIMPIADA") return 1;

  const activeTaskIds = getProgressTaskIds(hotel, room);
  const marked = activeTaskIds.filter(taskId => room.checks[taskId]).length;

  if (!activeTaskIds.length) return 1;
  return marked / activeTaskIds.length;
}

function calculateGlobalProgress(hotel) {
  const trackedRooms = hotel.rooms.filter(room => room.inProgressBlock);
  if (!trackedRooms.length) {
    return { marked: 0, total: 0, progress: 0, shouldReset: false };
  }

  let marked = 0;
  let total = 0;
  let pendingRooms = 0;

  trackedRooms.forEach(room => {
    const taskIds = getProgressTaskIds(hotel, room);
    const completedTasks = taskIds.filter(taskId => room.checks[taskId]).length;

    marked += completedTasks;
    total += taskIds.length;

    if (calculateRoomProgress(hotel, room) < 1) {
      pendingRooms += 1;
    }
  });

  if (!total) {
    return { marked: 0, total: 0, progress: 0, shouldReset: pendingRooms === 0 };
  }

  return {
    marked,
    total,
    progress: Math.min(marked / total, 1),
    shouldReset: pendingRooms === 0
  };
}

function isRoomComplete(hotel, room) {
  const progress = calculateRoomProgress(hotel, room);
  return progress !== null && progress >= 1;
}

function scheduleBlockResetIfNeeded(hotel, summary) {
  if (!summary.shouldReset) {
    clearPendingBlockReset(hotel.id);
    return;
  }

  if (pendingBlockResets.has(hotel.id)) return;

  const timerId = setTimeout(async () => {
    pendingBlockResets.delete(hotel.id);

    const changed = closeProgressBlock(hotel.id);
    if (!changed) return;

    await saveAll("Bloque completado.");
    render();
  }, BLOCK_RESET_DELAY);

  pendingBlockResets.set(hotel.id, timerId);
}

function clearPendingBlockReset(hotelId) {
  if (hotelId) {
    const timerId = pendingBlockResets.get(hotelId);
    if (!timerId) return;
    clearTimeout(timerId);
    pendingBlockResets.delete(hotelId);
    return;
  }

  pendingBlockResets.forEach(timerId => clearTimeout(timerId));
  pendingBlockResets.clear();
}

function closeProgressBlock(hotelId) {
  const hotel = data.hotels.find(item => item.id === hotelId);
  if (!hotel) return false;

  const summary = calculateGlobalProgress(hotel);
  if (!summary.shouldReset) return false;

  let changed = false;

  hotel.rooms.forEach(room => {
    if (!room.inProgressBlock) return;
    room.inProgressBlock = false;
    room.progressBaseState = null;
    changed = true;
  });

  return changed;
}

function compareRooms(a, b) {
  const stateDiff = (STATE_PRIORITY[a.state] ?? 99) - (STATE_PRIORITY[b.state] ?? 99);
  if (stateDiff !== 0) return stateDiff;

  return String(a.number).localeCompare(String(b.number), "es", {
    numeric: true,
    sensitivity: "base"
  });
}

function findRoom(hotel, roomId) {
  return hotel.rooms.find(room => room.id === roomId);
}

async function resetLocalData() {
  const confirmed = confirm("¿Reiniciar datos locales? No borra Firebase.");
  if (!confirmed) return;

  clearPendingBlockReset();
  localStorage.removeItem(STORAGE_KEY);
  data = loadLocalData();
  syncSessionTicker();
  await saveAll("Datos locales reiniciados.");
  render();
}

async function syncNow() {
  try {
    await saveAll(firebaseReady ? "Sincronizado." : "Modo local. Falta databaseURL.");
    await syncToGoogleSheets();
  } catch (error) {
    console.error(error);
    setStatus("No se pudo sincronizar con Google Sheets.");
  }
}

function setStatus(message) {
  $statusMessage.textContent = message;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatDateKey(timestamp) {
  return new Date(timestamp).toLocaleDateString("es-ES");
}

function formatSessionDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTimeLabel(timestamp) {
  return `${formatDateKey(timestamp)} · ${formatTimeLabel(timestamp)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueTaskId(hotel, label) {
  const base = slugify(label) || "tarea";
  let id = base;
  let count = 2;

  while (hotel.tasks.some(task => task.id === id)) {
    id = `${base}-${count}`;
    count += 1;
  }

  return id;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
