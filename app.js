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
      name: "Hotel Steinbock",
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
      name: "Hotel Bären",
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

const $hotelTitle = document.querySelector("#hotelTitle");
const $globalPercent = document.querySelector("#globalPercent");
const $globalBar = document.querySelector("#globalBar");
const $progressHint = document.querySelector("#progressHint");
const $todoCount = document.querySelector("#todoCount");
const $occupiedCount = document.querySelector("#occupiedCount");
const $cleanCount = document.querySelector("#cleanCount");
const $hotelTabs = document.querySelector("#hotelTabs");
const $rooms = document.querySelector("#rooms");
const $statusMessage = document.querySelector("#statusMessage");
const $templatePanel = document.querySelector("#templatePanel");
const $statsPanel = document.querySelector("#statsPanel");
const $taskEditorList = document.querySelector("#taskEditorList");
const $statsContent = document.querySelector("#statsContent");
const $addTaskForm = document.querySelector("#addTaskForm");
const $taskEmojiInput = document.querySelector("#taskEmojiInput");
const $taskLabelInput = document.querySelector("#taskLabelInput");
const $taskOccupiedInput = document.querySelector("#taskOccupiedInput");

const $addHotelButton = document.querySelector("#addHotelButton");
const $deleteHotelButton = document.querySelector("#deleteHotelButton");
const $addRoomButton = document.querySelector("#addRoomButton");
const $templateButton = document.querySelector("#templateButton");
const $statsButton = document.querySelector("#statsButton");
const $closeTemplateButton = document.querySelector("#closeTemplateButton");
const $closeStatsButton = document.querySelector("#closeStatsButton");
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
  $templateButton.addEventListener("click", () => $templatePanel.classList.toggle("hidden"));
  $statsButton.addEventListener("click", () => $statsPanel.classList.toggle("hidden"));
  $closeTemplateButton.addEventListener("click", () => $templatePanel.classList.add("hidden"));
  $closeStatsButton.addEventListener("click", () => $statsPanel.classList.add("hidden"));
  $resetButton.addEventListener("click", resetLocalData);
  $syncButton.addEventListener("click", syncNow);
  $addTaskForm.addEventListener("submit", addTask);
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
  const timeLogs = Array.isArray(input.timeLogs) ? input.timeLogs.map(normalizeTimeLog).filter(Boolean) : [];
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

