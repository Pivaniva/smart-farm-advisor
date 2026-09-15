const plantForm = document.getElementById("plant-form");
const setupPanel = document.getElementById("setup-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const editBtn = document.getElementById("edit-btn");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const authEmail = document.getElementById("auth-email");
const logoutBtn = document.getElementById("logout-btn");

const outCrop = document.getElementById("out-crop");
const outLocation = document.getElementById("out-location");
const outSync = document.getElementById("out-sync");
const outWatering = document.getElementById("out-watering");
const taskHistory = document.getElementById("task-history");

const DEVICE_ID_KEY = "smartFarmDeviceId";
const PLANTS_LOCAL_KEY = "plantCareLocalPlants";
const TASKS_LOCAL_KEY = "plantCareLocalTaskHistory";
const CLOUD_MIGRATED_KEY_PREFIX = "plantCareCloudMigrated";

const taskLabelsKa = {
  water: "მორწყვა დასრულდა",
  fertilize: "სასუქის შეტანა დასრულდა",
  repot: "გადარგვა დასრულდა",
  // legacy farm task keys — kept so old task_history rows still render a label
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
let syncModeLabel = "შესვლა სინქრონიზაციისთვის";
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
  }
}

// Anonymous sessions never talk to Supabase — user_plants/task_history RLS
// requires auth.uid() = user_id, so an anon request can never read or write
// anything there anyway. Only a logged-in session goes to the cloud.
function isInfraError(status) {
  return !status || status >= 500;
}

function logSupabaseError(table, operation, error) {
  console.error(`[Supabase] ${table} ${operation} failed:`, error?.message || error);
}

function setSyncBadge() {
  outSync.textContent = syncModeLabel;
}

