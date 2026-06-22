const TASKS = [
  { key: "cama", label: "Cama" },
  { key: "bano", label: "Baño" },
  { key: "toallas", label: "Toallas" },
  { key: "suministros", label: "Suministros" },
  { key: "cristales", label: "Cristales" },
  { key: "aspirar", label: "Aspirar" },
  { key: "fregar", label: "Fregar" }
];

const STATES = ["", "LIMPIAR", "OCUPADA", "LIMPIADA"];

// Aquí decides qué tareas cuentan en OCUPADA.
// Índices: 0=Cama, 1=Baño, 2=Toallas, 3=Suministros, 4=Cristales, 5=Aspirar, 6=Fregar
const OCCUPIED_TASK_INDEXES = [0, 2, 3];

const DEFAULT_ROOMS = [
  { number: "101", state: "LIMPIAR" },
  { number: "102", state: "OCUPADA" },
  { number: "103", state: "OCUPADA" },
  { number: "104", state: "LIMPIAR" },
  { number: "105", state: "OCUPADA" },
  { number: "106", state: "" },
  { number: "107", state: "LIMPIAR" },
  { number: "108", state: "" },
  { number: "109", state: "" },
  { number: "110", state: "" },
  { number: "111", state: "" },
  { number: "201", state: "" },
  { number: "202", state: "" },
  { number: "203", state: "" },
  { number: "204", state: "" },
  { number: "205", state: "LIMPIAR" },
  { number: "206", state: "" }
];

const STORAGE_KEY = "housekeeping-v1";

let rooms = [];
let dbRef = null;
let firebaseReady = false;
let firebaseSaving = false;

const $rooms = document.querySelector("#rooms");
const $globalPercent = document.querySelector("#globalPercent");
const $globalBar = document.querySelector("#globalBar");
const $cleanCount = document.querySelector("#cleanCount");
const $occupiedCount = document.querySelector("#occupiedCount");
const $todoCount = document.querySelector("#todoCount");
const $statusMessage = document.querySelector("#statusMessage");
const $resetButton = document.querySelector("#resetButton");
const $syncButton = document.querySelector("#syncButton");

init();

function init() {
  rooms = loadLocalRooms();
  setupFirebase();
  render();

  $resetButton.addEventListener("click", resetLocalData);
  $syncButton.addEventListener("click", syncNow);
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
    dbRef = firebase.database().ref(window.FIREBASE_DB_PATH || "housekeeping/rooms");
    firebaseReady = true;

    dbRef.on("value", snapshot => {
      if (firebaseSaving) return;
      const remoteRooms = snapshot.val();
      if (Array.isArray(remoteRooms) && remoteRooms.length) {
        rooms = normalizeRooms(remoteRooms);
        saveLocalRooms();
        render();
        setStatus("Sincronizado con Firebase.");
      }
    });

    setStatus("Firebase conectado.");
  } catch (error) {
    console.error(error);
    setStatus("Firebase no conectado. Sigo en local.");
  }
}

function buildDefaultRooms() {
  return DEFAULT_ROOMS.map(room => applyStateRules({
    number: room.number,
    state: room.state,
    tasks: emptyTasks()
  }, true));
}

function emptyTasks() {
  return Object.fromEntries(TASKS.map(task => [task.key, false]));
}

function normalizeRooms(inputRooms) {
  return inputRooms.map(room => ({
    number: String(room.number || ""),
    state: STATES.includes(room.state) ? room.state : "",
    tasks: {
      ...emptyTasks(),
      ...(room.tasks || {})
    }
  }));
}

function loadLocalRooms() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return normalizeRooms(saved);
  } catch (error) {
    console.warn(error);
  }

  return buildDefaultRooms();
}

function saveLocalRooms() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

async function saveAll() {
  saveLocalRooms();

  if (!firebaseReady || !dbRef) return;

  try {
    firebaseSaving = true;
    await dbRef.set(rooms);
    setStatus("Guardado.");
  } catch (error) {
    console.error(error);
    setStatus("No se pudo guardar en Firebase. Guardado local.");
  } finally {
    firebaseSaving = false;
  }
}

function render() {
  $rooms.innerHTML = rooms.map(roomTemplate).join("");
  updateSummary();
  bindRoomEvents();
}