function normalizeRoomGroup(group) {
  return String(group || "").trim();
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

  return {
    id: String(log.id || uid("timelog")),
    hotelId: String(log.hotelId || ""),
    hotelName: String(log.hotelName || ""),
    roomId: String(log.roomId || ""),
    roomNumber: String(log.roomNumber || ""),
    roomGroup: String(log.roomGroup || ""),
    workType: log.workType === "refresh" ? "refresh" : "cleaning",
    statusAtStart: normalizeState(log.statusAtStart),
    date: String(log.date || ""),
    startTime: String(log.startTime || formatTimeLabel(Number(log.startedAt || 0))),
    endTime: String(log.endTime || formatTimeLabel(Number(log.endedAt || 0))),
    startedAt: Number(log.startedAt || 0),
    endedAt: Number(log.endedAt || 0),
    durationSeconds: Math.max(0, Number(log.durationSeconds || 0)),
    durationReadable: String(log.durationReadable || formatDuration(Number(log.durationSeconds || 0)))
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
    startedAt: Number(session.startedAt),
    startedDate: String(session.startedDate || formatDateKey(Number(session.startedAt))),
    startedTimeLabel: String(session.startedTimeLabel || formatTimeLabel(Number(session.startedAt)))
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

function render() {
  const hotel = getCurrentHotel();
  $hotelTitle.textContent = hotel.name;
  renderHotelTabs();
  renderSummary(hotel);
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

  $statsContent.innerHTML = `
    <div class="stats-grid">
      <article class="stats-card stats-hero">
        <p class="label">Media general</p>
        <div class="stats-hero-values">
          <div>
            <strong>${formatDuration(stats.overview.cleaningAverageSeconds)}</strong>
            <span>Limpieza completa</span>
          </div>
          <div>
            <strong>${formatDuration(stats.overview.refreshAverageSeconds)}</strong>
            <span>Repaso ocupada</span>
          </div>
        </div>
      </article>

      <article class="stats-card">
        <p class="label">Volumen</p>
        <div class="stats-kpis">
          <div><strong>${stats.overview.totalSessions}</strong><span>sesiones</span></div>
          <div><strong>${stats.overview.totalCleaningRuns}</strong><span>veces LIMPIAR</span></div>
          <div><strong>${stats.overview.totalRefreshRuns}</strong><span>veces OCUPADA</span></div>
        </div>
      </article>
    </div>

    ${renderStatsListSection("Media por habitación", stats.byRoom, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.roomLabel)}</strong>
          <small>${escapeHtml(item.groupLabel)}</small>
        </div>
        <span>${formatDuration(item.averageSeconds)}</span>
      </div>
    `)}

    ${renderStatsListSection("Media por grupo", stats.byGroup, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.groupLabel)}</strong>
          <small>${item.sessionCount} sesiones</small>
        </div>
        <span>${formatDuration(item.averageSeconds)}</span>
      </div>
    `)}

    ${renderStatsListSection("Habitaciones más concurridas", stats.mostBusyRooms, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.roomLabel)}</strong>
          <small>${item.refreshCount} repasos ocupada</small>
        </div>
        <span>${item.cleaningCount} veces</span>
      </div>
    `)}

    ${renderStatsListSection("Actividad por habitación", stats.roomActivity, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.roomLabel)}</strong>
          <small>${escapeHtml(item.groupLabel)}</small>
        </div>
        <span>${item.cleaningCount} LIMPIAR · ${item.refreshCount} OCUPADA</span>
      </div>
    `)}

    ${renderStatsListSection("Habitaciones que más tiempo consumen", stats.timeHeavyRooms, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.roomLabel)}</strong>
          <small>${item.sessionCount} sesiones</small>
        </div>
        <span>${formatDuration(item.totalSeconds)}</span>
      </div>
    `)}

    ${renderStatsListSection("Histórico reciente", stats.recentSessions, item => `
      <div class="stats-list-row">
        <div>
          <strong>${escapeHtml(item.dateLabel)} · ${escapeHtml(item.roomLabel)}</strong>
          <small>${escapeHtml(item.hotelName)} · ${escapeHtml(item.workTypeLabel)}</small>
        </div>
        <span>${escapeHtml(item.durationReadable)}</span>
      </div>
    `)}
  `;
}

function renderStatsListSection(title, items, template) {
  const content = items.length
    ? items.map(template).join("")
    : `<p class="stats-empty">Todavía no hay datos suficientes.</p>`;

  return `
    <section class="stats-section">
      <div class="stats-section-head">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="stats-list">${content}</div>
    </section>
  `;
}

function renderRooms(hotel) {
  const sortedRooms = [...hotel.rooms].sort(compareRooms);

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

function roomTemplate(hotel, room) {
  const progress = calculateRoomProgress(hotel, room);
  const activeTaskIds = getVisualTaskIds(hotel, room);
  const activeSession = isRoomSessionActive(room) ? data.activeSession : null;
  const roomGroup = getRoomGroup(room);
  const timerText = activeSession ? formatDuration(getSessionElapsedSeconds(activeSession)) : "Sin sesión";
  const sessionLabel = activeSession ? "Sesión activa" : "";

  const stateOptions = STATES.map(state => {
    const label = state || "SIN ESTADO";
    const selected = room.state === state ? "selected" : "";
    return `<option value="${state}" ${selected}>${label}</option>`;
  }).join("");

  const tasks = hotel.tasks.map(task => {
    const checked = room.checks[task.id] ? "checked" : "";
    const inactive = activeTaskIds.length && !activeTaskIds.includes(task.id) ? "inactive" : "";
    const checkedClass = room.checks[task.id] ? "checked" : "";

    return `
      <label class="task ${inactive} ${checkedClass}">
        <input data-room-id="${escapeHtml(room.id)}" data-task-id="${escapeHtml(task.id)}" type="checkbox" ${checked}>
        <span class="task-surface">
          <span class="task-copy">
            <span class="emoji">${escapeHtml(task.emoji)}</span>
            <span class="task-label">${escapeHtml(task.label)}</span>
          </span>
          <span class="task-mark" aria-hidden="true"></span>
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
          <div class="room-meta">
            <span class="room-group">${escapeHtml(roomGroup)}</span>
            ${sessionLabel ? `<span class="room-session-label">${escapeHtml(sessionLabel)}</span>` : ""}
          </div>
          <div class="state-row">
            <select class="state-select" data-room-id="${escapeHtml(room.id)}" aria-label="Estado habitación ${escapeHtml(room.number)}">
              ${stateOptions}
            </select>
            <div class="row-progress">${formatPercent(progress)}</div>
          </div>
          <div class="room-subrow">
            <div class="room-timer" data-session-timer="${escapeHtml(room.id)}">${timerText}</div>
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

      const previousState = room.state;
      room.state = event.currentTarget.value;
      applyStateRules(hotel, room, true);
      syncRoomState(hotel, room);
      registerStatusChange(hotel, room, previousState, room.state);
      await saveAll();
      render();
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

