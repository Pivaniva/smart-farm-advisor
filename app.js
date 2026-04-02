const setupForm = document.getElementById("setup-form");
const setupPanel = document.getElementById("setup-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const editBtn = document.getElementById("edit-btn");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const authEmail = document.getElementById("auth-email");
const logoutBtn = document.getElementById("logout-btn");

const outCrop = document.getElementById("out-crop");
const outLocation = document.getElementById("out-location");
const outWeather = document.getElementById("out-weather");
const outSync = document.getElementById("out-sync");
const outStage = document.getElementById("out-stage");
const outWatering = document.getElementById("out-watering");
const outRisk = document.getElementById("out-risk");
const outSpraying = document.getElementById("out-spraying");
const outFertilizer = document.getElementById("out-fertilizer");
const outPesticide = document.getElementById("out-pesticide");
const outAlert = document.getElementById("out-alert");
const taskButtons = document.querySelectorAll(".task-btn");
const taskHistory = document.getElementById("task-history");

const LEGACY_SETUP_KEY_BASE = "smartFarmSetup";
const LOCAL_TASKS_KEY_BASE = "smartFarmTaskHistory";
const DEVICE_ID_KEY = "smartFarmDeviceId";
const FIELDS_KEY = "smartFarmFields";
const ACTIVE_FIELD_KEY = "smartFarmActiveField";

// ── Field management ──
function loadFields() {
  try { return JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]"); }
  catch (_) { return []; }
}

function saveFields(fields) {
  localStorage.setItem(FIELDS_KEY, JSON.stringify(fields));
}

function getActiveFieldId() {
  return localStorage.getItem(ACTIVE_FIELD_KEY) || null;
}

function setActiveFieldId(id) {
  localStorage.setItem(ACTIVE_FIELD_KEY, id);
}

function createField(name) {
  const id = `field-${Date.now()}`;
  const fields = loadFields();
  fields.push({ id, name });
  saveFields(fields);
  setActiveFieldId(id);
  return id;
}

function deleteField(id) {
  const fields = loadFields().filter(f => f.id !== id);
  saveFields(fields);
  localStorage.removeItem(`${LEGACY_SETUP_KEY_BASE}:${id}`);
  localStorage.removeItem(`${LOCAL_TASKS_KEY_BASE}:${id}`);
  if (getActiveFieldId() === id) {
    setActiveFieldId(fields[0]?.id || null);
  }
}

function getFieldStorageSuffix() {
  const id = getActiveFieldId();
  return id ? id : getScopeId();
}

const cropLabelsKa = {
  maize:       "სიმინდი",
  wheat:       "ხორბალი",
  tomato:      "პომიდორი",
  potato:      "კარტოფილი",
  rice:        "ბრინჯი",
  vine:        "ვაზი (ღვინო)",
  nuts:        "თხილი/კაკალი",
  sunflower:   "მზესუმზირა",
  onion:       "ხახვი",
  garlic:      "ნიორი",
  pepper:      "წიწაკა",
  cucumber:    "კიტრი",
  watermelon:  "საზამთრო",
  cabbage:     "კომბოსტო",
  carrot:      "სტაფილო",
  strawberry:  "მარწყვი",
  apple:       "ვაშლი",
  peach:       "ატამი",
  bean:        "მხალი/ლობიო"
};

const taskLabelsKa = {
  watering: "მორწყვა დასრულდა",
  spraying: "შეწამვლა დასრულდა",
  inspection: "შემოწმება შესრულდა"
};

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

const deviceId = getOrCreateDeviceId();

const appConfig = window.APP_CONFIG || {};
let supabaseClient = null;
let syncModeLabel = "ლოკალური";
let supabaseReady = false;
let currentUser = null;

if (
  window.supabase &&
  typeof window.supabase.createClient === "function" &&
  appConfig.supabaseUrl &&
  appConfig.supabaseAnonKey
) {
  try {
    supabaseClient = window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey);
  } catch (_) {
    supabaseClient = null;
    syncModeLabel = "ლოკალური";
  }
}

function setSyncBadge() {
  outSync.textContent = syncModeLabel;
}

function setLocalMode(reason) {
  supabaseReady = false;
  syncModeLabel = reason ? `ლოკალური (${reason})` : "ლოკალური";
  setSyncBadge();
}

function setCloudMode() {
  supabaseReady = true;
  syncModeLabel = "ქლაუდი (Supabase)";
  setSyncBadge();
}

function getScopeId() {
  if (currentUser?.id) return `user:${currentUser.id}`;
  return `device:${deviceId}`;
}

function getSetupStorageKey() {
  return `${LEGACY_SETUP_KEY_BASE}:${getFieldStorageSuffix()}`;
}

function getTaskStorageKey() {
  return `${LOCAL_TASKS_KEY_BASE}:${getFieldStorageSuffix()}`;
}

function setAuthStatusText(text) {
  authStatus.textContent = text;
}

function renderAuthUI() {
  if (currentUser?.email) {
    setAuthStatusText(`სტატუსი: შესულია - ${currentUser.email}`);
    logoutBtn.classList.remove("hidden");
    authForm.classList.add("hidden");
    setupPanel.classList.remove("hidden");
    return;
  }

  setAuthStatusText("სტატუსი: ლოკალური რეჟიმი");
  logoutBtn.classList.add("hidden");
  authForm.classList.remove("hidden");
}

async function verifySupabaseConnection() {
  if (!supabaseClient) {
    setLocalMode();
    return;
  }

  const { error } = await supabaseClient.from("farm_profiles").select("device_id").limit(1);
  if (error) {
    setLocalMode("ქლაუდი მიუწვდომელია");
    return;
  }

  setCloudMode();
}

async function initAuth() {
  if (!supabaseClient) {
    currentUser = null;
    renderAuthUI();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data?.session?.user || null;
  renderAuthUI();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    renderAuthUI();
    void reloadDataForCurrentScope();
  });
}