function setLoggedOutMode() {
  supabaseReady = false;
  syncModeLabel = "შესვლა სინქრონიზაციისთვის";
  setSyncBadge();
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

function setAuthStatusText(text) {
  authStatus.textContent = text;
}

function renderAuthUI() {
  const mobileBtn = document.getElementById("nav-login-btn");
  if (currentUser?.email) {
    setAuthStatusText(`სტატუსი: შესულია - ${currentUser.email}`);
    logoutBtn.classList.remove("hidden");
    authForm.classList.add("hidden");
    if (mobileBtn) mobileBtn.classList.add("hidden");
    setupPanel.classList.remove("hidden");
    return;
  }

  setAuthStatusText("სტატუსი: ლოკალური რეჟიმი");
  logoutBtn.classList.add("hidden");
  authForm.classList.remove("hidden");
  if (mobileBtn) mobileBtn.classList.remove("hidden");
}

async function verifySupabaseConnection() {
  if (!currentUser) {
    setLoggedOutMode();
    return;
  }

  if (!supabaseClient) {
    setLocalMode("Supabase არ არის კონფიგურირებული");
    return;
  }

  const { error, status } = await supabaseClient.from("user_plants").select("id").limit(1);

  if (error) {
    logSupabaseError("user_plants", "connectivity-check", error);
    if (isInfraError(status)) {
      setLocalMode("ქლაუდი მიუწვდომელია");
      return;
    }
  }

  setCloudMode();
}

async function migrateLocalPlantsToCloud() {
  if (!currentUser || !supabaseClient) return;

  const flagKey = `${CLOUD_MIGRATED_KEY_PREFIX}:${currentUser.id}`;
  if (localStorage.getItem(flagKey)) return;

  const localPlants = readLocalPlants();
  if (!localPlants.length) {
    localStorage.setItem(flagKey, "1");
    return;
  }

  const rows = localPlants.map(({ id, ...rest }) => ({ device_id: deviceId, ...rest }));
  const { error } = await supabaseClient.from("user_plants").insert(rows);

  if (error) {
    logSupabaseError("user_plants", "migrate-insert", error);
    return; // leave the flag unset so we retry on next login/reload
  }

  localStorage.setItem(flagKey, "1");
  writeLocalPlants([]);
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
  if (currentUser) await migrateLocalPlantsToCloud();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    renderAuthUI();
    void (async () => {
      if (currentUser) await migrateLocalPlantsToCloud();
      await reloadDataForCurrentScope();
    })();
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
  await loadAndShowPlants();
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
  const raw = localStorage.getItem(TASKS_LOCAL_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLocalTaskHistory(items) {
  localStorage.setItem(TASKS_LOCAL_KEY, JSON.stringify(items));
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
  if (!currentUser) return readLocalTaskHistory();
  if (!supabaseClient) return [];

  const { data, error, status } = await supabaseClient
    .from("task_history")
    .select("task_key,label,created_at,plant_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logSupabaseError("task_history", "select", error);
    if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    return [];
  }

  return (data || []).map((row) => ({
    task: row.task_key,
    label: row.label || taskLabelsKa[row.task_key] || row.task_key,
    time: formatDateTimeKa(new Date(row.created_at)),
    plantId: row.plant_id || null
  }));
}

async function refreshTaskHistory() {
  const items = await loadTaskHistory();
  renderTaskHistory(items);
}

async function addTaskRecord(taskKey, plantId) {
  const label = taskLabelsKa[taskKey] || taskKey;
  const record = { task: taskKey, label, time: formatDateTimeKa(new Date()), plantId: plantId || null };

  if (!currentUser) {
    const items = readLocalTaskHistory();
    items.unshift(record);
    writeLocalTaskHistory(items.slice(0, 50));
    await refreshTaskHistory();
    return;
  }

  if (supabaseClient) {
    const { error, status } = await supabaseClient.from("task_history").insert({
      device_id: deviceId,
      task_key: taskKey,
      label,
      plant_id: plantId || null
    });

    if (error) {
      logSupabaseError("task_history", "insert", error);
      if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    }
  }

  await refreshTaskHistory();
}

// ── user_plants (PlantCare) ─────────────────────────────────────────────
function readLocalPlants() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLANTS_LOCAL_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLocalPlants(plants) {
  localStorage.setItem(PLANTS_LOCAL_KEY, JSON.stringify(plants));
}

async function listUserPlants() {
  if (!currentUser) return readLocalPlants();
  if (!supabaseClient) return [];

  const { data, error, status } = await supabaseClient
    .from("user_plants")
    .select("*")
    .order("added_at", { ascending: true });

  if (error) {
    logSupabaseError("user_plants", "select", error);
    if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    return [];
  }

  return data || [];
}

async function addUserPlant(plant) {
  if (!currentUser) {
    const local = readLocalPlants();
    const withId = {
      id: `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      added_at: new Date().toISOString(),
      ...plant
    };
    local.push(withId);
    writeLocalPlants(local);
    return withId;
  }

  if (!supabaseClient) return null;

  const { data, error, status } = await supabaseClient
    .from("user_plants")
    .insert({ device_id: deviceId, ...plant })
    .select()
    .single();

  if (error) {
    logSupabaseError("user_plants", "insert", error);
    if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    return null;
  }

  return data;
}

async function updateUserPlant(plantId, patch) {
  if (!currentUser) {
    const local = readLocalPlants();
    const idx = local.findIndex((p) => p.id === plantId);
    if (idx === -1) return null;
    local[idx] = { ...local[idx], ...patch };
    writeLocalPlants(local);
    return local[idx];
  }

  if (!supabaseClient) return null;

  const { data, error, status } = await supabaseClient
    .from("user_plants")
    .update(patch)
    .eq("id", plantId)
    .select()
    .single();

  if (error) {
    logSupabaseError("user_plants", "update", error);
    if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    return null;
  }

  return data;
}


// ── PlantCare catalog ──────────────────────────────────────────────────────
const PLANT_CATALOG = {
  monstera: {
    georgian_name: "მონსტერა",
    latin_name: "Monstera deliciosa",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 5, winter: 12 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვის სიხშირე და გაასუფთავეთ დრენაჟი" },
      { symptom: "ყავისფერი, ქერცლიანი ლაქები ფოთლებზე", cause: "პირდაპირი მზის სხივები", fix: "გადაანაცვლეთ უფრო ჩრდილიან ადგილას" },
      { symptom: "ნელი ზრდა, ფოთლები არ იჭრება", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო განათებულ ადგილას" },
      { symptom: "ფესვების ლპობა", cause: "წყლის სტაგნაცია ქოთანში", fix: "შეცვალეთ ნიადაგი და გამოიყენეთ კარგი დრენაჟის ქოთანი" },
    ],
  },
  ficus_benjamina: {
    georgian_name: "ფიკუსი ბენჯამინი",
    latin_name: "Ficus benjamina",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 5, winter: 10 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ფოთლების მასობრივი ცვენა", cause: "ადგილის ან პირობების მკვეთრი შეცვლა", fix: "არ გადაანაცვლოთ ხშირად — შეინარჩუნეთ სტაბილური პირობები" },
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "მოარწყეთ მხოლოდ ნიადაგის ზედაპირის გამოშრობის შემდეგ" },
      { symptom: "შავი წერტილები ან ობი ფოთლებზე", cause: "ცუდი ვენტილაცია მაღალ ტენიანობასთან ერთად", fix: "გაზარდეთ ჰაერის მიმოქცევა ოთახში" },
      { symptom: "ბუგრები ან წებოვანი ლაქები ფოთლებზე", cause: "მავნებლების გამრავლება", fix: "დაამუშავეთ საპნის ხსნარით ან შესაბამისი ინსექტიციდით" },
    ],
  },
  ficus_lyrata: {
    georgian_name: "ფიკუსი ლირატა",
    latin_name: "Ficus lyrata",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 7, winter: 14 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ყავისფერი ლაქები ფოთლებზე", cause: "არარეგულარული მორწყვა", fix: "დაიცავით მუდმივი მორწყვის გრაფიკი" },
      { symptom: "ფოთლების ცვენა", cause: "სიცივე ან ქარბუქი", fix: "განათავსეთ თბილ, დაცულ ადგილას ფანჯრის ღიობებისა და გამათბობლებისგან შორს" },
      { symptom: "მტვრიანი, მქრქალი ფოთლები", cause: "იშვიათი წმენდა", fix: "პერიოდულად გაწმინდეთ ფოთლები ტენიანი ტილოთი" },
      { symptom: "ნელი ზრდა", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
    ],
  },
  sansevieria: {
    georgian_name: "სანსევიერია",
    latin_name: "Sansevieria trifasciata",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 14, winter: 30 },
    humidity: "დაბალი",
    fertilize_interval_days: 60,
    repot_interval_months: 36,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ფოთლების დარბილება და ლპობა", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვა და დაუშვით ნიადაგის სრული გამოშრობა" },
      { symptom: "ფოთლების წვერების გაყვითლება", cause: "პირდაპირი მზის დამწვრობა ან სიცივე", fix: "გადაანაცვლეთ ზომიერ განათებაზე, დაცული სიცივისგან" },
      { symptom: "ზრდის შეჩერება", cause: "მჭიდრო ქოთანი", fix: "გადარგეთ უფრო დიდ ჭურჭელში" },
      { symptom: "ყავისფერი, რბილი ლაქები ფუძესთან", cause: "ფესვის ლპობა", fix: "ამოიღეთ დაზიანებული ნაწილები და შეცვალეთ ნიადაგი" },
    ],
  },
  pothos: {
    georgian_name: "პოტოსი",
    latin_name: "Epipremnum aureum",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 6, winter: 14 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვის სიხშირე და გააუმჯობესეთ დრენაჟი" },
      { symptom: "გამხმარი, ყავისფერი წვერები", cause: "დაბალი ტენიანობა ან მარილების დაგროვება ნიადაგში", fix: "შეასხურეთ წყალი და პერიოდულად გამორეცხეთ ნიადაგი" },
      { symptom: "გრძელი, თხელი ღეროები ცოტა ფოთლით", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
      { symptom: "ფოთლების ჭრელობის დაკარგვა", cause: "ნაკლები შუქი", fix: "გაზარდეთ განათების ინტენსივობა" },
    ],
  },
  spathiphyllum: {
    georgian_name: "სპატიფილუმი",
    latin_name: "Spathiphyllum wallisii",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 5, winter: 10 },
    humidity: "მაღალი",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ფოთლების დაშვება", cause: "წყლის ნაკლებობა", fix: "მოარწყეთ დაუყოვნებლივ — ჩვეულებრივ სწრაფად აღდგება" },
      { symptom: "ყავისფერი ფოთლის წვერები", cause: "დაბალი ტენიანობა ან ქლორირებული წყალი", fix: "გამოიყენეთ გაფილტრული წყალი და გაზარდეთ ტენიანობა" },
      { symptom: "ყვავილობის არარსებობა", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ განათებულ, მაგრამ არაპირდაპირ ადგილას" },
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "მოარწყეთ მხოლოდ ზედაპირის გამოშრობის შემდეგ" },
    ],
  },
  zamioculcas: {
    georgian_name: "ზამიოკულკასი",
    latin_name: "Zamioculcas zamiifolia",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 14, winter: 30 },
    humidity: "დაბალი",
    fertilize_interval_days: 60,
    repot_interval_months: 36,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყვითელი ღეროები", cause: "გადამეტებული მორწყვა", fix: "სრულად გააშრეთ ნიადაგი მორწყვებს შორის" },
      { symptom: "ფოთლების ცვენა", cause: "ტემპერატურის მკვეთრი ცვლილება", fix: "შეინარჩუნეთ სტაბილური ტემპერატურა" },
      { symptom: "ძალიან ნელი ზრდა", cause: "არასაკმარისი განათება (ან ბუნებრივი თვისება)", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას და მოითმინეთ" },
      { symptom: "ფესვის ლპობა", cause: "წყლის სტაგნაცია", fix: "გამოიყენეთ კარგად დრენირებადი ნიადაგი" },
    ],
  },
  aloe: {
    georgian_name: "ალოე",
    latin_name: "Aloe vera",
    light: "მკვეთრი პირდაპირი",
    watering_interval_days: { summer: 14, winter: 30 },
    humidity: "დაბალი",
    fertilize_interval_days: 60,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ფოთლების დარბილება", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვა მკვეთრად" },
      { symptom: "გაწელილი, თხელი ფოთლები", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ მზიან ადგილას" },
      { symptom: "ყავისფერი, გამხმარი წვერები", cause: "არასაკმარისი მორწყვა ან სიცივე", fix: "მოარწყეთ ზომიერად და დაიცავით სიცივისგან" },
      { symptom: "ფესვის ლპობა", cause: "ცუდი დრენაჟი", fix: "გამოიყენეთ კაქტუსის ნიადაგი და ხვრელებიანი ქოთანი" },
    ],
  },
  calathea: {
    georgian_name: "ხავერდა/კალათეა",
    latin_name: "Calathea spp.",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 5, winter: 9 },
    humidity: "მაღალი",
    fertilize_interval_days: 30,
    repot_interval_months: 18,
    toxic_to_pets: false,
    difficulty: "რთული",
    common_problems: [
      { symptom: "ფოთლების წვერების გახმობა", cause: "დაბალი ტენიანობა ან ონკანის წყალი", fix: "გამოიყენეთ გაფილტრული წყალი და გაზარდეთ ტენიანობა" },
      { symptom: "ფოთლების დახვევა", cause: "ნიადაგის გამოშრობა", fix: "შეამოწმეთ ტენიანობა უფრო ხშირად და მოარწყეთ დროულად" },
      { symptom: "ნიმუშის გაუფერულება", cause: "ზედმეტი პირდაპირი შუქი", fix: "გადაანაცვლეთ ჩრდილიან ადგილას" },
      { symptom: "ფოთლების ლაქები", cause: "ონკანის წყლის მარილები", fix: "გამოიყენეთ დისტილირებული ან წვიმის წყალი" },
    ],
  },
  philodendron: {
    georgian_name: "ფილოდენდრონი",
    latin_name: "Philodendron hederaceum",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 6, winter: 12 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "მოარწყეთ მხოლოდ ზედაპირის გამოშრობის შემდეგ" },
      { symptom: "პატარა ფოთლები და გრძელი ღეროები", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
      { symptom: "ყავისფერი ლაქები ფოთლებზე", cause: "პირდაპირი მზის დამწვრობა", fix: "გადაიტანეთ არაპირდაპირ განათებაზე" },
      { symptom: "ნელი ზრდა ზამთარში", cause: "საკვები ნივთიერებების ნაკლებობა", fix: "გაზაფხულზე განაახლეთ სასუქის შეტანა" },
    ],
  },
  dracaena: {
    georgian_name: "დრაცენა",
    latin_name: "Dracaena fragrans",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 7, winter: 14 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყავისფერი ფოთლის წვერები", cause: "ფტორი წყალში ან დაბალი ტენიანობა", fix: "გამოიყენეთ გაფილტრული ან დაყენებული წყალი" },
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვის სიხშირე" },
      { symptom: "ფოთლების ჩამოცვენა", cause: "ძლიერი პირობების ცვლილება (გადატანა, სიცივე)", fix: "უზრუნველყავით სტაბილური ტემპერატურა და განათება" },
      { symptom: "წვრილი აბლაბუდის მსგავსი ტკიპები", cause: "მშრალი ჰაერი", fix: "გაზარდეთ ტენიანობა და დაამუშავეთ ინსექტიციდით" },
    ],
  },
  areca_palm: {
    georgian_name: "პალმა არეკა",
    latin_name: "Dypsis lutescens",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 5, winter: 10 },
    humidity: "მაღალი",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: false,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ფოთლის წვერების გახმობა", cause: "დაბალი ტენიანობა ან მარილების დაგროვება", fix: "გაზარდეთ ტენიანობა და პერიოდულად გამორეცხეთ ნიადაგი" },
      { symptom: "ყვითელი ფოთლები", cause: "რკინის ან მაგნიუმის ნაკლებობა", fix: "გამოიყენეთ პალმებისთვის სპეციალური სასუქი" },
      { symptom: "ყავისფერი ლაქები ფოთლებზე", cause: "გადამეტებული მორწყვა", fix: "გააუმჯობესეთ დრენაჟი" },
      { symptom: "წვრილი ტკიპები ფოთლების ქვეშ", cause: "მშრალი ჰაერი", fix: "შეასხურეთ წყალი რეგულარულად" },
    ],
  },
  orchid_phalaenopsis: {
    georgian_name: "ორქიდეა ფალენოპსისი",
    latin_name: "Phalaenopsis spp.",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 7, winter: 10 },
    humidity: "მაღალი",
    fertilize_interval_days: 14,
    repot_interval_months: 24,
    toxic_to_pets: false,
    difficulty: "რთული",
    common_problems: [
      { symptom: "ფესვები ვერცხლისფერი და მშრალი", cause: "არასაკმარისი მორწყვა", fix: "ჩაალბეთ ფესვები 10-15 წუთით ერთხელ კვირაში" },
      { symptom: "ყვავილების ცვენა", cause: "ტემპერატურის მკვეთრი ცვლილება ან ქარბუქი", fix: "შეინარჩუნეთ სტაბილური ტემპერატურა და თავიდან აირიდეთ ქარბუქი" },
      { symptom: "ფესვები ყავისფერი და რბილი", cause: "გადამეტებული მორწყვა ან ცუდი დრენაჟი", fix: "გამოიყენეთ ორქიდეისთვის სპეციალური სუბსტრატი" },
      { symptom: "ფოთლები იზრდება მხოლოდ ერთი მხრიდან", cause: "არათანაბარი განათება", fix: "პერიოდულად შეაბრუნეთ ქოთანი" },
    ],
  },
  succulents: {
    georgian_name: "სუკულენტები",
    latin_name: "Succulentae (სხვადასხვა გვარი)",
    light: "მკვეთრი პირდაპირი",
    watering_interval_days: { summer: 10, winter: 21 },
    humidity: "დაბალი",
    fertilize_interval_days: 60,
    repot_interval_months: 24,
    toxic_to_pets: false,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ფოთლების დარბილება ან გამჭვირვალობა", cause: "გადამეტებული მორწყვა", fix: "სრულად გააშრეთ ნიადაგი მორწყვებს შორის" },
      { symptom: "გაწელილი, დახრილი ფორმა", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ ყველაზე მზიან ადგილას" },
      { symptom: "ფოთლების ჩამოცვენა შეხებისას", cause: "ბუნებრივი თვისება ან სტრესი", fix: "ეს ნორმალურია ზოგ სახეობაში — შეამცირეთ გადაადგილება" },
      { symptom: "ფესვის ლპობა", cause: "წყლის სტაგნაცია", fix: "გამოიყენეთ კაქტუსის ნიადაგი და დრენაჟიანი ქოთანი" },
    ],
  },
  cactus: {
    georgian_name: "კაქტუსი",
    latin_name: "Cactaceae",
    light: "მკვეთრი პირდაპირი",
    watering_interval_days: { summer: 14, winter: 30 },
    humidity: "დაბალი",
    fertilize_interval_days: 60,
    repot_interval_months: 36,
    toxic_to_pets: false,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "რბილი, ყავისფერი ლაქები", cause: "ფესვის ან ღეროს ლპობა გადამეტებული მორწყვისგან", fix: "შეამცირეთ მორწყვა და გამოიყენეთ დრენაჟიანი ნიადაგი" },
      { symptom: "გაფითრებული, გამქრალი ფერი", cause: "ზედმეტი პირდაპირი შუქი მოულოდნელად", fix: "შეაჩვიეთ მზეს თანდათანობით" },
      { symptom: "გაწელილი ზრდა ერთი მიმართულებით", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ ყველაზე ნათელ ადგილას" },
      { symptom: "ბუმბულა თეთრი ლაქები", cause: "ფქვილიანა ბუგრები", fix: "გაწმინდეთ და დაამუშავეთ ალკოჰოლის ხსნარით" },
    ],
  },
  peperomia: {
    georgian_name: "პეპერომია",
    latin_name: "Peperomia obtusifolia",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 7, winter: 14 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 24,
    toxic_to_pets: false,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ფოთლების ჩამოცვენა", cause: "გადამეტებული მორწყვა", fix: "მოარწყეთ მხოლოდ ნიადაგის გამოშრობის შემდეგ" },
      { symptom: "გრძელი, დაჭიმული ღეროები", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
      { symptom: "ფოთლების დაჭმუჭვნა", cause: "დაბალი ტენიანობა", fix: "შეასხურეთ წყალი პერიოდულად" },
      { symptom: "ფესვის ლპობა", cause: "ცუდი დრენაჟი", fix: "შეცვალეთ ნიადაგი და გამოიყენეთ ხვრელებიანი ქოთანი" },
    ],
  },
  tradescantia: {
    georgian_name: "ტრადესკანცია",
    latin_name: "Tradescantia zebrina",
    light: "მკვეთრი არაპირდაპირი",
    watering_interval_days: { summer: 5, winter: 10 },
    humidity: "საშუალო",
    fertilize_interval_days: 30,
    repot_interval_months: 18,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ჭრელი ფერის გაქრობა", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
      { symptom: "გრძელი, შიშველი ღეროები", cause: "ბუნებრივი ზრდის თვისება", fix: "პერიოდულად შეაჭერით ახალი ზრდის სტიმულირებისთვის" },
      { symptom: "ფოთლების გახმობა", cause: "არასაკმარისი მორწყვა", fix: "გაზარდეთ მორწყვის სიხშირე" },
      { symptom: "ფესვის ლპობა", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვის სიხშირე" },
    ],
  },
  begonia: {
    georgian_name: "ბეგონია",
    latin_name: "Begonia spp.",
    light: "ნახევარჩრდილი",
    watering_interval_days: { summer: 5, winter: 10 },
    humidity: "მაღალი",
    fertilize_interval_days: 21,
    repot_interval_months: 12,
    toxic_to_pets: true,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ფქვილისებრი თეთრი ლაქები ფოთლებზე", cause: "მაღალი ტენიანობა ცუდ ვენტილაციასთან ერთად", fix: "გაზარდეთ ჰაერის მიმოქცევა" },
      { symptom: "ყვითელი ფოთლები", cause: "გადამეტებული მორწყვა", fix: "შეამცირეთ მორწყვის სიხშირე" },
      { symptom: "ყვავილობის არარსებობა", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ უფრო ნათელ ადგილას" },
      { symptom: "ღეროს დალპობა", cause: "წყლის შეხება ღეროსთან მორწყვისას", fix: "მოარწყეთ ფესვთან, არ დაასველოთ ღერო" },
    ],
  },
  geranium: {
    georgian_name: "გერანიუმი",
    latin_name: "Pelargonium spp.",
    light: "მკვეთრი პირდაპირი",
    watering_interval_days: { summer: 5, winter: 12 },
    humidity: "დაბალი",
    fertilize_interval_days: 21,
    repot_interval_months: 12,
    toxic_to_pets: true,
    difficulty: "მარტივი",
    common_problems: [
      { symptom: "ყვავილობის ნაკლებობა", cause: "არასაკმარისი განათება ან ჭარბი აზოტოვანი სასუქი", fix: "გადაანაცვლეთ მზიან ადგილას და შეამცირეთ აზოტი" },
      { symptom: "ქვედა ფოთლების გაყვითლება", cause: "გადამეტებული მორწყვა", fix: "მოარწყეთ მხოლოდ ნიადაგის გამოშრობის შემდეგ" },
      { symptom: "ნაცრისფერი ობის ლაქები", cause: "მაღალი ტენიანობა და ცუდი ვენტილაცია", fix: "გააუმჯობესეთ ვენტილაცია და მოაშორეთ დაზიანებული ფოთლები" },
      { symptom: "გაწელილი, სუსტი ღეროები", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ განათებულ ადგილას" },
    ],
  },
  lavender: {
    georgian_name: "ლავანდა",
    latin_name: "Lavandula angustifolia",
    light: "მკვეთრი პირდაპირი",
    watering_interval_days: { summer: 7, winter: 14 },
    humidity: "დაბალი",
    fertilize_interval_days: 45,
    repot_interval_months: 24,
    toxic_to_pets: true,
    difficulty: "საშუალო",
    common_problems: [
      { symptom: "ფესვის ლპობა", cause: "გადამეტებული მორწყვა ან ცუდი დრენაჟი", fix: "გამოიყენეთ მსუბუქი, კარგად დრენირებადი ნიადაგი" },
      { symptom: "გაწელილი, სუსტი ღეროები", cause: "არასაკმარისი განათება", fix: "გადაანაცვლეთ ყველაზე მზიან ადგილას" },
      { symptom: "ყვავილობის ნაკლებობა", cause: "ჭარბი სასუქი ან ჩრდილი", fix: "შეამცირეთ სასუქი და გაზარდეთ განათება" },
      { symptom: "ფოთლების გაყვითლება", cause: "მძიმე, თიხნარი ნიადაგი", fix: "შეცვალეთ მსუბუქ, ქვიშნარ ნიადაგზე" },
    ],
  },
};

// ── Care interval logic ──────────────────────────────────────────────────
const WINDOW_LABELS_KA = {
  north: "ჩრდილოეთი ფანჯარა",
  south: "სამხრეთი ფანჯარა",
  east: "აღმოსავლეთი ფანჯარა",
  west: "დასავლეთი ფანჯარა",
  none: "ფანჯრის გარეშე"
};

function isSummerSeason(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  return month >= 3 && month <= 10; // მარტი–ოქტომბერი
}

function getWateringIntervalDays(catalogEntry, windowDirection) {
  const base = isSummerSeason()
    ? catalogEntry.watering_interval_days.summer
    : catalogEntry.watering_interval_days.winter;

  if (windowDirection === "south") return Math.max(1, Math.round(base * 0.8));
  if (windowDirection === "none") return Math.round(base * 1.3);
  return base;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateKa(date) {
  return new Intl.DateTimeFormat("ka-GE", { day: "numeric", month: "long" }).format(date);
}

function daysUntil(date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function buildWateringVerdict(plant, catalogEntry) {
  const interval = getWateringIntervalDays(catalogEntry, plant.window_direction);
  if (!plant.last_watered) {
    return { text: "ჯერ არ მოგირწყავთ — მორწყეთ დღეს.", dueToday: true };
  }
  const nextDate = addDays(plant.last_watered, interval);
  const diff = daysUntil(nextDate);
  if (diff <= 0) {
    return { text: `მორწყვის დროა — ბოლო მორწყვიდან ${interval}+ დღეა.`, dueToday: true };
  }
  return { text: `შემდეგი მორწყვა: ${formatDateKa(nextDate)} (${diff} დღეში)`, dueToday: false };
}

function buildLightVerdict(plant, catalogEntry) {
  const need = catalogEntry.light;
  const dir = plant.window_direction;

  if (!dir) {
    return `საჭიროა: ${need}. მიუთითეთ ფანჯრის მიმართულება ზუსტი შეფასებისთვის.`;
  }

  const windowLabel = WINDOW_LABELS_KA[dir] || dir;
  const strongDirect = dir === "south";
  const brightIndirect = dir === "east" || dir === "west";
  const low = dir === "north";
  const none = dir === "none";

  let match;
  if (need === "მკვეთრი პირდაპირი") match = strongDirect;
  else if (need === "მკვეთრი არაპირდაპირი") match = strongDirect || brightIndirect;
  else if (need === "ნახევარჩრდილი") match = brightIndirect || low;
  else match = low || none; // ჩრდილი

  if (none) match = need === "ჩრდილი" || need === "ნახევარჩრდილი";

  return match
    ? `✅ შესაფერისია — საჭიროა ${need}, თქვენთან: ${windowLabel}.`
    : `⚠️ შეუსაბამობა — საჭიროა ${need}, თქვენთან: ${windowLabel}.`;
}

function buildFertilizeVerdict(plant, catalogEntry) {
  if (!isSummerSeason()) {
    return { text: "საჭირო არ არის — მოსვენების პერიოდია (ნოემბერი–თებერვალი).", dueToday: false };
  }
  if (!plant.last_fertilized) {
    return { text: "ჯერ არ გქონიათ სასუქის შეტანა — შეგიძლიათ დღეს.", dueToday: true };
  }
  const nextDate = addDays(plant.last_fertilized, catalogEntry.fertilize_interval_days);
  const diff = daysUntil(nextDate);
  if (diff <= 0) return { text: "სასუქის შეტანის დროა.", dueToday: true };
  return { text: `შემდეგი კვება: ${formatDateKa(nextDate)} (${diff} დღეში)`, dueToday: false };
}

function buildRepotVerdict(plant, catalogEntry) {
  if (!plant.last_repotted) {
    return { text: `დაგეგმეთ პირველი გადარგვა ~${catalogEntry.repot_interval_months} თვეში.`, dueToday: false };
  }
  const nextDate = new Date(plant.last_repotted);
  nextDate.setMonth(nextDate.getMonth() + catalogEntry.repot_interval_months);
  const diff = daysUntil(nextDate);
  if (diff <= 0) return { text: "გადარგვის დროა.", dueToday: true };
  const months = Math.round(diff / 30);
  return { text: `შემდეგი გადარგვა: ${formatDateKa(nextDate)} (~${months} თვეში)`, dueToday: false };
}

// ── user_plants: delete ───────────────────────────────────────────────────
async function deleteUserPlant(plantId) {
  if (!currentUser) {
    writeLocalPlants(readLocalPlants().filter((p) => p.id !== plantId));
    return true;
  }
  if (!supabaseClient) return false;

  const { error, status } = await supabaseClient.from("user_plants").delete().eq("id", plantId);
  if (error) {
    logSupabaseError("user_plants", "delete", error);
    if (isInfraError(status)) setLocalMode("ქლაუდი მიუწვდომელია");
    return false;
  }
  return true;
}

// ── Plant dashboard ──────────────────────────────────────────────────────
let currentPlants = [];
let activePlantId = null;

function getActivePlant() {
  return currentPlants.find((p) => p.id === activePlantId) || null;
}

function renderPlantDashboard(plant) {
  const catalogEntry = PLANT_CATALOG[plant.catalog_id];
  if (!catalogEntry) return;

  outCrop.textContent = plant.nickname || catalogEntry.georgian_name;
  outLocation.textContent = plant.location || "-";

  const outSpecies = document.getElementById("out-species");
  if (outSpecies) outSpecies.textContent = `${catalogEntry.georgian_name} (${catalogEntry.latin_name})`;

  const outWindow = document.getElementById("out-window");
  if (outWindow) outWindow.textContent = WINDOW_LABELS_KA[plant.window_direction] || "მითითებული არ არის";

  const outPotSize = document.getElementById("out-pot-size");
  if (outPotSize) outPotSize.textContent = plant.pot_size_cm ? `${plant.pot_size_cm} სმ` : "-";

  const toxicBlock = document.getElementById("toxic-block");
  const outToxic = document.getElementById("out-toxic");
  if (toxicBlock && outToxic) {
    if (catalogEntry.toxic_to_pets) {
      outToxic.textContent = "⚠️ ტოქსიკურია ცხოველებისთვის";
      toxicBlock.style.display = "";
    } else {
      toxicBlock.style.display = "none";
    }
  }

  const outDifficulty = document.getElementById("out-difficulty");
  if (outDifficulty) outDifficulty.textContent = catalogEntry.difficulty;

  outWatering.textContent = buildWateringVerdict(plant, catalogEntry).text;

  const outLight = document.getElementById("out-light");
  if (outLight) outLight.textContent = buildLightVerdict(plant, catalogEntry);

  const outFertilizerEl = document.getElementById("out-fertilizer");
  if (outFertilizerEl) outFertilizerEl.textContent = buildFertilizeVerdict(plant, catalogEntry).text;

  const outRepotEl = document.getElementById("out-repot");
  if (outRepotEl) outRepotEl.textContent = buildRepotVerdict(plant, catalogEntry).text;

  const problemsContainer = document.getElementById("plant-problems");
  if (problemsContainer) {
    problemsContainer.innerHTML = catalogEntry.common_problems.map((p) => `
      <div class="sched-card">
        <div class="sched-card-body">
          <div class="sched-row"><span class="sched-icon">🔍</span><div><p class="sched-lbl">სიმპტომი</p><p class="sched-val">${p.symptom}</p></div></div>
          <div class="sched-row"><span class="sched-icon">❓</span><div><p class="sched-lbl">მიზეზი</p><p class="sched-val">${p.cause}</p></div></div>
          <div class="sched-row"><span class="sched-icon">✅</span><div><p class="sched-lbl">გამოსავალი</p><p class="sched-val">${p.fix}</p></div></div>
        </div>
      </div>`).join("");
  }

  setupPanel.classList.add("hidden");
  dashboardPanel.classList.remove("hidden");
  chatToggle.classList.remove("hidden");
}

// ── Plant switcher UI ────────────────────────────────────────────────────
const plantSwitcher = document.getElementById("plant-switcher");
const plantSelect = document.getElementById("plant-select");

function renderPlantSwitcher() {
  if (currentPlants.length === 0) {
    plantSwitcher.classList.add("hidden");
    return;
  }
  plantSwitcher.classList.remove("hidden");
  plantSelect.innerHTML = currentPlants.map((p) => {
    const catalogEntry = PLANT_CATALOG[p.catalog_id];
    const label = p.nickname || catalogEntry?.georgian_name || p.catalog_id;
    return `<option value="${p.id}" ${p.id === activePlantId ? "selected" : ""}>${label}</option>`;
  }).join("");
}

async function loadAndShowPlants(preferredId) {
  currentPlants = await listUserPlants();
  renderPlantSwitcher();

  if (currentPlants.length === 0) {
    activePlantId = null;
    dashboardPanel.classList.add("hidden");
    setupPanel.classList.remove("hidden");
    return;
  }

  const target =
    currentPlants.find((p) => p.id === preferredId) ||
    currentPlants.find((p) => p.id === activePlantId) ||
    currentPlants[0];
  activePlantId = target.id;
  renderPlantSwitcher();
  renderPlantDashboard(target);
}

plantSelect.addEventListener("change", () => {
  activePlantId = plantSelect.value;
  const plant = getActivePlant();
  if (plant) renderPlantDashboard(plant);
});

// ── Add/edit plant ───────────────────────────────────────────────────────
function catalogOptionsHtml() {
  return Object.entries(PLANT_CATALOG)
    .sort((a, b) => a[1].georgian_name.localeCompare(b[1].georgian_name, "ka"))
    .map(([id, p]) => `<option value="${id}">${p.georgian_name} (${p.latin_name})</option>`)
    .join("");
}

function populateCatalogSelects() {
  const html = `<option value="">აირჩიეთ...</option>${catalogOptionsHtml()}`;
  const setupSelect = document.getElementById("plant-catalog");
  const modalSelect = document.getElementById("modal-plant-catalog");
  if (setupSelect) setupSelect.innerHTML = html;
  if (modalSelect) modalSelect.innerHTML = html;
}

function readPlantFormValues(form) {
  const fd = new FormData(form);
  return {
    catalog_id: String(fd.get("catalogId") || "").trim(),
    nickname: String(fd.get("nickname") || "").trim() || null,
    location: String(fd.get("location") || "").trim() || null,
    window_direction: String(fd.get("windowDirection") || "").trim() || null,
    pot_size_cm: fd.get("potSizeCm") ? parseInt(fd.get("potSizeCm"), 10) : null
  };
}

plantForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = readPlantFormValues(plantForm);
  if (!values.catalog_id) return;
  const created = await addUserPlant(values);
  plantForm.reset();
  if (created) await loadAndShowPlants(created.id);
});

const plantModal = document.getElementById("plant-modal");
const plantModalForm = document.getElementById("plant-modal-form");
const plantModalTitle = document.getElementById("plant-modal-title");
let plantModalMode = "add";

function openPlantModal(mode, plant) {
  plantModalMode = mode;
  plantModalTitle.textContent = mode === "edit" ? "მცენარის რედაქტირება" : "მცენარის დამატება";
  document.getElementById("modal-plant-catalog").value = plant?.catalog_id || "";
  document.getElementById("modal-plant-nickname").value = plant?.nickname || "";
  document.getElementById("modal-plant-location").value = plant?.location || "";
  document.getElementById("modal-plant-window").value = plant?.window_direction || "";
  document.getElementById("modal-plant-pot-size").value = plant?.pot_size_cm || "";
  plantModal.classList.remove("hidden");
}

document.getElementById("add-plant-btn").addEventListener("click", () => openPlantModal("add", null));
document.getElementById("plant-modal-close").addEventListener("click", () => plantModal.classList.add("hidden"));
plantModal.addEventListener("click", (e) => {
  if (e.target === plantModal) plantModal.classList.add("hidden");
});

plantModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = {
    catalog_id: document.getElementById("modal-plant-catalog").value,
    nickname: document.getElementById("modal-plant-nickname").value.trim() || null,
    location: document.getElementById("modal-plant-location").value.trim() || null,
    window_direction: document.getElementById("modal-plant-window").value || null,
    pot_size_cm: document.getElementById("modal-plant-pot-size").value
      ? parseInt(document.getElementById("modal-plant-pot-size").value, 10)
      : null
  };
  if (!values.catalog_id) return;

  plantModal.classList.add("hidden");

  if (plantModalMode === "edit" && activePlantId) {
    const updated = await updateUserPlant(activePlantId, values);
    if (updated) await loadAndShowPlants(updated.id);
  } else {
    const created = await addUserPlant(values);
    if (created) await loadAndShowPlants(created.id);
  }
});

document.getElementById("delete-plant-btn").addEventListener("click", async () => {
  const plant = getActivePlant();
  if (!plant) return;
  const catalogEntry = PLANT_CATALOG[plant.catalog_id];
  const label = plant.nickname || catalogEntry?.georgian_name || "მცენარე";
  if (!confirm(`წაიშალოს "${label}"?`)) return;
  await deleteUserPlant(plant.id);
  await loadAndShowPlants();
});

editBtn.addEventListener("click", () => {
  const plant = getActivePlant();
  if (plant) openPlantModal("edit", plant);
});

document.getElementById("clear-history-btn").addEventListener("click", async () => {
  if (!confirm("ჩანაწერების გასუფთავება?")) return;
  if (!currentUser) {
    writeLocalTaskHistory([]);
  } else if (supabaseClient) {
    const { error } = await supabaseClient.from("task_history").delete().not("id", "is", null);
    if (error) logSupabaseError("task_history", "delete-all", error);
  }
  await refreshTaskHistory();
});

// ── Watering / fertilize / repot actions ────────────────────────────────
async function markPlantCareDone(field, taskKey) {
  const plant = getActivePlant();
  if (!plant) return;
  const today = new Date().toISOString().slice(0, 10);
  const updated = await updateUserPlant(plant.id, { [field]: today });
  if (updated) {
    await addTaskRecord(taskKey, plant.id);
    await loadAndShowPlants(plant.id);
  }
}

document.getElementById("water-btn").addEventListener("click", () => markPlantCareDone("last_watered", "water"));
document.getElementById("fertilize-btn").addEventListener("click", () => markPlantCareDone("last_fertilized", "fertilize"));
document.getElementById("repot-btn").addEventListener("click", () => markPlantCareDone("last_repotted", "repot"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = String(authEmail.value || "").trim();
  if (!email) return;
  await sendLoginLink(email);
});

// Mobile login modal
const navLoginBtn = document.getElementById("nav-login-btn");
const loginModal = document.getElementById("login-modal");
const loginModalClose = document.getElementById("login-modal-close");
const authFormModal = document.getElementById("auth-form-modal");
const authEmailModal = document.getElementById("auth-email-modal");

if (navLoginBtn) {
  navLoginBtn.addEventListener("click", () => {
    loginModal.classList.remove("hidden");
    authEmailModal.focus();
  });
}
if (loginModalClose) {
  loginModalClose.addEventListener("click", () => loginModal.classList.add("hidden"));
}
if (loginModal) {
  loginModal.addEventListener("click", (e) => {
    if (e.target === loginModal) loginModal.classList.add("hidden");
  });
}
if (authFormModal) {
  authFormModal.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = String(authEmailModal.value || "").trim();
    if (!email) return;
    loginModal.classList.add("hidden");
    await sendLoginLink(email);
  });
}

logoutBtn.addEventListener("click", async () => {
  await logout();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const plant = getActivePlant();
    if (plant) renderPlantDashboard(plant);
  }
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
    harvest: document.getElementById("out-harvest")?.textContent || ""
  };
}

async function sendDailyEmail() {
  const payload = getEmailPayload();
  if (!payload.email) return;
  const res = await fetch(`${appConfig.supabaseUrl}/functions/v1/daily-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${appConfig.supabaseAnonKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`daily-email failed with status ${res.status}`);
  }
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
  try {
    await sendDailyEmail();
    status.textContent = "✅ ელ-ფოსტა გაიგზავნა! შეამოწმეთ inbox.";
  } catch (err) {
    status.textContent = "გაგზავნა ვერ მოხერხდა, სცადეთ თავიდან";
  } finally {
    btn.textContent = "🧪 ახლა გამოგზავნა";
    btn.disabled = false;
  }
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
    sendDailyEmail().then(() => localStorage.setItem(sentKey, "1"));
  }
}

// ── Notifications ──
const NOTIF_KEY = "smartFarmNotifScheduled";

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), {
      scope: new URL(".", document.baseURI).pathname
    });
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
      icon: new URL("icons/icon-192.png", document.baseURI).href,
      badge: new URL("icons/icon-192.png", document.baseURI).href,
      tag: "smartfarm-daily",
      renotify: true
    });
  }).catch(() => {
    new Notification(title, { body });
  });
}