function roomTemplate(room, index) {
  const progress = calculateRoomProgress(room);
  const activeIndexes = getActiveTaskIndexes(room.state);

  const stateOptions = STATES.map(state => {
    const label = state || "SIN ESTADO";
    const selected = room.state === state ? "selected" : "";
    return `<option value="${state}" ${selected}>${label}</option>`;
  }).join("");

  const tasks = TASKS.map((task, taskIndex) => {
    const checked = room.tasks[task.key] ? "checked" : "";
    const inactive = activeIndexes.length && !activeIndexes.includes(taskIndex) ? "inactive" : "";

    return `
      <label class="task ${inactive}">
        <input data-index="${index}" data-task="${task.key}" type="checkbox" ${checked}>
        <span>${task.label}</span>
      </label>
    `;
  }).join("");

  return `
    <article class="room-card" data-state="${room.state}">
      <div class="room-head">
        <div class="room-number">${room.number}</div>
        <select class="state-select" data-index="${index}" aria-label="Estado habitación ${room.number}">
          ${stateOptions}
        </select>
        <div class="row-progress">${formatPercent(progress)}</div>
      </div>
      <div class="tasks">${tasks}</div>
    </article>
  `;
}

function bindRoomEvents() {
  document.querySelectorAll(".state-select").forEach(select => {
    select.addEventListener("change", async event => {
      const index = Number(event.target.dataset.index);
      rooms[index].state = event.target.value;
      rooms[index] = applyStateRules(rooms[index], true);
      await saveAll();
      render();
    });
  });

  document.querySelectorAll(".task input").forEach(input => {
    input.addEventListener("change", async event => {
      const index = Number(event.target.dataset.index);
      const taskKey = event.target.dataset.task;

      rooms[index].tasks[taskKey] = event.target.checked;

      if (rooms[index].state === "") {
        rooms[index].state = "LIMPIAR";
      }

      if (isRoomComplete(rooms[index])) {
        rooms[index].state = "LIMPIADA";
        rooms[index] = applyStateRules(rooms[index], true);
      }

      await saveAll();
      render();
    });
  });
}

function applyStateRules(room, resetTasks) {
  if (!resetTasks) return room;

  const tasks = { ...room.tasks };

  if (room.state === "") {
    TASKS.forEach(task => tasks[task.key] = false);
  }

  if (room.state === "LIMPIAR") {
    TASKS.forEach(task => tasks[task.key] = false);
  }

  if (room.state === "OCUPADA") {
    TASKS.forEach((task, index) => {
      tasks[task.key] = !OCCUPIED_TASK_INDEXES.includes(index);
    });
  }

  if (room.state === "LIMPIADA") {
    TASKS.forEach(task => tasks[task.key] = true);
  }

  return { ...room, tasks };
}

function getActiveTaskIndexes(state) {
  if (state === "OCUPADA") return OCCUPIED_TASK_INDEXES;
  if (state === "LIMPIAR" || state === "LIMPIADA") return TASKS.map((_, index) => index);
  return [];
}

function calculateRoomProgress(room) {
  const indexes = getActiveTaskIndexes(room.state);
  if (!indexes.length) return null;

  const marked = indexes.filter(index => room.tasks[TASKS[index].key]).length;
  return marked / indexes.length;
}

function isRoomComplete(room) {
  const progress = calculateRoomProgress(room);
  return progress !== null && progress >= 1;
}

function updateSummary() {
  const activeRooms = rooms.filter(room => getActiveTaskIndexes(room.state).length);

  let marked = 0;
  let total = 0;

  activeRooms.forEach(room => {
    const indexes = getActiveTaskIndexes(room.state);
    total += indexes.length;
    marked += indexes.filter(index => room.tasks[TASKS[index].key]).length;
  });

  const globalProgress = total ? marked / total : 0;

  $globalPercent.textContent = formatPercent(globalProgress);
  $globalBar.style.width = `${Math.round(globalProgress * 100)}%`;

  $cleanCount.textContent = rooms.filter(room => room.state === "LIMPIADA").length;
  $occupiedCount.textContent = rooms.filter(room => room.state === "OCUPADA").length;
  $todoCount.textContent = rooms.filter(room => room.state === "LIMPIAR").length;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function resetLocalData() {
  const confirmed = confirm("¿Reiniciar los datos locales de esta app?");
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEY);
  rooms = buildDefaultRooms();
  saveAll();
  render();
}

async function syncNow() {
  await saveAll();
  setStatus(firebaseReady ? "Sincronizado." : "Modo local. Falta configurar Firebase.");
}

function setStatus(message) {
  $statusMessage.textContent = message;
}