async function sendLoginLink(email) {
  if (!supabaseClient) {
    setAuthStatusText("სტატუსი: Supabase არ არის კონფიგურირებული");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}${window.location.pathname}`
    }
  });

  if (error) {
    setAuthStatusText("სტატუსი: შესვლის ლინკი ვერ გაიგზავნა");
    return;
  }

  setAuthStatusText("სტატუსი: შეამოწმეთ ელ-ფოსტა და გახსენით ლინკი");
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function reloadDataForCurrentScope() {
  await verifySupabaseConnection();
  await refreshTaskHistory();

  const data = await loadSetup();
  if (!data) {
    dashboardPanel.classList.add("hidden");
    setupPanel.classList.remove("hidden");
    return;
  }

  document.getElementById("crop").value = data.crop;
  document.getElementById("location").value = data.location;
  document.getElementById("planting-date").value = data.plantingDate;
  await renderDashboard(data);
}

function formatDateTimeKa(date) {
  return new Intl.DateTimeFormat("ka-GE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function readLocalTaskHistory() {
  const raw = localStorage.getItem(getTaskStorageKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLocalTaskHistory(items) {
  localStorage.setItem(getTaskStorageKey(), JSON.stringify(items));
}

function renderTaskHistory(items) {
  if (!items.length) {
    taskHistory.innerHTML = "<li>ჯერ ჩანაწერი არ არის.</li>";
    return;
  }

  taskHistory.innerHTML = items
    .slice(0, 12)
    .map((item) => `<li>${item.label} - ${item.time}</li>`)
    .join("");
}

async function loadTaskHistory() {
  if (!supabaseClient || !supabaseReady) return readLocalTaskHistory();

  const { data, error } = await supabaseClient
    .from("task_history")
    .select("task_key,label,created_at")
    .eq("device_id", getScopeId())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    setLocalMode("ჩაწერა ვერ მოხერხდა");
    return readLocalTaskHistory();
  }

  return (data || []).map((row) => ({
    task: row.task_key,
    label: row.label || taskLabelsKa[row.task_key] || row.task_key,
    time: formatDateTimeKa(new Date(row.created_at))
  }));
}

async function refreshTaskHistory() {
  const items = await loadTaskHistory();
  renderTaskHistory(items);
}

async function addTaskRecord(taskKey) {
  const record = {
    task: taskKey,
    label: taskLabelsKa[taskKey] || taskKey,
    time: formatDateTimeKa(new Date())
  };

  const localItems = readLocalTaskHistory();
  localItems.unshift(record);
  writeLocalTaskHistory(localItems.slice(0, 50));

  if (supabaseClient && supabaseReady) {
    const { error } = await supabaseClient.from("task_history").insert({
      device_id: getScopeId(),
      task_key: taskKey,
      label: record.label
    });
    if (error) setLocalMode("ქლაუდი ვერ ჩაიწერა");
  }

  await refreshTaskHistory();
}

async function saveSetup(data) {
  localStorage.setItem(getSetupStorageKey(), JSON.stringify(data));

  if (!supabaseClient || !supabaseReady) return;

  const { error } = await supabaseClient.from("farm_profiles").upsert(
    {
      device_id: getScopeId(),
      crop: data.crop,
      location: data.location,
      planting_date: data.plantingDate,
      farm_size: data.farmSize || 0
    },
    { onConflict: "device_id" }
  );
  if (error) setLocalMode("პროფილი ვერ ჩაიწერა");
}

async function loadSetup() {
  if (supabaseClient && supabaseReady) {
    const { data, error } = await supabaseClient
      .from("farm_profiles")
      .select("crop,location,planting_date")
      .eq("device_id", getScopeId())
      .maybeSingle();

    if (!error && data?.crop && data?.location && data?.planting_date) {
      return {
        crop: String(data.crop).trim(),
        location: String(data.location).trim(),
        plantingDate: String(data.planting_date).trim()
      };
    }
  }

  const saved = localStorage.getItem(getSetupStorageKey());
  if (!saved) return null;

  try {
    const parsed = JSON.parse(saved);
    if (!parsed.crop || !parsed.location || !parsed.plantingDate) return null;
    return parsed;
  } catch (_) {
    localStorage.removeItem(getSetupStorageKey());
    return null;
  }
}

const mockWeatherByLocation = {
  tbilisi: { tempC: 28, humidity: 72, rainMm: 0, condition: "ცხელი და მშრალი" },
  kutaisi: { tempC: 24, humidity: 84, rainMm: 6, condition: "ტენიანი და წვიმიანი" },
  batumi: { tempC: 23, humidity: 90, rainMm: 12, condition: "ძალიან ტენიანი" },
  default: { tempC: 26, humidity: 70, rainMm: 2, condition: "თბილი ამინდი" }
};

const georgiaCityCoordinates = {
  "თბილისი": { latitude: 41.7151, longitude: 44.8271 },
  tbilisi: { latitude: 41.7151, longitude: 44.8271 },
  "ქუთაისი": { latitude: 42.2679, longitude: 42.6946 },
  kutaisi: { latitude: 42.2679, longitude: 42.6946 },
  "ბათუმი": { latitude: 41.6168, longitude: 41.6367 },
  batumi: { latitude: 41.6168, longitude: 41.6367 },
  "რუსთავი": { latitude: 41.5495, longitude: 44.9932 },
  rustavi: { latitude: 41.5495, longitude: 44.9932 },
  "ზუგდიდი": { latitude: 42.5113, longitude: 41.8709 },
  zugdidi: { latitude: 42.5113, longitude: 41.8709 },
  "თელავი": { latitude: 41.9175, longitude: 45.4742 },
  telavi: { latitude: 41.9175, longitude: 45.4742 },
  "გორი": { latitude: 41.9855, longitude: 44.1131 },
  gori: { latitude: 41.9855, longitude: 44.1131 },
  "ახალციხე": { latitude: 41.6401, longitude: 42.9841 },
  akhaltsikhe: { latitude: 41.6401, longitude: 42.9841 },
  "ოზურგეთი": { latitude: 41.9197, longitude: 42.0079 },
  ozurgeti: { latitude: 41.9197, longitude: 42.0079 },
  "სამტრედია": { latitude: 42.1553, longitude: 42.3394 },
  samtredia: { latitude: 42.1553, longitude: 42.3394 },
  "სენაკი": { latitude: 42.2681, longitude: 42.0587 },
  senaki: { latitude: 42.2681, longitude: 42.0587 },
  "ზესტაფონი": { latitude: 42.1081, longitude: 43.0465 },
  zestaponi: { latitude: 42.1081, longitude: 43.0465 },
  "მარნეული": { latitude: 41.4636, longitude: 44.8026 },
  marneuli: { latitude: 41.4636, longitude: 44.8026 },
  "ხაშური": { latitude: 41.9948, longitude: 43.5927 },
  khashuri: { latitude: 41.9948, longitude: 43.5927 },
  "ბოლნისი": { latitude: 41.4459, longitude: 44.5288 },
  bolnisi: { latitude: 41.4459, longitude: 44.5288 },
  "სიღნაღი": { latitude: 41.6207, longitude: 45.9194 },
  signagi: { latitude: 41.6207, longitude: 45.9194 },
  "ლაგოდეხი": { latitude: 41.8279, longitude: 46.2756 },
  lagodekhi: { latitude: 41.8279, longitude: 46.2756 },
  "გურჯაანი": { latitude: 41.7432, longitude: 45.7952 },
  gurjaani: { latitude: 41.7432, longitude: 45.7952 },
  "კახი": { latitude: 41.6358, longitude: 46.2891 },
  kakheti: { latitude: 41.6358, longitude: 46.2891 }
};

function weatherCodeToText(code) {
  const map = {
    0: "მოწმენდილი ცა",
    1: "ძირითადად მოწმენდილი",
    2: "ნაწილობრივ მოღრუბლული",
    3: "ღრუბლიანი",
    45: "ნისლი",
    48: "ინელი ნისლი",
    51: "სუსტი ჟინჟღლი",
    53: "ჟინჟღლი",
    55: "ძლიერი ჟინჟღლი",
    61: "სუსტი წვიმა",
    63: "წვიმა",
    65: "ძლიერი წვიმა",
    71: "სუსტი თოვა",
    73: "თოვა",
    75: "ძლიერი თოვა",
    95: "ჭექა-ქუხილი"
  };
  return map[code] || "ცვალებადი პირობები";
}

const harvestDaysByCrop = {
  maize:      { min: 90,  max: 120 },
  wheat:      { min: 110, max: 130 },
  tomato:     { min: 70,  max: 100 },
  potato:     { min: 80,  max: 110 },
  rice:       { min: 110, max: 150 },
  vine:       { min: 140, max: 180 },
  nuts:       { min: 150, max: 200 },
  sunflower:  { min: 80,  max: 110 },
  onion:      { min: 90,  max: 120 },
  garlic:     { min: 90,  max: 110 },
  pepper:     { min: 70,  max: 100 },
  cucumber:   { min: 45,  max: 65  },
  watermelon: { min: 70,  max: 90  },
  cabbage:    { min: 70,  max: 100 },
  carrot:     { min: 70,  max: 100 },
  strawberry: { min: 30,  max: 60  },
  apple:      { min: 130, max: 180 },
  peach:      { min: 90,  max: 130 },
  bean:       { min: 55,  max: 80  }
};

function estimateHarvestDate(crop, plantingDate) {
  const h = harvestDaysByCrop[crop] || { min: 90, max: 120 };
  const planting = new Date(plantingDate);
  const midDays = Math.round((h.min + h.max) / 2);
  const earliest = new Date(planting); earliest.setDate(planting.getDate() + h.min);
  const latest   = new Date(planting); latest.setDate(planting.getDate() + h.max);
  const fmt = (d) => new Intl.DateTimeFormat("ka-GE", { day: "numeric", month: "long" }).format(d);
  const today = new Date();
  const daysLeft = Math.ceil((new Date(planting.getTime() + midDays * 86400000) - today) / 86400000);
  return { earliest: fmt(earliest), latest: fmt(latest), daysLeft };
}

const growthByCrop = {
  maize: [
    { maxDay: 10, stage: "გაღივება" },
    { maxDay: 35, stage: "ვეგეტაცია" },
    { maxDay: 65, stage: "ყვავილობა" },
    { maxDay: 110, stage: "მარცვლის შევსება" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  wheat: [
    { maxDay: 12, stage: "გაღივება" },
    { maxDay: 40, stage: "კოკრიანობა" },
    { maxDay: 75, stage: "ღეროს ზრდა" },
    { maxDay: 110, stage: "თავთავის გამოსვლა" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  tomato: [
    { maxDay: 14, stage: "ჩითილი" },
    { maxDay: 40, stage: "ვეგეტაცია" },
    { maxDay: 70, stage: "ყვავილობა" },
    { maxDay: 100, stage: "ნაყოფის შეკვრა" },
    { maxDay: 9999, stage: "მოსავლის აღება" }
  ],
  potato: [
    { maxDay: 12, stage: "აღმონაცენი" },
    { maxDay: 35, stage: "ვეგეტაცია" },
    { maxDay: 60, stage: "ტუბერის წარმოქმნა" },
    { maxDay: 90, stage: "ტუბერის ზრდა" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  rice: [
    { maxDay: 15, stage: "ჩითილი" },
    { maxDay: 45, stage: "კოკრიანობა" },
    { maxDay: 75, stage: "თავთავის ფორმირება" },
    { maxDay: 105, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  vine: [
    { maxDay: 25, stage: "კვირტის გაშლა" },
    { maxDay: 60, stage: "ვეგეტაცია" },
    { maxDay: 95, stage: "ყვავილობა" },
    { maxDay: 130, stage: "მტევნის ზრდა" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  nuts: [
    { maxDay: 25, stage: "კვირტის გაშლა" },
    { maxDay: 70, stage: "ვეგეტაცია" },
    { maxDay: 110, stage: "ყვავილობა/ნაყოფის შეკვრა" },
    { maxDay: 150, stage: "ნაყოფის შევსება" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  sunflower: [
    { maxDay: 10, stage: "გაღივება" },
    { maxDay: 35, stage: "ვეგეტაცია" },
    { maxDay: 65, stage: "კვირტის წარმოქმნა" },
    { maxDay: 90, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  onion: [
    { maxDay: 15, stage: "გაღივება" },
    { maxDay: 45, stage: "ვეგეტაცია" },
    { maxDay: 80, stage: "ბოლქვის წარმოქმნა" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  garlic: [
    { maxDay: 15, stage: "გაღივება" },
    { maxDay: 50, stage: "ვეგეტაცია" },
    { maxDay: 80, stage: "კბილების წარმოქმნა" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  pepper: [
    { maxDay: 14, stage: "ჩითილი" },
    { maxDay: 40, stage: "ვეგეტაცია" },
    { maxDay: 65, stage: "ყვავილობა" },
    { maxDay: 90, stage: "ნაყოფის შეკვრა" },
    { maxDay: 9999, stage: "მოსავლის აღება" }
  ],
  cucumber: [
    { maxDay: 10, stage: "გაღივება" },
    { maxDay: 25, stage: "ვეგეტაცია" },
    { maxDay: 40, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "მოსავლის აღება" }
  ],
  watermelon: [
    { maxDay: 12, stage: "გაღივება" },
    { maxDay: 35, stage: "ვეგეტაცია" },
    { maxDay: 55, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "ნაყოფის სიმწიფე" }
  ],
  cabbage: [
    { maxDay: 14, stage: "ჩითილი" },
    { maxDay: 40, stage: "ვეგეტაცია" },
    { maxDay: 70, stage: "თავის წარმოქმნა" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  carrot: [
    { maxDay: 14, stage: "გაღივება" },
    { maxDay: 45, stage: "ვეგეტაცია" },
    { maxDay: 75, stage: "ძირის გასქელება" },
    { maxDay: 9999, stage: "სიმწიფე" }
  ],
  strawberry: [
    { maxDay: 14, stage: "ადაპტაცია" },
    { maxDay: 30, stage: "ვეგეტაცია" },
    { maxDay: 45, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "ნაყოფის სიმწიფე" }
  ],
  apple: [
    { maxDay: 30, stage: "კვირტის გაშლა" },
    { maxDay: 70, stage: "ყვავილობა" },
    { maxDay: 120, stage: "ნაყოფის ზრდა" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  peach: [
    { maxDay: 25, stage: "კვირტის გაშლა" },
    { maxDay: 60, stage: "ყვავილობა" },
    { maxDay: 100, stage: "ნაყოფის ზრდა" },
    { maxDay: 9999, stage: "მომწიფება" }
  ],
  bean: [
    { maxDay: 10, stage: "გაღივება" },
    { maxDay: 30, stage: "ვეგეტაცია" },
    { maxDay: 50, stage: "ყვავილობა" },
    { maxDay: 9999, stage: "მოსავლის აღება" }
  ]
};

const gddByCrop = {
  maize: {
    baseTemp: 10,
    stages: [
      { maxGdd: 120, stage: "გაღივება" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 850, stage: "ყვავილობა" },
      { maxGdd: 1200, stage: "მარცვლის შევსება" },
      { maxGdd: 9999, stage: "სიმწიფე" }
    ]
  },
  wheat: {
    baseTemp: 5,
    stages: [
      { maxGdd: 100, stage: "გაღივება" },
      { maxGdd: 450, stage: "კოკრიანობა" },
      { maxGdd: 800, stage: "ღეროს ზრდა" },
      { maxGdd: 1100, stage: "თავთავის გამოსვლა" },
      { maxGdd: 9999, stage: "მომწიფება" }
    ]
  },
  tomato: {
    baseTemp: 10,
    stages: [
      { maxGdd: 150, stage: "ჩითილი" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 850, stage: "ყვავილობა" },
      { maxGdd: 1200, stage: "ნაყოფის შეკვრა" },
      { maxGdd: 9999, stage: "მოსავლის აღება" }
    ]
  },
  potato: {
    baseTemp: 7,
    stages: [
      { maxGdd: 120, stage: "აღმონაცენი" },
      { maxGdd: 420, stage: "ვეგეტაცია" },
      { maxGdd: 750, stage: "ტუბერის წარმოქმნა" },
      { maxGdd: 1000, stage: "ტუბერის ზრდა" },
      { maxGdd: 9999, stage: "სიმწიფე" }
    ]
  },
  rice: {
    baseTemp: 10,
    stages: [
      { maxGdd: 180, stage: "ჩითილი" },
      { maxGdd: 500, stage: "კოკრიანობა" },
      { maxGdd: 850, stage: "თავთავის ფორმირება" },
      { maxGdd: 1150, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "მომწიფება" }
    ]
  },
  vine: {
    baseTemp: 10,
    stages: [
      { maxGdd: 220, stage: "კვირტის გაშლა" },
      { maxGdd: 650, stage: "ვეგეტაცია" },
      { maxGdd: 980, stage: "ყვავილობა" },
      { maxGdd: 1300, stage: "მტევნის ზრდა" },
      { maxGdd: 9999, stage: "მომწიფება" }
    ]
  },
  nuts: {
    baseTemp: 8,
    stages: [
      { maxGdd: 200, stage: "კვირტის გაშლა" },
      { maxGdd: 620, stage: "ვეგეტაცია" },
      { maxGdd: 980, stage: "ყვავილობა/ნაყოფის შეკვრა" },
      { maxGdd: 1300, stage: "ნაყოფის შევსება" },
      { maxGdd: 9999, stage: "მომწიფება" }
    ]
  },
  sunflower: {
    baseTemp: 8,
    stages: [
      { maxGdd: 100, stage: "გაღივება" },
      { maxGdd: 450, stage: "ვეგეტაცია" },
      { maxGdd: 750, stage: "კვირტის წარმოქმნა" },
      { maxGdd: 9999, stage: "ყვავილობა/სიმწიფე" }
    ]
  },
  onion: {
    baseTemp: 7,
    stages: [
      { maxGdd: 130, stage: "გაღივება" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 9999, stage: "ბოლქვის სიმწიფე" }
    ]
  },
  garlic: {
    baseTemp: 5,
    stages: [
      { maxGdd: 120, stage: "გაღივება" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 9999, stage: "კბილების სიმწიფე" }
    ]
  },
  pepper: {
    baseTemp: 10,
    stages: [
      { maxGdd: 150, stage: "ჩითილი" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 800, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "ნაყოფის სიმწიფე" }
    ]
  },
  cucumber: {
    baseTemp: 10,
    stages: [
      { maxGdd: 100, stage: "გაღივება" },
      { maxGdd: 350, stage: "ვეგეტაცია" },
      { maxGdd: 9999, stage: "მოსავლის აღება" }
    ]
  },
  watermelon: {
    baseTemp: 10,
    stages: [
      { maxGdd: 120, stage: "გაღივება" },
      { maxGdd: 450, stage: "ვეგეტაცია" },
      { maxGdd: 750, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "ნაყოფის სიმწიფე" }
    ]
  },
  cabbage: {
    baseTemp: 5,
    stages: [
      { maxGdd: 130, stage: "ჩითილი" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 9999, stage: "თავის სიმწიფე" }
    ]
  },
  carrot: {
    baseTemp: 7,
    stages: [
      { maxGdd: 130, stage: "გაღივება" },
      { maxGdd: 500, stage: "ვეგეტაცია" },
      { maxGdd: 9999, stage: "ძირის სიმწიფე" }
    ]
  },
  strawberry: {
    baseTemp: 5,
    stages: [
      { maxGdd: 100, stage: "ადაპტაცია" },
      { maxGdd: 300, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "ნაყოფის სიმწიფე" }
    ]
  },
  apple: {
    baseTemp: 5,
    stages: [
      { maxGdd: 250, stage: "კვირტის გაშლა" },
      { maxGdd: 700, stage: "ყვავილობა" },
      { maxGdd: 1200, stage: "ნაყოფის ზრდა" },
      { maxGdd: 9999, stage: "მომწიფება" }
    ]
  },
  peach: {
    baseTemp: 7,
    stages: [
      { maxGdd: 220, stage: "კვირტის გაშლა" },
      { maxGdd: 600, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "ნაყოფის სიმწიფე" }
    ]
  },
  bean: {
    baseTemp: 10,
    stages: [
      { maxGdd: 100, stage: "გაღივება" },
      { maxGdd: 350, stage: "ვეგეტაცია" },
      { maxGdd: 600, stage: "ყვავილობა" },
      { maxGdd: 9999, stage: "მოსავლის აღება" }
    ]
  }
};

function daysSincePlanting(plantingDate) {
  const start = new Date(plantingDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function getStage(crop, dayCount) {
  const stages = growthByCrop[crop] || growthByCrop.maize;
  return stages.find((s) => dayCount <= s.maxDay)?.stage || "უცნობია";
}

function getWeather(location) {
  const key = location.trim().toLowerCase();
  return mockWeatherByLocation[key] || mockWeatherByLocation.default;
}

function normalizeLocation(input) {
  return String(input || "").trim().toLowerCase();
}

async function geocodeLocation(name, language) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
    `&count=1&language=${language}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const place = data?.results?.[0];
  if (!place) return null;
  return { latitude: place.latitude, longitude: place.longitude };
}