// Phase 4 will replace this with a real per-plant watering-due check.
function scheduleNotifications() {}

async function initNotifications() {
  await registerSW();
  const granted = await requestNotifPermission();
  if (granted) scheduleNotifications();
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
      body: JSON.stringify({ action: "summarize", date, messages })
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

// Phase 4 fills this in with the user's plant list + last-watered dates.
function getChatContext() {
  return {};
}

function appendBubble(text, role) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function isMobile() { return window.innerWidth <= 600; }

chatToggle.addEventListener("click", async () => {
  const wasHidden = chatPanel.classList.contains("hidden");
  chatPanel.classList.toggle("hidden");
  if (wasHidden) {
    if (isMobile()) chatToggle.classList.add("hidden");
    chatMessages.innerHTML = '<div class="chat-bubble bot">გამარჯობა! დამისვი კითხვა შენი მცენარეების შესახებ.</div>';
    await renderChatHistory();
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.focus();
    }, 100);
  }
});

chatClose.addEventListener("click", () => {
  chatPanel.classList.add("hidden");
  chatToggle.classList.remove("hidden");
});

const CHAT_UNAVAILABLE_MSG = "სერვისი ამჟამად მიუწვდომელია, სცადეთ რამდენიმე წუთში";
const CHAT_GENERIC_ERROR_MSG = "დაფიქსირდა შეცდომა, სცადეთ თავიდან";

