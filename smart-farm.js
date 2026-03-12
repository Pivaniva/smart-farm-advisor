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

const cropLabelsKa = {
  maize: "სიმინდი",
  wheat: "ხორბალი",
  tomato: "პომიდორი",
  potato: "კარტოფილი",
  rice: "ბრინჯი",
  vine: "ვაზი (ღვინო)",
  nuts: "თხილი/კაკალი"
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
  return `${LEGACY_SETUP_KEY_BASE}:${getScopeId()}`;
}

function getTaskStorageKey() {
  return `${LOCAL_TASKS_KEY_BASE}:${getScopeId()}`;
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

  setAuthStatusText("სტატუსი: ჯერ შედით ელ-ფოსტით");
  logoutBtn.classList.add("hidden");
  authForm.classList.remove("hidden");
  setupPanel.classList.add("hidden");
  dashboardPanel.classList.add("hidden");
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

  if (supabaseClient && !currentUser) {
    setupPanel.classList.add("hidden");
    dashboardPanel.classList.add("hidden");
    return;
  }

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
      planting_date: data.plantingDate
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
  zugdidi: { latitude: 42.5113, longitude: 41.8709 }
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
    `&daily=precipitation_sum&timezone=auto`;

  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) throw new Error("Weather request failed");

  const weatherData = await weatherRes.json();
  const current = weatherData.current || {};
  const daily = weatherData.daily || {};

  return {
    tempC: Number(current.temperature_2m ?? 26),
    humidity: Number(current.relative_humidity_2m ?? 70),
    rainMm: Number(daily.precipitation_sum?.[0] ?? 0),
    condition: weatherCodeToText(Number(current.weather_code ?? 2)),
    source: "ცოცხალი ამინდი"
  };
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

function buildAdvice(crop, dayCount, weather) {
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
    }
  };

  let fertilizer =
    fertilizerByCrop[crop]?.[stage] || "გამოიყენეთ ბალანსირებული NPK მცირე დოზით და ნიადაგის ანალიზის მიხედვით.";

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

  setSyncBadge();

  try {
    weather = await fetchLiveWeather(data.location);
  } catch (_) {
    weather = { ...getWeather(data.location), source: "მოკი ამინდი" };
  }

  const dayCount = daysSincePlanting(data.plantingDate);
  try {
    const baseTemp = (gddByCrop[data.crop] || gddByCrop.maize).baseTemp;
    gdd = await fetchAccumulatedGdd(data.location, data.plantingDate, baseTemp);
    stageText = `${getStageByGdd(data.crop, gdd)} (GDD ${gdd})`;
  } catch (_) {
    stageText = `${getStage(data.crop, dayCount)} (დათესვიდან ${dayCount} დღე)`;
  }

  const advice = buildAdvice(data.crop, dayCount, weather);

  outCrop.textContent = cropLabelsKa[data.crop] || data.crop;
  outLocation.textContent = data.location;
  outWeather.textContent =
    `${weather.condition} (${weather.tempC}°C, ტენიანობა ${weather.humidity}%, ნალექი ${weather.rainMm} მმ) - ${weather.source}`;
  outStage.textContent = stageText;
  outWatering.textContent = advice.watering;
  outRisk.textContent = advice.risk;
  outSpraying.textContent = advice.spraying;
  outFertilizer.textContent = advice.fertilizer;
  outPesticide.textContent = advice.pesticide;
  outAlert.textContent = advice.alert;

  setupPanel.classList.add("hidden");
  dashboardPanel.classList.remove("hidden");
}

setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(setupForm);
  const data = {
    crop: String(formData.get("crop") || "").trim(),
    location: String(formData.get("location") || "").trim(),
    plantingDate: String(formData.get("plantingDate") || "").trim()
  };

  if (!data.crop || !data.location || !data.plantingDate) return;

  await saveSetup(data);
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

editBtn.addEventListener("click", () => {
  dashboardPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
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

(async function bootstrap() {
  await initAuth();
  await reloadDataForCurrentScope();
})();