async function fetchCoordinates(location) {
  const normalized = normalizeLocation(location);
  if (georgiaCityCoordinates[normalized]) return georgiaCityCoordinates[normalized];

  const kaResult = await geocodeLocation(location, "ka");
  if (kaResult) return kaResult;

  const enResult = await geocodeLocation(location, "en");
  if (enResult) return enResult;

  throw new Error("მდებარეობა ვერ მოიძებნა");
}

async function fetchLiveWeather(location) {
  const place = await fetchCoordinates(location);
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
    `&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=auto&forecast_days=7`;

  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) throw new Error("Weather request failed");

  const weatherData = await weatherRes.json();
  const current = weatherData.current || {};
  const daily = weatherData.daily || {};

  const forecast = (daily.time || []).map((date, i) => ({
    date,
    code:   Number(daily.weather_code?.[i] ?? 0),
    maxC:   Number(daily.temperature_2m_max?.[i] ?? 0),
    minC:   Number(daily.temperature_2m_min?.[i] ?? 0),
    rainMm: Number(daily.precipitation_sum?.[i] ?? 0),
  }));

  return {
    tempC: Number(current.temperature_2m ?? 26),
    humidity: Number(current.relative_humidity_2m ?? 70),
    rainMm: Number(daily.precipitation_sum?.[0] ?? 0),
    condition: weatherCodeToText(Number(current.weather_code ?? 2)),
    source: "ამჟამინდელი ამინდი",
    forecast
  };
}