async function sendChatRequest(message, imageBase64) {
  const submitBtn = chatForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  const typing = appendBubble("იფიქრებს...", "bot typing");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    let res;
    try {
      res = await fetch(`${appConfig.supabaseUrl}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${appConfig.supabaseAnonKey}`
        },
        body: JSON.stringify({ message, imageBase64, context: getChatContext() }),
        signal: controller.signal
      });
    } catch (networkErr) {
      typing.remove();
      appendBubble(CHAT_UNAVAILABLE_MSG, "bot");
      return;
    }

    if (res.status === 503) {
      typing.remove();
      appendBubble(CHAT_UNAVAILABLE_MSG, "bot");
      return;
    }

    if (!res.ok) {
      typing.remove();
      appendBubble(CHAT_GENERIC_ERROR_MSG, "bot");
      return;
    }

    const data = await res.json();
    typing.remove();
    if (data.error) {
      appendBubble(CHAT_GENERIC_ERROR_MSG, "bot");
    } else {
      const answer = data.answer || "პასუხი ვერ მოიძებნა.";
      appendBubble(answer, "bot");
      saveMessage("bot", answer);
    }
  } finally {
    clearTimeout(timeoutId);
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
    await sendChatRequest("ეს ფოტო ჩემი მცენარისაა. გთხოვ გამიანალიზო — რა პრობლემა ან დაავადება ჩანს?", base64);
  };
  reader.readAsDataURL(file);
});

(async function bootstrap() {
  populateCatalogSelects();
  await initAuth();
  await reloadDataForCurrentScope();
})();

window.addEventListener("load", () => {
  registerSW();
});