function addHotel() {
  const name = prompt("Nombre del hotel:");
  if (!name || !name.trim()) return;

  const hotel = {
    id: uid("hotel"),
    name: name.trim(),
    tasks: clone(DEFAULT_TASKS),
    rooms: []
  };

  data.hotels.push(hotel);
  data.selectedHotelId = hotel.id;
  saveAll("Hotel creado.");
  render();
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
  const number = prompt("Número/nombre de habitación:");
  if (!number || !number.trim()) return;

  const cleanedNumber = number.trim();
  const suggestedGroup = inferRoomGroup(cleanedNumber);
  const group = prompt("Grupo de habitación (opcional):", suggestedGroup);
  if (group === null) return;

  const room = ensureRoomChecks(hotel, {
    id: uid("room"),
    number: cleanedNumber,
    group: normalizeRoomGroup(group),
    state: "LIMPIAR",
    checks: {},
    inProgressBlock: true,
    progressBaseState: "LIMPIAR"
  });

  applyStateRules(hotel, room, true);
  syncRoomState(hotel, room);
  hotel.rooms.push(room);
  registerStatusChange(hotel, room, "", room.state);
  saveAll("Habitación creada.");
  render();
}

async function editRoom(hotel, room) {
  const nextNumber = prompt("Número/nombre de habitación:", room.number);
  if (nextNumber === null) return;
  if (!nextNumber.trim()) return;

  const defaultGroup = room.group || inferRoomGroup(nextNumber.trim());
  const nextGroup = prompt("Grupo de habitación:", defaultGroup);
  if (nextGroup === null) return;

  room.number = nextNumber.trim();
  room.group = normalizeRoomGroup(nextGroup);

  if (data.activeSession && data.activeSession.roomId === room.id && data.activeSession.hotelId === hotel.id) {
    data.activeSession.roomNumber = room.number;
    data.activeSession.roomGroup = getRoomGroup(room);
  }

  await saveAll("Habitación actualizada.");
  render();
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
    startedAt,
    startedDate: formatDateKey(startedAt),
    startedTimeLabel: formatTimeLabel(startedAt)
  };
}

async function stopActiveSession(options = {}) {
  if (!data.activeSession) return null;

  const session = data.activeSession;
  const endedAt = Date.now();
  const durationSeconds = Math.max(1, Math.round((endedAt - session.startedAt) / 1000));
  const timeLog = {
    id: uid("timelog"),
    hotelId: session.hotelId,
    hotelName: session.hotelName,
    roomId: session.roomId,
    roomNumber: session.roomNumber,
    roomGroup: session.roomGroup,
    workType: session.workType,
    statusAtStart: session.statusAtStart,
    date: formatDateKey(session.startedAt),
    startTime: formatTimeLabel(session.startedAt),
    endTime: formatTimeLabel(endedAt),
    startedAt: session.startedAt,
    endedAt,
    durationSeconds,
    durationReadable: formatDuration(durationSeconds)
  };

  data.timeLogs.unshift(timeLog);
  data.activeSession = null;
  syncSessionTicker();

  await saveAll(options.saveMessage || `Sesión guardada: ${timeLog.roomNumber}.`);
  return timeLog;
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
  if (data.activeSession) {
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

  const timerText = formatDuration(getSessionElapsedSeconds(data.activeSession));
  document.querySelectorAll(`[data-session-timer="${data.activeSession.roomId}"]`).forEach(node => {
    node.textContent = timerText;
  });
}

function getSessionElapsedSeconds(session) {
  return Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
}

function calculateStats() {
  const timeLogs = [...data.timeLogs];
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

    entry.totalSeconds += log.durationSeconds;
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

    entry.totalSeconds += log.durationSeconds;
    entry.sessionCount += 1;
    byGroupMap.set(groupKey, entry);

    const roomEntry = roomMap.get(key) || createRoomStatsEntry(log.hotelName, log.roomNumber, log.roomGroup);
    roomEntry.totalSeconds += log.durationSeconds;
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
        dateLabel: formatDateTimeLabel(log.startedAt),
        workTypeLabel: log.workType === "refresh" ? "Repaso ocupada" : "Limpieza completa"
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
  await saveAll(firebaseReady ? "Sincronizado." : "Modo local. Falta databaseURL.");
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