function weatherCodeToEmoji(code) {
  if (code === 0 || code === 1) return "☀️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

function renderForecast(forecast) {
  const container = document.getElementById("forecast-strip");
  if (!container || !forecast?.length) return;

  const days = ["კვი", "ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ"];

  container.innerHTML = forecast.slice(0, 7).map((day, i) => {
    const date = new Date(day.date);
    const label = i === 0 ? "დღეს" : days[date.getDay()];
    return `
      <div class="forecast-day">
        <span class="forecast-label">${label}</span>
        <span class="forecast-icon">${weatherCodeToEmoji(day.code)}</span>
        <span class="forecast-temp">${Math.round(day.maxC)}°</span>
        <span class="forecast-min">${Math.round(day.minC)}°</span>
        ${day.rainMm > 0 ? `<span class="forecast-rain">💧${Math.round(day.rainMm)}მმ</span>` : '<span class="forecast-rain"></span>'}
      </div>`;
  }).join("");
}

async function fetchAccumulatedGdd(location, plantingDate, baseTemp) {
  const coords = await fetchCoordinates(location);
  const endDate = new Date().toISOString().slice(0, 10);
  const archiveUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.latitude}` +
    `&longitude=${coords.longitude}` +
    `&start_date=${plantingDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;

  const res = await fetch(archiveUrl);
  if (!res.ok) throw new Error("Archive weather request failed");
  const data = await res.json();

  const tMax = data?.daily?.temperature_2m_max || [];
  const tMin = data?.daily?.temperature_2m_min || [];
  if (!tMax.length || !tMin.length || tMax.length !== tMin.length) {
    throw new Error("Invalid archive weather data");
  }

  let totalGdd = 0;
  for (let i = 0; i < tMax.length; i += 1) {
    const mean = (Number(tMax[i]) + Number(tMin[i])) / 2;
    totalGdd += Math.max(0, mean - baseTemp);
  }
  return Math.round(totalGdd);
}

function getStageByGdd(crop, gdd) {
  const config = gddByCrop[crop] || gddByCrop.maize;
  return config.stages.find((s) => gdd <= s.maxGdd)?.stage || "უცნობია";
}

function buildAdvice(crop, dayCount, weather, farmSize) {
  const stage = getStage(crop, dayCount);

  let watering = "შეინარჩუნეთ ნიადაგის საშუალო ტენიანობა და ყოველდღე შეამოწმეთ ნაკვეთი.";
  if (weather.tempC >= 30 || weather.rainMm === 0) {
    watering = "მორწყვის სიხშირე გაზარდეთ; ნიადაგის ტენიანობა დილით და საღამოს შეამოწმეთ.";
  } else if (weather.rainMm >= 8) {
    watering = "დღეს მორწყვა შეამცირეთ წვიმის გამო; მოერიდეთ გადაჭარბებულ დატბორვას.";
  }

  let risk = "დაბალი";
  if (weather.humidity >= 85) risk = "მაღალი";
  else if (weather.humidity >= 75) risk = "საშუალო";

  let spraying = "ახლავე შეწამვლა საჭირო არ არის. განაგრძეთ ნაკვეთის მონიტორინგი.";
  if (risk === "მაღალი") {
    spraying = "მაღალი ტენიანობის რისკია: დაათვალიერეთ ფოთლები და სიმპტომებისას გამოიყენეთ პროფილაქტიკური ფუნგიციდი.";
  } else if (risk === "საშუალო") {
    spraying = "აკონტროლეთ სოკოს ადრეული ნიშნები; შეწამვლამდე უზრუნველყავით ჰაერის ცირკულაცია.";
  }

  const alert =
    risk === "მაღალი"
      ? "გაფრთხილება: დღეს დაავადების რისკი მაღალია. პირველ რიგში შეამოწმეთ ხშირი ზონები."
      : weather.tempC >= 30
      ? "გაფრთხილება: შუადღით მოსალოდნელია სითბური სტრესი. პიკის დროს მორწყვას მოერიდეთ."
      : "გაფრთხილება: პირობები სტაბილურია. გააგრძელეთ რეგულარული მონიტორინგი.";

  const fertilizerByCrop = {
    maize: {
      "გაღივება": "NPK 10-20-20 მცირე დოზით, რიგებს შორის.",
      "ვეგეტაცია": "აზოტოვანი სასუქი (ურეა/ამონიუმის ნიტრატი) ნორმის მიხედვით.",
      "ყვავილობა": "კალიუმის დამატება მცენარის გამძლეობისთვის.",
      "მარცვლის შევსება": "ფოსფორ-კალიუმიანი კვება საჭიროების მიხედვით.",
      "სიმწიფე": "ახალი სასუქი აღარ დაამატოთ."
    },
    wheat: {
      "გაღივება": "სტარტერული NPK მცირე დოზით.",
      "კოკრიანობა": "აზოტოვანი გამოკვება (ტოპდრესინგი).",
      "ღეროს ზრდა": "აზოტის მეორე დოზა ნორმის ფარგლებში.",
      "თავთავის გამოსვლა": "კალიუმის მხარდაჭერა, ზედმეტი აზოტის გარეშე.",
      "მომწიფება": "სასუქის შეწყვეტა."
    },
    tomato: {
      "ჩითილი": "ფესვის სტიმულაციისთვის ფოსფორიანი სტარტერი.",
      "ვეგეტაცია": "ბალანსირებული NPK + მიკროელემენტები.",
      "ყვავილობა": "ბორი/კალიუმი ყვავილობის მხარდაჭერისთვის.",
      "ნაყოფის შეკვრა": "კალიუმით მდიდარი კვება ნაყოფის ზრდისთვის.",
      "მოსავლის აღება": "მსუბუქი კვება საჭიროებისამებრ."
    },
    potato: {
      "აღმონაცენი": "ფოსფორიანი სტარტერული კვება.",
      "ვეგეტაცია": "ბალანსირებული NPK ზომიერი აზოტით.",
      "ტუბერის წარმოქმნა": "კალიუმის გაზრდა ტუბერის განვითარებისთვის.",
      "ტუბერის ზრდა": "კალიუმი + კალციუმი ხარისხისთვის.",
      "სიმწიფე": "კვების შეზღუდვა."
    },
    rice: {
      "ჩითილი": "სტარტერული აზოტ-ფოსფორი.",
      "კოკრიანობა": "აზოტის ძირითადი დოზა.",
      "თავთავის ფორმირება": "კალიუმის მხარდაჭერა.",
      "ყვავილობა": "საშუალო კვება სტრესის თავიდან ასაცილებლად.",
      "მომწიფება": "ახალი სასუქი არ არის საჭირო."
    },
    vine: {
      "კვირტის გაშლა": "აზოტის მცირე დოზა ზრდის დასაწყისში.",
      "ვეგეტაცია": "ბალანსირებული NPK + მაგნიუმი.",
      "ყვავილობა": "ბორი/თუთია ყვავილობის გასაძლიერებლად.",
      "მტევნის ზრდა": "კალიუმით მდიდარი კვება შაქრიანობისთვის.",
      "მომწიფება": "აზოტი შეამცირეთ, კალიუმი შეინარჩუნეთ ზომიერად."
    },
    nuts: {
      "კვირტის გაშლა": "აზოტის მსუბუქი სტარტერი.",
      "ვეგეტაცია": "NPK + კალციუმი ფესვისა და ყლორტის გასაძლიერებლად.",
      "ყვავილობა/ნაყოფის შეკვრა": "ბორი და კალიუმი ნაყოფის შეკვრისთვის.",
      "ნაყოფის შევსება": "კალიუმი + მიკროელემენტები ნაყოფის ხარისხისთვის.",
      "მომწიფება": "კვება შეზღუდეთ, ყურადღება მიაქციეთ ტენიანობას."
    },
    sunflower: {
      "გაღივება": "სტარტერული NPK 10-20-20 მცირე დოზით.",
      "ვეგეტაცია": "აზოტოვანი კვება (ამონიუმის ნიტრატი) ზრდის დასაჩქარებლად.",
      "კვირტის წარმოქმნა": "ბორი + კალიუმი ყვავილობის მხარდაჭერისთვის.",
      "ყვავილობა/სიმწიფე": "სასუქის შეწყვეტა, ტენიანობის კონტროლი."
    },
    onion: {
      "გაღივება": "ფოსფორიანი სტარტერი ფესვის განვითარებისთვის.",
      "ვეგეტაცია": "ბალანსირებული NPK + გოგირდი ბოლქვის ხარისხისთვის.",
      "ბოლქვის წარმოქმნა": "კალიუმის გაზრდა, აზოტის შემცირება.",
      "სიმწიფე": "სასუქი შეწყვიტეთ — ბოლქვის გამხმობა."
    },
    garlic: {
      "გაღივება": "ფოსფორ-კალიუმიანი სტარტერი.",
      "ვეგეტაცია": "აზოტოვანი კვება ფოთლოვანი მასის ზრდისთვის.",
      "კბილების წარმოქმნა": "კალიუმი + გოგირდი კბილების შევსებისთვის.",
      "სიმწიფე": "კვება შეწყვიტეთ."
    },
    pepper: {
      "ჩითილი": "ფოსფორიანი სტარტერი + კალციუმი.",
      "ვეგეტაცია": "ბალანსირებული NPK + მაგნიუმი ფოთლოვანი კვებით.",
      "ყვავილობა": "ბორი + კალიუმი ყვავილობის შეკვრისთვის.",
      "ნაყოფის შეკვრა": "კალიუმით მდიდარი კვება, კალციუმი სიდამპლის წინააღმდეგ.",
      "მოსავლის აღება": "მსუბუქი კვება, ძირითადად კალიუმი."
    },
    cucumber: {
      "გაღივება": "სტარტერული NPK მცირე დოზით.",
      "ვეგეტაცია": "აზოტ-კალიუმიანი კვება სწრაფი ზრდისთვის.",
      "ყვავილობა": "კალიუმი + ბორი ნაყოფის შეკვრისთვის.",
      "მოსავლის აღება": "კალიუმი + მიკროელემენტები ნაყოფის ხარისხისთვის."
    },
    watermelon: {
      "გაღივება": "ფოსფორიანი სტარტერი.",
      "ვეგეტაცია": "ბალანსირებული NPK + მაგნიუმი.",
      "ყვავილობა": "კალიუმი + ბორი ნაყოფის შეკვრისთვის.",
      "ნაყოფის სიმწიფე": "კალიუმი შაქრიანობისთვის, აზოტი შეამცირეთ."
    },
    cabbage: {
      "ჩითილი": "ფოსფორიანი სტარტერი + კალციუმი.",
      "ვეგეტაცია": "აზოტოვანი კვება (ამონიუმის ნიტრატი) თავის ზრდისთვის.",
      "თავის წარმოქმნა": "კალიუმი + კალციუმი სიმკვრივისთვის.",
      "სიმწიფე": "კვება შეწყვიტეთ."
    },
    carrot: {
      "გაღივება": "ფოსფორიანი სტარტერი, მცირე აზოტი.",
      "ვეგეტაცია": "ბალანსირებული NPK + ბორი.",
      "ძირის გასქელება": "კალიუმი + ფოსფორი ძირის ხარისხისთვის.",
      "სიმწიფე": "კვება შეწყვიტეთ."
    },
    strawberry: {
      "ადაპტაცია": "ფოსფორიანი სტარტერი ფესვის განვითარებისთვის.",
      "ყვავილობა": "კალიუმი + ბორი ყვავილობის მხარდაჭერისთვის.",
      "ნაყოფის სიმწიფე": "კალიუმით მდიდარი კვება გემოსთვის, აზოტი მინიმალური."
    },
    apple: {
      "კვირტის გაშლა": "აზოტის მცირე დოზა ზრდის დასაწყისში.",
      "ყვავილობა": "ბორი + კალციუმი ნაყოფის შეკვრისთვის.",
      "ნაყოფის ზრდა": "კალიუმი + კალციუმი ნაყოფის ხარისხისთვის.",
      "მომწიფება": "კვება შეწყვიტეთ."
    },
    peach: {
      "კვირტის გაშლა": "აზოტის მცირე დოზა.",
      "ყვავილობა": "ბორი + კალციუმი.",
      "ნაყოფის ზრდა": "კალიუმი + მიკროელემენტები ნაყოფის ხარისხისთვის.",
      "ნაყოფის სიმწიფე": "კვება შეწყვიტეთ."
    },
    bean: {
      "გაღივება": "ფოსფორიანი სტარტერი, აზოტი მინიმალური (ლობიო თვითონ ამდიდრებს).",
      "ვეგეტაცია": "კალიუმი + ფოსფორი, ნაკლები აზოტი.",
      "ყვავილობა": "ბორი + კალიუმი პარკის შეკვრისთვის.",
      "მოსავლის აღება": "კვება შეწყვიტეთ."
    }
  };

  let fertilizer =
    fertilizerByCrop[crop]?.[stage] || "გამოიყენეთ ბალანსირებული NPK მცირე დოზით და ნიადაგის ანალიზის მიხედვით.";

  if (farmSize && farmSize > 0) {
    const dosagePerHa = { maize: 150, wheat: 120, tomato: 180, potato: 160, rice: 140,
      vine: 80, nuts: 70, sunflower: 130, onion: 150, garlic: 120, pepper: 160,
      cucumber: 140, watermelon: 120, cabbage: 160, carrot: 130, strawberry: 100,
      apple: 90, peach: 90, bean: 80 };
    const kgPerHa = dosagePerHa[crop] || 120;
    const total = Math.round(kgPerHa * farmSize);
    fertilizer += ` (სულ ${farmSize} ჰა → ~${total} კგ)`;
  }

  let pesticide = "დღეს ქიმიური ჩარევა არ არის საჭირო, გააგრძელეთ მონიტორინგი.";
  if (risk === "მაღალი") {
    pesticide =
      "რეკომენდებულია კონტაქტური ან სისტემური ფუნგიციდის პროფილაქტიკური გამოყენება ეტიკეტის ინსტრუქციის დაცვით.";
  } else if (risk === "საშუალო") {
    pesticide = "დაიწყეთ ბიოფუნგიციდით/მსუბუქი პროფილაქტიკით და დააკვირდით სიმპტომებს 24-48 საათში.";
  }

  if (weather.tempC >= 32) {
    fertilizer += " მაღალი ტემპერატურის დროს ფოთლოვანი კვება საღამოს საათებში დაგეგმეთ.";
  }

  return { stage, watering, risk, spraying, fertilizer, pesticide, alert };
}

async function renderDashboard(data) {
  let weather;
  let gdd;
  let stageText;

  const submitBtn = setupForm.querySelector("button[type='submit']");
  const locationError = document.getElementById("location-error");

  if (submitBtn) {
    submitBtn.textContent = "იტვირთება...";
    submitBtn.disabled = true;
  }
  if (locationError) locationError.classList.add("hidden");

  setSyncBadge();

  try {
    weather = await fetchLiveWeather(data.location);
  } catch (err) {
    if (submitBtn) {
      submitBtn.textContent = "დაწყება →";
      submitBtn.disabled = false;
    }
    if (err.message === "მდებარეობა ვერ მოიძებნა" && locationError) {
      locationError.textContent = "⚠ მდებარეობა ვერ მოიძებნა. სცადეთ სხვა სახელი (მაგ.: Telavi).";
      locationError.classList.remove("hidden");
      return;
    }
    weather = { ...getWeather(data.location), source: "სავარაუდო ამინდი" };
  }

  const dayCount = daysSincePlanting(data.plantingDate);
  try {
    const baseTemp = (gddByCrop[data.crop] || gddByCrop.maize).baseTemp;
    gdd = await fetchAccumulatedGdd(data.location, data.plantingDate, baseTemp);
    stageText = `${getStageByGdd(data.crop, gdd)} (GDD ${gdd})`;
  } catch (_) {
    stageText = `${getStage(data.crop, dayCount)} (დათესვიდან ${dayCount} დღე)`;
  }

  const advice = buildAdvice(data.crop, dayCount, weather, data.farmSize || 0);

  const harvest = estimateHarvestDate(data.crop, data.plantingDate);
  const harvestEl = document.getElementById("out-harvest");
  if (harvestEl) {
    if (harvest.daysLeft > 0) {
      harvestEl.textContent = `${harvest.earliest} — ${harvest.latest} (კიდევ ~${harvest.daysLeft} დღე)`;
    } else {
      harvestEl.textContent = `${harvest.earliest} — ${harvest.latest} (მოსავლის აღების პერიოდი)`;
    }
  }

  renderForecast(weather.forecast);

  const farmSizeBlock = document.getElementById("farm-size-block");
  const outFarmSize = document.getElementById("out-farm-size");
  if (data.farmSize && data.farmSize > 0) {
    outFarmSize.textContent = `${data.farmSize} ჰა`;
    farmSizeBlock.style.display = "";
  } else {
    farmSizeBlock.style.display = "none";
  }

  outCrop.textContent = cropLabelsKa[data.crop] || data.crop;
  outLocation.textContent = data.location;
  outWeather.textContent =
    `${weather.condition} (${weather.tempC}°C, ტენიანობა ${weather.humidity}%, ნალექი ${weather.rainMm} მმ) - ${weather.source}`;
  outStage.textContent = stageText;
  outWatering.textContent = advice.watering;
  outRisk.textContent = advice.risk;
  outRisk.dataset.level = advice.risk;
  outSpraying.textContent = advice.spraying;
  outFertilizer.textContent = advice.fertilizer;
  outPesticide.textContent = advice.pesticide;
  outAlert.textContent = advice.alert;

  if (submitBtn) {
    submitBtn.textContent = "დაწყება →";
    submitBtn.disabled = false;
  }

  setupPanel.classList.add("hidden");
  dashboardPanel.classList.remove("hidden");
  chatToggle.classList.remove("hidden");
  startAutoRefresh();
  void initNotifications(advice);
  scheduleMorningEmail();
}

document.getElementById("whatsapp-btn").addEventListener("click", () => {
  const lines = [
    `🌱 SmartFarm — ${new Intl.DateTimeFormat("ka-GE", { day: "numeric", month: "long", year: "numeric" }).format(new Date())}`,
    `კულტურა: ${document.getElementById("out-crop").textContent} — ${document.getElementById("out-location").textContent}`,
    `ამინდი: ${document.getElementById("out-weather").textContent}`,
    `🌿 ზრდის ფაზა: ${document.getElementById("out-stage").textContent}`,
    `🌾 მოსავალი: ${document.getElementById("out-harvest").textContent}`,
    `💧 მორწყვა: ${document.getElementById("out-watering").textContent}`,
    `🦠 დაავადების რისკი: ${document.getElementById("out-risk").textContent}`,
    `⚠ ${document.getElementById("out-alert").textContent}`,
  ];
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
});

document.getElementById("clear-history-btn").addEventListener("click", () => {
  if (!confirm("ჩანაწერების გასუფთავება?")) return;
  const data = JSON.parse(localStorage.getItem(getSetupStorageKey()) || "null");
  localStorage.removeItem(getTaskStorageKey());
  if (data) writeLocalTaskHistory([]);
  renderTaskHistory([]);
});

// ── Field switcher UI ──
const fieldSwitcher = document.getElementById("field-switcher");
const fieldSelect   = document.getElementById("field-select");

function renderFieldSwitcher() {
  const fields = loadFields();
  if (fields.length === 0) {
    fieldSwitcher.classList.add("hidden");
    return;
  }
  fieldSwitcher.classList.remove("hidden");
  const activeId = getActiveFieldId();
  fieldSelect.innerHTML = fields.map(f =>
    `<option value="${f.id}" ${f.id === activeId ? "selected" : ""}>${f.name}</option>`
  ).join("");
}

fieldSelect.addEventListener("change", async () => {
  setActiveFieldId(fieldSelect.value);
  await reloadDataForCurrentScope();
});

document.getElementById("add-field-btn").addEventListener("click", async () => {
  const name = prompt("ახალი ნაკვეთის სახელი:", `ნაკვეთი ${loadFields().length + 1}`);
  if (!name) return;
  createField(name.trim());
  renderFieldSwitcher();
  const saved = await loadSetup();
  if (saved) {
    await renderDashboard(saved);
  } else {
    dashboardPanel.classList.add("hidden");
    setupPanel.classList.remove("hidden");
  }
});

document.getElementById("delete-field-btn").addEventListener("click", async () => {
  const fields = loadFields();
  if (fields.length <= 1) { alert("ბოლო ნაკვეთის წაშლა არ შეიძლება."); return; }
  const active = fields.find(f => f.id === getActiveFieldId());
  if (!confirm(`წაიშალოს "${active?.name}"?`)) return;
  deleteField(getActiveFieldId());
  renderFieldSwitcher();
  await reloadDataForCurrentScope();
});

document.getElementById("today-btn").addEventListener("click", () => {
  document.getElementById("planting-date").value = new Date().toISOString().slice(0, 10);
});

setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(setupForm);
  const data = {
    crop: String(formData.get("crop") || "").trim(),
    location: String(formData.get("location") || "").trim(),
    plantingDate: String(formData.get("plantingDate") || "").trim(),
    farmSize: parseFloat(formData.get("farmSize") || "0") || 0
  };

  if (!data.crop || !data.location || !data.plantingDate) return;

  // Create a field if none exist yet
  if (loadFields().length === 0) {
    const cropName = cropLabelsKa[data.crop] || data.crop;
    createField(`${cropName} — ${data.location}`);
  }

  await saveSetup(data);
  renderFieldSwitcher();
  await renderDashboard(data);
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = String(authEmail.value || "").trim();
  if (!email) return;
  await sendLoginLink(email);
});

logoutBtn.addEventListener("click", async () => {
  await logout();
});

editBtn.addEventListener("click", async () => {
  const saved = await loadSetup();
  if (saved) {
    document.getElementById("crop").value = saved.crop;
    document.getElementById("location").value = saved.location;
    document.getElementById("planting-date").value = saved.plantingDate;
    if (saved.farmSize) document.getElementById("farm-size").value = saved.farmSize;
  }
  dashboardPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
});

let autoRefreshTimer = null;

async function refreshWeatherSilently() {
  const refreshBtn = document.getElementById("refresh-btn");
  const data = await loadSetup();
  if (!data || !dashboardPanel.classList.contains("hidden") === false) return;
  if (dashboardPanel.classList.contains("hidden")) return;
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  await renderDashboard(data);
  refreshBtn.classList.remove("spinning");
  refreshBtn.disabled = false;
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(refreshWeatherSilently, 30 * 60 * 1000);
}

document.getElementById("refresh-btn").addEventListener("click", async () => {
  const refreshBtn = document.getElementById("refresh-btn");
  const data = await loadSetup();
  if (!data) return;
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  await renderDashboard(data);
  refreshBtn.classList.remove("spinning");
  refreshBtn.disabled = false;
  startAutoRefresh();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshWeatherSilently();
  }
});

taskButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const taskKey = btn.dataset.task || "";
    if (!taskKey) return;

    await addTaskRecord(taskKey);
    btn.classList.add("done");
    setTimeout(() => btn.classList.remove("done"), 1000);
  });
});

// ── Daily Email ──
const NOTIF_EMAIL_KEY = "smartFarmNotifEmail";

function getEmailPayload() {
  return {
    email: localStorage.getItem(NOTIF_EMAIL_KEY) || "",
    crop: document.getElementById("out-crop")?.textContent || "",
    location: document.getElementById("out-location")?.textContent || "",
    stage: document.getElementById("out-stage")?.textContent || "",
    weather: document.getElementById("out-weather")?.textContent || "",
    watering: document.getElementById("out-watering")?.textContent || "",
    risk: document.getElementById("out-risk")?.textContent || "",
    spraying: document.getElementById("out-spraying")?.textContent || "",
    fertilizer: document.getElementById("out-fertilizer")?.textContent || "",
    alert: document.getElementById("out-alert")?.textContent || "",
    harvest: document.getElementById("out-harvest")?.textContent || "",
  };
}

async function sendDailyEmail() {
  const payload = getEmailPayload();
  if (!payload.email) return;
  await fetch(`${appConfig.supabaseUrl}/functions/v1/daily-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${appConfig.supabaseAnonKey}`,
    },
    body: JSON.stringify(payload),
  });
}

document.getElementById("notif-email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("notif-email").value.trim();
  if (!email) return;
  localStorage.setItem(NOTIF_EMAIL_KEY, email);
  const status = document.getElementById("notif-email-status");
  const testBtn = document.getElementById("test-email-btn");
  status.textContent = `✅ გამოწერილია: ${email}`;
  status.classList.remove("hidden");
  testBtn.classList.remove("hidden");
});

document.getElementById("test-email-btn").addEventListener("click", async () => {
  const btn = document.getElementById("test-email-btn");
  const status = document.getElementById("notif-email-status");
  btn.textContent = "იგზავნება...";
  btn.disabled = true;
  await sendDailyEmail();
  btn.textContent = "🧪 ახლა გამოგზავნა";
  btn.disabled = false;
  status.textContent = "✅ ელ-ფოსტა გაიგზავნა! შეამოწმეთ inbox.";
});

// Restore saved email on load
(function restoreNotifEmail() {
  const saved = localStorage.getItem(NOTIF_EMAIL_KEY);
  if (!saved) return;
  const input = document.getElementById("notif-email");
  const status = document.getElementById("notif-email-status");
  const testBtn = document.getElementById("test-email-btn");
  if (input) input.value = saved;
  if (status) { status.textContent = `✅ გამოწერილია: ${saved}`; status.classList.remove("hidden"); }
  if (testBtn) testBtn.classList.remove("hidden");
})();

function scheduleMorningEmail() {
  if (!localStorage.getItem(NOTIF_EMAIL_KEY)) return;
  const sentKey = `smartFarmEmailSent:${new Date().toISOString().slice(0, 10)}`;
  if (localStorage.getItem(sentKey)) return;

  const now = new Date();
  const morning = new Date();
  morning.setHours(8, 0, 0, 0);
  const ms = morning - now;

  if (ms > 0) {
    setTimeout(async () => {
      await sendDailyEmail();
      localStorage.setItem(sentKey, "1");
    }, ms);
  } else {
    // Already past 8am today — send now if not sent yet
    sendDailyEmail().then(() => localStorage.setItem(sentKey, "1"));
  }
}

// ── Notifications ──
const NOTIF_KEY = "smartFarmNotifScheduled";

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (_) {}
}

async function requestNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showNotification(title, body) {
  if (Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, {
      body,
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: "smartfarm-daily",
      renotify: true,
    });
  }).catch(() => {
    new Notification(title, { body });
  });
}

function scheduleNotifications(advice) {
  const existing = localStorage.getItem(NOTIF_KEY);
  const today = new Date().toISOString().slice(0, 10);
  if (existing === today) return;
  localStorage.setItem(NOTIF_KEY, today);

  const now = new Date();
  const morningTime = new Date();
  morningTime.setHours(8, 0, 0, 0);
  const eveningTime = new Date();
  eveningTime.setHours(18, 0, 0, 0);

  const msUntilMorning = morningTime - now;
  const msUntilEvening = eveningTime - now;

  let morningMsg = "დილა მშვიდობისა! ";
  if (advice.watering?.includes("მოარწყე") || advice.watering?.includes("გაზარდეთ")) {
    morningMsg += "დღეს მორწყვა გამახსოვრდა.";
  } else if (advice.risk === "მაღალი") {
    morningMsg += "დაავადების რისკი მაღალია — შეამოწმე ნაკვეთი.";
  } else {
    morningMsg += "შეამოწმე დღევანდელი რეკომენდაციები.";
  }

  if (msUntilMorning > 0) {
    setTimeout(() => showNotification("🌱 SmartFarm", morningMsg), msUntilMorning);
  }

  if (msUntilEvening > 0 && advice.risk === "მაღალი") {
    setTimeout(() => showNotification("🌱 SmartFarm", "⚠ საღამოს შეამოწმე ნაკვეთი — დაავადების რისკი მაღალია."), msUntilEvening);
  }
}

async function initNotifications(advice) {
  await registerSW();
  const granted = await requestNotifPermission();
  if (granted) scheduleNotifications(advice);
}

// ── Chat ──
const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatClose = document.getElementById("chat-close");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

const CHAT_HISTORY_KEY = "smartFarmChatHistory";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadChatHistory() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "{}");
  } catch (_) { return {}; }
}

function saveChatHistory(history) {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

function saveMessage(role, text) {
  const history = loadChatHistory();
  const today = todayKey();
  if (!history[today]) history[today] = [];
  history[today].push({ role, text, time: new Date().toLocaleTimeString("ka-GE", { hour: "2-digit", minute: "2-digit" }) });
  saveChatHistory(history);
}

async function summarizeDay(date, messages) {
  const history = loadChatHistory();
  if (history[date]?.summary) return history[date].summary;

  try {
    const res = await fetch(`${appConfig.supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${appConfig.supabaseAnonKey}` },
      body: JSON.stringify({ action: "summarize", date, messages }),
    });
    const data = await res.json();
    const summary = data.summary || "";
    if (summary) {
      history[date] = { summary, summarized: true };
      saveChatHistory(history);
    }
    return summary;
  } catch (_) { return ""; }
}

function formatDate(dateStr) {
  return new Intl.DateTimeFormat("ka-GE", { day: "numeric", month: "long" }).format(new Date(dateStr));
}

async function renderChatHistory() {
  const history = loadChatHistory();
  const today = todayKey();
  const dates = Object.keys(history).sort();

  for (const date of dates) {
    if (date === today) continue;
    const entry = history[date];

    const summaryDiv = document.createElement("div");
    summaryDiv.className = "chat-summary";

    if (entry.summary) {
      summaryDiv.innerHTML = `<span class="chat-summary-date">📅 ${formatDate(date)}</span><p>${entry.summary}</p>`;
    } else {
      summaryDiv.innerHTML = `<span class="chat-summary-date">📅 ${formatDate(date)}</span><p class="chat-summary-loading">შეჯამება იტვირთება...</p>`;
      chatMessages.appendChild(summaryDiv);
      const summary = await summarizeDay(date, entry);
      summaryDiv.querySelector("p").textContent = summary || "საუბარი ამ დღეს.";
      continue;
    }
    chatMessages.appendChild(summaryDiv);
  }

  // Today's messages
  if (history[today] && !history[today].summary) {
    for (const msg of history[today]) {
      const div = document.createElement("div");
      div.className = `chat-bubble ${msg.role}`;
      div.textContent = msg.text;
      chatMessages.appendChild(div);
    }
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getChatContext() {
  return {
    crop: document.getElementById("out-crop")?.textContent || "",
    location: document.getElementById("out-location")?.textContent || "",
    stage: document.getElementById("out-stage")?.textContent || "",
    weather: document.getElementById("out-weather")?.textContent || "",
    watering: document.getElementById("out-watering")?.textContent || "",
    risk: document.getElementById("out-risk")?.textContent || "",
    spraying: document.getElementById("out-spraying")?.textContent || "",
    fertilizer: document.getElementById("out-fertilizer")?.textContent || "",
    pesticide: document.getElementById("out-pesticide")?.textContent || "",
    alert: document.getElementById("out-alert")?.textContent || "",
  };
}

function appendBubble(text, role) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

chatToggle.addEventListener("click", async () => {
  const wasHidden = chatPanel.classList.contains("hidden");
  chatPanel.classList.toggle("hidden");
  if (wasHidden) {
    chatMessages.innerHTML = '<div class="chat-bubble bot">გამარჯობა! დამისვი კითხვა შენი ნაკვეთის შესახებ.</div>';
    await renderChatHistory();
    chatInput.focus();
  }
});

chatClose.addEventListener("click", () => chatPanel.classList.add("hidden"));

async function sendChatRequest(message, imageBase64) {
  const submitBtn = chatForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  const typing = appendBubble("იფიქრებს...", "bot typing");

  try {
    const res = await fetch(`${appConfig.supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${appConfig.supabaseAnonKey}`,
      },
      body: JSON.stringify({ message, imageBase64, context: getChatContext() }),
    });

    const data = await res.json();
    typing.remove();
    if (data.error) {
      appendBubble("ERROR: " + data.error, "bot");
    } else {
      const answer = data.answer || "პასუხი ვერ მოიძებნა.";
      appendBubble(answer, "bot");
      saveMessage("bot", answer);
    }
  } catch (err) {
    typing.remove();
    appendBubble("შეცდომა: " + err.message, "bot");
  } finally {
    submitBtn.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  appendBubble(message, "user");
  saveMessage("user", message);
  await sendChatRequest(message, null);
});

document.getElementById("chat-photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(",")[1];
    const preview = document.createElement("div");
    preview.className = "chat-bubble user";
    const img = document.createElement("img");
    img.src = reader.result;
    img.style.cssText = "max-width:100%;border-radius:8px;display:block;";
    preview.appendChild(img);
    chatMessages.appendChild(preview);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    await sendChatRequest("ეს ფოტო ჩემი ნაკვეთიდანაა. გთხოვ გამიანალიზო — რა პრობლემა ან დაავადება ჩანს?", base64);
  };
  reader.readAsDataURL(file);
});

(async function bootstrap() {
  await initAuth();
  renderFieldSwitcher();
  await reloadDataForCurrentScope();
})();
