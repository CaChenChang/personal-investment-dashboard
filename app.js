const STORAGE_KEY = "personal-finance-dashboard-v1";
const DIRECTORY_STORAGE_KEY = "tw-instrument-directory-v1";
const US_SYMBOL_CACHE_KEY = "us-symbol-search-cache-v1";
const SETTINGS_STORAGE_KEY = "portfolio-dashboard-settings-v1";
const DIRECTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DIRECTORY_MIN_EXPECTED_COUNT = 1500;

const FALLBACK_DIRECTORY = [
  { symbol: "4958", name: "臻鼎-KY", market: "TWSE", aliases: ["臻鼎KY", "臻鼎"] },
  { symbol: "2330", name: "台積電", market: "TWSE", aliases: ["台積"] },
  { symbol: "0050", name: "元大台灣50", market: "TWSE", aliases: ["台灣50", "元大50"] },
  { symbol: "00631L", name: "元大台灣50正2", market: "TWSE", aliases: ["台灣50正2"] },
  { symbol: "009816", name: "凱基台灣TOP50", market: "TWSE", aliases: ["凱基TOP50"] },
  { symbol: "1785", name: "光洋科", market: "TPEx", aliases: [] },
  { symbol: "3037", name: "欣興", market: "TWSE", aliases: [] },
  { symbol: "4991", name: "環宇-KY", market: "TWSE", aliases: ["環宇KY"] },
  { symbol: "2367", name: "燿華", market: "TWSE", aliases: [] },
  { symbol: "8046", name: "南電", market: "TWSE", aliases: [] },
  { symbol: "2344", name: "華邦電", market: "TWSE", aliases: [] },
  { symbol: "00685L", name: "群益臺灣加權正2", market: "TWSE", aliases: ["群益台灣加權正2"] },
];

const INSTRUMENT_GROUPS = ["AI 與權值股","載板","記憶體","被動元件","功率元件","未分類"];
const DEFAULT_GROUP_BY_SYMBOL = {
  "2330": "AI 與權值股",
  "0050": "AI 與權值股",
  "00631L": "AI 與權值股",
  "00685L": "AI 與權值股",
  "009816": "AI 與權值股",
  "3037": "載板",
  "3189": "載板",
  "4958": "載板",
  "8046": "載板",
  "2344": "記憶體",
  "2408": "記憶體",
  "2327": "被動元件",
  "2375": "被動元件",
  "6173": "被動元件",
  "8261": "功率元件",
};

let instrumentDirectory = loadInstrumentDirectory();
let usSymbolCache = loadUsSymbolCache();
let settings = loadSettings();
let editingAccountId = "";
let editingPositionId = "";
let latestPortfolio = null;
let instrumentAutofillRequestId = 0;
let transactionLookupRequestId = 0;

const seedState = {
  seedVersion: 1,
  accounts: [],
  instruments: [],
  transactions: [],
  prices: {},
  snapshots: [],
  updatedAt: new Date().toISOString(),
};

let state = loadState();

const els = {
  viewTitle: document.querySelector("#viewTitle"),
  lastUpdated: document.querySelector("#lastUpdated"),
  metricTotalAssets: document.querySelector("#metricTotalAssets"),
  metricDayChange: document.querySelector("#metricDayChange"),
  metricEquityValue: document.querySelector("#metricEquityValue"),
  metricEquityWeight: document.querySelector("#metricEquityWeight"),
  metricCash: document.querySelector("#metricCash"),
  metricCashWeight: document.querySelector("#metricCashWeight"),
  metricUnrealized: document.querySelector("#metricUnrealized"),
  metricUnrealizedPct: document.querySelector("#metricUnrealizedPct"),
  topPositionsBody: document.querySelector("#topPositionsBody"),
  positionsBody: document.querySelector("#positionsBody"),
  transactionsBody: document.querySelector("#transactionsBody"),
  accountsBody: document.querySelector("#accountsBody"),
  priceUpdateStatus: document.querySelector("#priceUpdateStatus"),
  directoryStatus: document.querySelector("#directoryStatus"),
  directoryHelp: document.querySelector("#directoryHelp"),
  instrumentSymbolInput: document.querySelector("#instrumentSymbolInput"),
  instrumentNameInput: document.querySelector("#instrumentNameInput"),
  instrumentMarketSelect: document.querySelector("#instrumentMarketSelect"),
  instrumentGroupSelect: document.querySelector("#instrumentGroupSelect"),
  transactionMarketSelect: document.querySelector("#transactionMarketSelect"),
  transactionInstrumentQuery: document.querySelector("#transactionInstrumentQuery"),
  transactionInstrument: document.querySelector("#transactionInstrument"),
  transactionAccount: document.querySelector("#transactionAccount"),
  priceInstrument: document.querySelector("#priceInstrument"),
  alphaVantageForm: document.querySelector("#alphaVantageForm"),
  alphaVantageKeyInput: document.querySelector("#alphaVantageKeyInput"),
  clearAlphaVantageKeyBtn: document.querySelector("#clearAlphaVantageKeyBtn"),
  usDataStatus: document.querySelector("#usDataStatus"),
  assetChart: document.querySelector("#assetChart"),
  assetChartTimeline: document.querySelector("#assetChartTimeline"),
  allocationChart: document.querySelector("#allocationChart"),
  allocationList: document.querySelector("#allocationList"),
  groupAllocationList: document.querySelector("#groupAllocationList"),
};

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view, button.textContent));
});

document.querySelector("#instrumentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const resolved = await resolveInstrumentAsync(data.symbol || data.name, data.market);
  const symbol = (resolved?.symbol || data.symbol).trim().toUpperCase();
  const name = (resolved?.name || data.name).trim();
  const market = resolved?.market || data.market;
  if (state.instruments.some((item) => item.symbol === symbol)) {
    alert("這個代號已經存在。");
    return;
  }
  state.instruments.push({
    id: uid("ins"),
    symbol,
    name,
    market,
    currency: currencyForMarket(market),
    group: normalizeInstrumentGroup(data.group || defaultInstrumentGroup(symbol)),
  });
  event.currentTarget.reset();
  commit();
});

els.instrumentSymbolInput.addEventListener("input", debounce(() => autofillInstrumentForm("symbol"), 260));
els.instrumentNameInput.addEventListener("input", debounce(() => autofillInstrumentForm("name"), 260));
els.transactionInstrumentQuery.addEventListener("input", debounce(() => autofillTransactionInstrument(), 260));

document.querySelector("#accountForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formData(event.currentTarget);
  state.accounts.push({
    id: uid("acc"),
    name: data.name.trim(),
    type: data.type,
    balance: number(data.balance),
    currency: "TWD",
  });
  event.currentTarget.reset();
  commit();
});

document.querySelector("#transactionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const instrumentId = await ensureInstrumentForTransaction(data.instrumentId, data.instrumentQuery, data.market);
  if (!instrumentId && needsInstrument(data.type)) {
    alert("請輸入可辨識的股票代號或公司名稱；若查不到，可先到持股頁手動新增標的。");
    return;
  }
  const tx = {
    id: uid("tx"),
    date: data.date,
    type: data.type,
    instrumentId,
    accountId: data.accountId || "",
    shares: number(data.shares),
    price: number(data.price),
    fee: number(data.fee),
    tax: number(data.tax),
    cashAmount: number(data.cashAmount),
    note: data.note.trim(),
  };

  state.transactions.push(tx);
  applyCashImpact(tx);
  event.currentTarget.reset();
  setDefaultDates();
  commit();
});

document.querySelector("#priceForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const instrument = state.instruments.find((item) => item.id === data.instrumentId);
  if (!instrument) return;
  state.prices[instrument.symbol] = {
    price: number(data.price),
    changePct: number(data.changePct),
    source: "manual",
    updatedAt: new Date().toISOString(),
  };
  event.currentTarget.reset();
  setPriceStatus(`手動更新 ${instrument.symbol}，${formatDateTime(new Date().toISOString())}`);
  commit();
});

document.querySelector("#exportBtn").addEventListener("click", exportBackup);
document.querySelector("#importBtn").addEventListener("click", () => document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", importBackup);
document.querySelector("#resetBtn").addEventListener("click", resetSeed);
document.querySelector("#refreshPricesBtn").addEventListener("click", () => refreshTwsePrices({ silent: false }));
document.querySelector("#refreshDirectoryBtn").addEventListener("click", () => refreshInstrumentDirectory({ force: true }));
els.alphaVantageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  settings.alphaVantageApiKey = els.alphaVantageKeyInput.value.trim();
  saveSettings();
  renderSettings();
});
els.clearAlphaVantageKeyBtn.addEventListener("click", () => {
  settings.alphaVantageApiKey = "";
  saveSettings();
  renderSettings();
});
window.addEventListener("resize", debounce(() => {
  if (latestPortfolio) renderCharts(latestPortfolio);
}, 180));

setDefaultDates();
render();
renderSettings();
refreshInstrumentDirectory();
refreshTwsePrices({ silent: true });

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return normalizeState(structuredClone(seedState));
  try {
    const parsed = JSON.parse(saved);
    if (shouldReplaceOldSample(parsed)) return normalizeState(structuredClone(seedState));
    return normalizeState({ ...structuredClone(seedState), ...parsed });
  } catch {
    return normalizeState(structuredClone(seedState));
  }
}

function normalizeState(next) {
  const normalized = { ...structuredClone(seedState), ...(next || {}) };
  normalized.accounts = Array.isArray(normalized.accounts) ? normalized.accounts : [];
  normalized.instruments = Array.isArray(normalized.instruments)
    ? normalized.instruments.map((instrument) => ({
      ...instrument,
      group: normalizeInstrumentGroup(instrument.group || defaultInstrumentGroup(instrument.symbol)),
    }))
    : [];
  normalized.transactions = Array.isArray(normalized.transactions) ? normalized.transactions : [];
  normalized.prices = normalized.prices && typeof normalized.prices === "object" ? normalized.prices : {};
  normalized.snapshots = Array.isArray(normalized.snapshots) ? normalized.snapshots : [];
  return normalized;
}

function loadInstrumentDirectory() {
  const saved = localStorage.getItem(DIRECTORY_STORAGE_KEY);
  const bundled = getBundledInstrumentDirectory();
  if (!saved) return bundled;
  try {
    const parsed = JSON.parse(saved);
    return {
      items: Array.isArray(parsed.items) && parsed.items.length ? parsed.items : bundled.items,
      updatedAt: parsed.updatedAt || bundled.updatedAt,
      source: parsed.source || "cache",
    };
  } catch {
    return bundled;
  }
}

function getBundledInstrumentDirectory() {
  const bundledItems = Array.isArray(window.TW_INSTRUMENT_DIRECTORY) ? window.TW_INSTRUMENT_DIRECTORY : [];
  return {
    items: mergeDirectoryItems([...FALLBACK_DIRECTORY, ...bundledItems]),
    updatedAt: window.TW_INSTRUMENT_DIRECTORY_UPDATED_AT || "",
    source: bundledItems.length ? "內建台股基本資料快照" : "fallback",
  };
}

function loadUsSymbolCache() {
  const saved = localStorage.getItem(US_SYMBOL_CACHE_KEY);
  if (!saved) return { items: [], updatedAt: "" };
  try {
    const parsed = JSON.parse(saved);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return { items: [], updatedAt: "" };
  }
}

function saveUsSymbolCache(items) {
  usSymbolCache = {
    items: mergeDirectoryItems([...usSymbolCache.items, ...items]),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(US_SYMBOL_CACHE_KEY, JSON.stringify(usSymbolCache));
  renderSettings();
}

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!saved) return { alphaVantageApiKey: "" };
  try {
    return { alphaVantageApiKey: "", ...JSON.parse(saved) };
  } catch {
    return { alphaVantageApiKey: "" };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function renderSettings() {
  if (els.alphaVantageKeyInput) {
    els.alphaVantageKeyInput.value = settings.alphaVantageApiKey || "";
  }
  if (els.usDataStatus) {
    const count = usSymbolCache.items.length;
    els.usDataStatus.textContent = settings.alphaVantageApiKey
      ? `已啟用，快取 ${count} 檔`
      : "尚未啟用";
  }
}

function saveInstrumentDirectory(items, source) {
  instrumentDirectory = {
    items: mergeDirectoryItems([...getBundledInstrumentDirectory().items, ...items]),
    updatedAt: new Date().toISOString(),
    source,
  };
  localStorage.setItem(DIRECTORY_STORAGE_KEY, JSON.stringify(instrumentDirectory));
  renderSelectors();
}

function mergeDirectoryItems(items) {
  const merged = new Map();
  for (const item of items) {
    if (!item?.symbol || !item?.name) continue;
    const symbol = String(item.symbol).trim().toUpperCase();
    const market = item.market || "TWSE";
    merged.set(`${market}:${symbol}`, {
      symbol,
      name: String(item.name).trim(),
      market,
      currency: item.currency || currencyForMarket(market),
      aliases: item.aliases || [],
      source: item.source || "",
      updatedAt: item.updatedAt || "",
    });
  }
  return [...merged.values()];
}

async function refreshInstrumentDirectory({ force = false } = {}) {
  const isFresh =
    instrumentDirectory.updatedAt &&
    Date.now() - new Date(instrumentDirectory.updatedAt).getTime() < DIRECTORY_MAX_AGE_MS;
  if (!force && isFresh && isTaiwanDirectoryComplete()) {
    renderDirectoryStatus();
    return;
  }

  if (els.directoryStatus) els.directoryStatus.textContent = "更新標的資料庫中...";
  try {
    const [twse, tpex] = await Promise.allSettled([fetchTwseDirectory(), fetchTpexDirectory()]);
    const items = [
      ...(twse.status === "fulfilled" ? twse.value : []),
      ...(tpex.status === "fulfilled" ? tpex.value : []),
    ];
    if (!items.length) throw new Error("No directory rows");
    saveInstrumentDirectory(items, "TWSE/TPEx 基本資料");
  } catch {
    renderDirectoryStatus();
    if (els.directoryHelp) {
      els.directoryHelp.textContent = "目前無法更新官方標的清單，會先使用本機快取與內建常用標的。";
    }
  }
}

async function fetchTwseDirectory() {
  const endpoints = [
    {
      url: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
      source: "TWSE 上市公司基本資料",
      type: "json",
    },
    {
      url: "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
      source: "MOPS 上市公司基本資料 CSV",
      type: "csv",
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url);
      if (!response.ok) continue;
      const rows = endpoint.type === "csv" ? parseCsv(await response.text()) : await response.json();
      const items = normalizeDirectoryRows(rows, "TWSE", endpoint.source);
      if (items.length) return items;
    } catch {
      // Try the next public endpoint.
    }
  }

  throw new Error("TWSE directory failed");
}

async function fetchTpexDirectory() {
  const endpoints = [
    {
      url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
      source: "TPEx 上櫃股票基本資料",
      type: "json",
    },
    {
      url: "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
      source: "MOPS 上櫃股票基本資料 CSV",
      type: "csv",
    },
    {
      url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
      source: "TPEx 上櫃股票行情",
      type: "json",
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url);
      if (!response.ok) continue;
      const rows = endpoint.type === "csv" ? parseCsv(await response.text()) : await response.json();
      const items = normalizeDirectoryRows(rows, "TPEx", endpoint.source);
      if (items.length) return items;
    } catch {
      // Try the next public endpoint.
    }
  }

  return [];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), String(cells[index] || "").trim()])),
  );
}

function normalizeDirectoryRows(rows, market, source) {
  return rows
    .map((row) => {
      const symbol = normalizeDirectorySymbol(
        readFirstField(row, [
          "Code",
          "code",
          "SecuritiesCompanyCode",
          "公司代號",
          "股票代號",
          "證券代號",
          "代號",
        ]),
      );
      const name = readFirstField(row, [
        "Name",
        "name",
        "CompanyName",
        "公司簡稱",
        "公司名稱",
        "證券名稱",
        "名稱",
      ]);
      const fullName = readFirstField(row, ["公司名稱", "CompanyName", "證券名稱", "Name", "name"]);
      const aliases = [fullName]
        .filter((alias) => alias && alias !== name)
        .map((alias) => String(alias).trim());
      return {
        symbol,
        name: String(name || "").trim(),
        market,
        aliases,
        source,
      };
    })
    .filter((item) => item.symbol && item.name);
}

function readFirstField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return row[key];
  }
  const entries = Object.entries(row);
  for (const key of keys) {
    const normalizedKey = normalizeInstrumentQuery(key);
    const match = entries.find(([rowKey, value]) => normalizeInstrumentQuery(rowKey) === normalizedKey && String(value ?? "").trim());
    if (match) return match[1];
  }
  return "";
}

function normalizeDirectorySymbol(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

function isTaiwanDirectoryComplete() {
  return instrumentDirectory.items.filter((item) => ["TWSE", "TPEx"].includes(item.market)).length >= DIRECTORY_MIN_EXPECTED_COUNT;
}

function shouldReplaceOldSample(saved) {
  const symbols = (saved.instruments || []).map((item) => item.symbol).sort().join(",");
  const transactionIds = (saved.transactions || []).map((item) => item.id).sort().join(",");
  return (
    !saved.seedVersion &&
    symbols === "0050,2330" &&
    transactionIds === "tx-1,tx-2"
  );
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function commit() {
  saveState();
  render();
}

function setView(view, title) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === view);
  });
  els.viewTitle.textContent = title;
}

function render() {
  const portfolio = calculatePortfolio();
  latestPortfolio = portfolio;
  renderSelectors();
  renderMetrics(portfolio);
  renderPositions(portfolio);
  renderTransactions();
  renderAccounts();
  renderCharts(portfolio);
  els.lastUpdated.textContent = formatDateTime(state.updatedAt);
}

function renderSelectors() {
  const instrumentOptions = [
    ...state.instruments.map((item) => `<option value="${item.id}">${item.symbol} ${item.name}</option>`),
  ].join("");
  const accountOptions = [
    `<option value="">???</option>`,
    ...state.accounts.map((item) => `<option value="${item.id}">${item.name}</option>`),
  ].join("");
  els.priceInstrument.innerHTML = instrumentOptions;
  els.transactionAccount.innerHTML = accountOptions;
  if (els.instrumentGroupSelect) {
    const selected = els.instrumentGroupSelect.value || "未分類";
    els.instrumentGroupSelect.innerHTML = groupOptions(selected);
  }
  renderDirectoryStatus();
}

async function autofillInstrumentForm(source) {
  const requestId = ++instrumentAutofillRequestId;
  const query = source === "symbol" ? els.instrumentSymbolInput.value : els.instrumentNameInput.value;
  if (!shouldLookupInstrument(query, els.instrumentMarketSelect.value)) return;
  if (els.instrumentMarketSelect.value === "US" && !settings.alphaVantageApiKey) {
    if (els.directoryHelp) els.directoryHelp.textContent = "美股搜尋需先在設定頁儲存 Alpha Vantage API key；台股補全不受影響。";
    return;
  }
  if (els.directoryHelp) els.directoryHelp.textContent = "正在查詢標的資料...";
  const resolved = await resolveInstrumentAsync(query, els.instrumentMarketSelect.value);
  if (requestId !== instrumentAutofillRequestId) return;
  if (!resolved) {
    if (els.directoryHelp) els.directoryHelp.textContent = `查無「${query.trim()}」，請確認代號/名稱或先手動輸入。`;
    return;
  }
  if (source === "symbol") {
    els.instrumentNameInput.value = resolved.name;
  } else {
    els.instrumentSymbolInput.value = resolved.symbol;
  }
  els.instrumentMarketSelect.value = resolved.market;
  if (els.instrumentGroupSelect) els.instrumentGroupSelect.value = defaultInstrumentGroup(resolved.symbol);
  if (els.directoryHelp) els.directoryHelp.textContent = `已補全 ${resolved.symbol} ${resolved.name}（${marketLabel(resolved.market)}）。`;
}

async function autofillTransactionInstrument() {
  const requestId = ++transactionLookupRequestId;
  if (!shouldLookupInstrument(els.transactionInstrumentQuery.value, els.transactionMarketSelect.value)) {
    els.transactionInstrument.value = "";
    return;
  }
  if (els.transactionMarketSelect.value === "US" && !settings.alphaVantageApiKey) {
    els.transactionInstrument.value = "";
    if (els.directoryHelp) els.directoryHelp.textContent = "美股搜尋需先在設定頁儲存 Alpha Vantage API key；台股補全不受影響。";
    return;
  }
  const resolved = await resolveInstrumentAsync(els.transactionInstrumentQuery.value, els.transactionMarketSelect.value);
  if (requestId !== transactionLookupRequestId) return;
  if (!resolved) {
    els.transactionInstrument.value = "";
    if (els.directoryHelp) els.directoryHelp.textContent = `查無「${els.transactionInstrumentQuery.value.trim()}」，交易送出前可先到持股頁新增標的。`;
    return;
  }
  const instrument = findOrCreateInstrument(resolved);
  els.transactionInstrument.value = instrument.id;
  els.transactionInstrumentQuery.value = `${instrument.symbol} ${instrument.name}`;
  els.transactionMarketSelect.value = instrument.market;
  renderSelectors();
}

async function ensureInstrumentForTransaction(instrumentId, query, marketHint) {
  if (instrumentId && state.instruments.some((item) => item.id === instrumentId)) return instrumentId;
  if (!query) return "";
  const resolved = await resolveInstrumentAsync(query, marketHint);
  if (!resolved) return createManualInstrumentFromQuery(query, marketHint)?.id || "";
  return findOrCreateInstrument(resolved).id;
}

function needsInstrument(type) {
  return ["buy", "sell", "dividend", "adjustment"].includes(type);
}

function findOrCreateInstrument(instrument) {
  const existing = state.instruments.find((item) => item.symbol === instrument.symbol && item.market === instrument.market);
  if (existing) {
    existing.group = normalizeInstrumentGroup(existing.group || defaultInstrumentGroup(existing.symbol));
    return existing;
  }
  const created = {
    id: uid("ins"),
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    currency: instrument.currency || currencyForMarket(instrument.market),
    group: normalizeInstrumentGroup(instrument.group || defaultInstrumentGroup(instrument.symbol)),
  };
  state.instruments.push(created);
  return created;
}

function createManualInstrumentFromQuery(query, marketHint = "TWSE") {
  const cleaned = String(query || "").trim();
  if (!cleaned) return null;
  const looksLikeSymbol = /^[0-9A-Z]{4,8}$/i.test(cleaned);
  const symbol = looksLikeSymbol ? cleaned.toUpperCase() : prompt(`找不到「${cleaned}」的股票代號，請輸入代號：`);
  const name = looksLikeSymbol ? prompt(`找不到「${cleaned}」的公司名稱，請輸入名稱：`) : cleaned;
  if (!symbol || !name) return null;
  return findOrCreateInstrument({
    symbol: String(symbol).trim().toUpperCase(),
    name: String(name).trim(),
    market: marketHint || "TWSE",
    currency: currencyForMarket(marketHint || "TWSE"),
    aliases: [],
  });
}

function resolveInstrument(query) {
  return resolveInstrumentSync(query);
}

function resolveInstrumentSync(query, marketHint = "") {
  const normalized = normalizeInstrumentQuery(query);
  if (!normalized) return null;
  const directory = getDirectoryWithCurrentInstruments(marketHint);
  const bySymbol = directory.find((item) => normalizeInstrumentQuery(item.symbol) === normalized);
  if (bySymbol) return bySymbol;
  const byName = directory.find((item) => normalizeInstrumentQuery(item.name) === normalized);
  if (byName) return byName;
  const byAlias = directory.find((item) =>
    (item.aliases || []).some((alias) => normalizeInstrumentQuery(alias) === normalized),
  );
  if (byAlias) return byAlias;
  const candidates = directory.filter((item) => {
    const name = normalizeInstrumentQuery(item.name);
    return name.includes(normalized) || normalized.includes(name);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function resolveInstrumentAsync(query, marketHint = "") {
  if (!shouldLookupInstrument(query, marketHint)) return null;
  const local = resolveInstrumentSync(query, marketHint);
  if (local) return local;
  if (marketHint !== "US") {
    await refreshInstrumentDirectory({ force: !isTaiwanDirectoryComplete() });
    return resolveInstrumentSync(query, marketHint);
  }
  const results = await searchUsSymbols(query);
  if (!results.length) return null;
  saveUsSymbolCache(results);
  return resolveInstrumentSync(query, "US");
}

function shouldLookupInstrument(query, marketHint = "") {
  const normalized = normalizeInstrumentQuery(query);
  if (!normalized) return false;
  if (marketHint === "US") return normalized.length >= 1;
  return /^[0-9A-Z]+$/.test(normalized) ? normalized.length >= 4 : normalized.length >= 2;
}

function normalizeInstrumentQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[－—–-]/g, "")
    .replace(/臺/g, "台");
}

function getDirectoryWithCurrentInstruments(marketHint = "") {
  const merged = new Map();
  for (const item of [...FALLBACK_DIRECTORY, ...instrumentDirectory.items, ...usSymbolCache.items, ...state.instruments]) {
    if (!item?.symbol || !item?.name) continue;
    const market = item.market || "TWSE";
    if (marketHint === "US" && market !== "US") continue;
    if (["TWSE", "TPEx"].includes(marketHint) && !["TWSE", "TPEx"].includes(market)) continue;
    merged.set(`${market}:${item.symbol}`, {
      symbol: String(item.symbol).trim().toUpperCase(),
      name: String(item.name).trim(),
      market,
      currency: item.currency || currencyForMarket(market),
      aliases: item.aliases || [],
    });
  }
  return [...merged.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function renderDirectoryStatus() {
  if (!els.directoryStatus) return;
  const searchableCount = getDirectoryWithCurrentInstruments().length;
  const taiwanCount = instrumentDirectory.items.filter((item) => ["TWSE", "TPEx"].includes(item.market)).length;
  const updatedAt = instrumentDirectory.updatedAt ? formatDateTime(instrumentDirectory.updatedAt) : "尚未更新";
  const source = instrumentDirectory.source || "fallback";
  const warning = taiwanCount < DIRECTORY_MIN_EXPECTED_COUNT ? "；資料庫可能未完整載入" : "";
  els.directoryStatus.textContent = `${searchableCount} 檔｜${source}｜更新 ${updatedAt}${warning}`;
  if (els.directoryHelp) {
    els.directoryHelp.textContent = `可用股票代號或公司名稱搜尋。例：輸入 4958 會補臻鼎-KY；輸入臻鼎KY 會補 4958。`;
  }
}

async function searchUsSymbols(query) {
  const normalized = normalizeInstrumentQuery(query);
  if (!normalized || !settings.alphaVantageApiKey) return [];
  const cached = usSymbolCache.items.filter((item) => {
    return (
      normalizeInstrumentQuery(item.symbol) === normalized ||
      normalizeInstrumentQuery(item.name).includes(normalized)
    );
  });
  if (cached.length) return cached;

  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "SYMBOL_SEARCH");
  url.searchParams.set("keywords", query);
  url.searchParams.set("apikey", settings.alphaVantageApiKey);
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  const matches = data.bestMatches || [];
  return matches
    .filter((item) => {
      const region = item["4. region"] || "";
      const type = item["3. type"] || "";
      return region.toLowerCase().includes("united states") && type.toLowerCase().includes("equity");
    })
    .map((item) => ({
      symbol: item["1. symbol"],
      name: item["2. name"],
      market: "US",
      currency: item["8. currency"] || "USD",
      aliases: [],
      source: "Alpha Vantage SYMBOL_SEARCH",
      updatedAt: new Date().toISOString(),
    }))
    .filter((item) => item.symbol && item.name);
}

function renderMetrics(portfolio) {
  const equityWeight = portfolio.totalAssets ? portfolio.equityValue / portfolio.totalAssets : 0;
  const cashWeight = portfolio.totalAssets ? portfolio.cash / portfolio.totalAssets : 0;
  const unrealizedPct = portfolio.totalCost ? portfolio.unrealized / portfolio.totalCost : 0;
  const latest = state.snapshots.at(-1);
  const previous = state.snapshots.at(-2);
  const dayChange = latest && previous ? latest.totalAssets - previous.totalAssets : 0;

  els.metricTotalAssets.textContent = money(portfolio.totalAssets);
  els.metricDayChange.textContent = `最近變化 ${money(dayChange)}`;
  els.metricDayChange.className = classByValue(dayChange);
  els.metricEquityValue.textContent = money(portfolio.equityValue);
  els.metricEquityWeight.textContent = `配置 ${percent(equityWeight)}`;
  els.metricCash.textContent = money(portfolio.cash);
  els.metricCashWeight.textContent = `配置 ${percent(cashWeight)}`;
  els.metricUnrealized.textContent = money(portfolio.unrealized);
  els.metricUnrealized.className = classByValue(portfolio.unrealized);
  els.metricUnrealizedPct.textContent = percent(unrealizedPct);
  els.metricUnrealizedPct.className = classByValue(portfolio.unrealized);
}

function renderPositions(portfolio) {
  const sorted = [...portfolio.positions].sort((a, b) => b.marketValue - a.marketValue);
  const rows = groupPositions(sorted);
  const topRows = sorted.map((position) => topPositionRow(position, portfolio.totalAssets)).join("");
  els.positionsBody.innerHTML = rows || emptyRow(11);
  els.topPositionsBody.innerHTML = topRows || emptyRow(8);
}

function groupPositions(positions) {
  return INSTRUMENT_GROUPS.map((group) => {
    const items = positions
      .filter((position) => normalizeInstrumentGroup(position.group) === group)
      .sort((a, b) => b.marketValue - a.marketValue);
    if (!items.length) return "";
    const summary = summarizeGroup(items);
    return `
      <tr class="group-row">
        <td colspan="11">
          <div class="group-row-summary">
            <strong>${group}</strong>
            <span>持股檔數 ${summary.count}</span>
            <span>市值 ${money(summary.marketValue)}</span>
            <span>成本 ${money(summary.cost)}</span>
            <span class="${classByValue(summary.unrealized)}">未實現損益 ${money(summary.unrealized)}</span>
            <span class="${classByValue(summary.unrealized)}">損益率 ${percent(summary.unrealizedPct)}</span>
          </div>
        </td>
      </tr>
      ${items.map(positionRow).join("")}
    `;
  }).join("");
}

function positionRow(position) {
  const isEditing = editingPositionId === position.id;
  const clearButton = position.shares > 0
    ? `<button class="icon-btn position-clear-btn" type="button" onclick="clearPosition('${position.id}')">清空</button>`
    : `<span class="muted-action">已清空</span>`;
  const actions = isEditing
    ? `<div class="position-actions"><button class="icon-btn position-save-btn" type="button" onclick="savePositionEdit('${position.id}')">儲存</button><button class="icon-btn" type="button" onclick="cancelPositionEdit()">取消</button></div>`
    : `<div class="position-actions"><button class="icon-btn" type="button" onclick="editPosition('${position.id}')">編輯</button>${clearButton}</div>`;
  const sharesCell = isEditing
    ? `<input id="editPositionShares-${position.id}" class="table-input position-input" type="number" min="0" step="1" value="${position.shares}" />`
    : int(position.shares);
  const avgCostCell = isEditing
    ? `<input id="editPositionAvgCost-${position.id}" class="table-input position-input" type="number" min="0" step="0.01" value="${position.avgCost.toFixed(2)}" />`
    : money(position.avgCost, position.currency);
  return `
    <tr class="${isEditing ? "editing-row" : ""}">
      <td>${position.symbol}</td>
      <td>${position.name}</td>
      <td>
        <select class="group-select" onchange="updateInstrumentGroup('${position.id}', this.value)">
          ${groupOptions(position.group)}
        </select>
      </td>
      <td>${sharesCell}</td>
      <td>${money(position.cost, position.currency)}</td>
      <td>${avgCostCell}</td>
      <td>${money(position.price, position.currency)}</td>
      <td>${money(position.marketValue, position.currency)}</td>
      <td class="${classByValue(position.unrealized)}">${money(position.unrealized, position.currency)}</td>
      <td class="${classByValue(position.unrealized)}">${percent(position.unrealizedPct)}</td>
      <td>${actions}</td>
    </tr>
  `;
}

function topPositionRow(position, totalAssets) {
  return `
    <tr>
      <td>${position.symbol}</td>
      <td>${position.name}</td>
      <td>${int(position.shares)}</td>
      <td>${money(position.avgCost, position.currency)}</td>
      <td>${money(position.price, position.currency)}</td>
      <td>${money(position.marketValue, position.currency)}</td>
      <td class="${classByValue(position.unrealized)}">${money(position.unrealized, position.currency)}</td>
      <td>${position.currency === "TWD" ? percent(totalAssets ? position.marketValue / totalAssets : 0) : "未換算"}</td>
    </tr>
  `;
}

function renderTransactions() {
  const rows = [...state.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((tx) => {
      const instrument = state.instruments.find((item) => item.id === tx.instrumentId);
      const account = state.accounts.find((item) => item.id === tx.accountId);
      return `
        <tr>
          <td>${tx.date}</td>
          <td>${typeLabel(tx.type)}</td>
          <td>${instrument ? `${instrument.symbol} ${instrument.name}` : "-"}</td>
          <td>${account ? account.name : "-"}</td>
          <td>${tx.shares ? int(tx.shares) : "-"}</td>
          <td>${tx.price ? money(tx.price) : "-"}</td>
          <td>${money(tx.fee + tx.tax)}</td>
          <td>${tx.cashAmount ? money(tx.cashAmount) : "-"}</td>
          <td><button class="icon-btn" type="button" onclick="deleteTransaction('${tx.id}')">刪除</button></td>
        </tr>
      `;
    })
    .join("");
  els.transactionsBody.innerHTML = rows || emptyRow(9);
}

function renderAccounts() {
  const rows = state.accounts
    .map(
      (account) => editingAccountId === account.id
        ? `
        <tr>
          <td><input id="editAccountName-${account.id}" value="${escapeAttr(account.name)}" /></td>
          <td>
            <select id="editAccountType-${account.id}">
              <option value="bank" ${account.type === "bank" ? "selected" : ""}>銀行</option>
              <option value="broker" ${account.type === "broker" ? "selected" : ""}>券商</option>
              <option value="cash" ${account.type === "cash" ? "selected" : ""}>現金</option>
            </select>
          </td>
          <td><input id="editAccountBalance-${account.id}" type="number" step="1" value="${account.balance}" /></td>
          <td>
            <button class="icon-btn" type="button" onclick="saveAccountEdit('${account.id}')">儲存</button>
            <button class="icon-btn" type="button" onclick="cancelAccountEdit()">取消</button>
          </td>
        </tr>
      `
        : `
        <tr>
          <td>${account.name}</td>
          <td>${accountTypeLabel(account.type)}</td>
          <td>${money(account.balance)}</td>
          <td>
            <button class="icon-btn" type="button" onclick="editAccount('${account.id}')">編輯</button>
            <button class="icon-btn" type="button" onclick="deleteAccount('${account.id}')">刪除</button>
          </td>
        </tr>
      `,
    )
    .join("");
  els.accountsBody.innerHTML = rows || emptyRow(4);
}

function renderCharts(portfolio) {
  const assetSeries = buildSnapshotSeries(portfolio);
  drawLineChart(els.assetChart, assetSeries);
  renderAssetChartTimeline(assetSeries);
  drawAllocationChart(els.allocationChart, portfolio.equityValue, portfolio.cash);

  const total = portfolio.equityValue + portfolio.cash;
  els.allocationList.innerHTML = [
    { label: "股票", value: portfolio.equityValue, color: "#ffd400" },
    { label: "現金", value: portfolio.cash, color: "#101010" },
  ]
    .map(
      (item) => `
        <div class="allocation-item">
          <span><i class="swatch" style="background:${item.color}"></i>${item.label}</span>
          <strong>${money(item.value)} <small>${percent(total ? item.value / total : 0)}</small></strong>
        </div>
      `,
    )
    .join("");
  renderGroupAllocation(calculateGroupSummary(portfolio.positions.filter((position) => position.currency === "TWD")), portfolio.equityValue);
}

function calculatePortfolio() {
  const book = new Map();
  let realized = 0;

  for (const tx of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!tx.instrumentId) continue;
    const current = book.get(tx.instrumentId) || { shares: 0, cost: 0 };
    const gross = tx.shares * tx.price;

    if (tx.type === "buy") {
      current.shares += tx.shares;
      current.cost += gross + tx.fee + tx.tax;
    }

    if (tx.type === "adjustment") {
      current.shares = tx.shares;
      current.cost = tx.shares * tx.price;
    }

    if (tx.type === "sell" && current.shares > 0) {
      const sellShares = Math.min(tx.shares, current.shares);
      const avgCost = current.cost / current.shares;
      realized += sellShares * tx.price - tx.fee - tx.tax - avgCost * sellShares;
      current.shares -= sellShares;
      current.cost -= avgCost * sellShares;
    }

    if (tx.type === "dividend") {
      realized += tx.cashAmount;
    }

    book.set(tx.instrumentId, current);
  }

  const positions = state.instruments
    .map((instrument) => {
      const holding = book.get(instrument.id) || { shares: 0, cost: 0 };
      instrument.group = normalizeInstrumentGroup(instrument.group || defaultInstrumentGroup(instrument.symbol));
      const quote = state.prices[instrument.symbol] || { price: 0, changePct: 0 };
      const marketValue = holding.shares * quote.price;
      const unrealized = marketValue - holding.cost;
      return {
        ...instrument,
        group: normalizeInstrumentGroup(instrument.group || defaultInstrumentGroup(instrument.symbol)),
        shares: holding.shares,
        cost: holding.cost,
        currency: instrument.currency || currencyForMarket(instrument.market),
        avgCost: holding.shares ? holding.cost / holding.shares : 0,
        price: quote.price,
        marketValue,
        unrealized,
        unrealizedPct: holding.cost ? unrealized / holding.cost : 0,
      };
    })
    .filter((item) => item.shares > 0 || item.price > 0);

  const cash = state.accounts.reduce((sum, account) => sum + account.balance, 0);
  const twdPositions = positions.filter((position) => position.currency === "TWD");
  const equityValue = twdPositions.reduce((sum, position) => sum + position.marketValue, 0);
  const totalCost = twdPositions.reduce((sum, position) => sum + position.cost, 0);
  const unrealized = twdPositions.reduce((sum, position) => sum + position.unrealized, 0);

  return {
    positions,
    cash,
    equityValue,
    totalAssets: cash + equityValue,
    totalCost,
    unrealized,
    realized,
  };
}

function calculateGroupSummary(positions) {
  const summaries = INSTRUMENT_GROUPS.map((group) => {
    const items = positions.filter((position) => normalizeInstrumentGroup(position.group) === group);
    return { group, ...summarizeGroup(items) };
  });
  return summaries.filter((item) => item.marketValue > 0 || item.count > 0);
}

function summarizeGroup(items) {
  const marketValue = items.reduce((sum, position) => sum + position.marketValue, 0);
  const cost = items.reduce((sum, position) => sum + position.cost, 0);
  const unrealized = items.reduce((sum, position) => sum + position.unrealized, 0);
  return {
    count: items.length,
    marketValue,
    cost,
    unrealized,
    unrealizedPct: cost ? unrealized / cost : 0,
  };
}

function renderGroupAllocation(summaries, totalEquity) {
  if (!els.groupAllocationList) return;
  if (!summaries.length || !totalEquity) {
    els.groupAllocationList.innerHTML = `<p class="help-text">尚無持股族群資料</p>`;
    return;
  }
  els.groupAllocationList.innerHTML = summaries
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((item, index) => {
      const weight = totalEquity ? item.marketValue / totalEquity : 0;
      return `
        <div class="group-allocation-item">
          <div class="group-allocation-main">
            <strong>${item.group}</strong>
            <span>${money(item.marketValue)} ? ${percent(weight)} ? 持股檔數 ${item.count}</span>
          </div>
          <div class="group-allocation-bar" aria-hidden="true">
            <i style="width:${Math.max(2, weight * 100)}%; --bar-index:${index}"></i>
          </div>
        </div>
      `;
    })
    .join("");
}

function groupOptions(selectedGroup) {
  const normalized = normalizeInstrumentGroup(selectedGroup);
  return INSTRUMENT_GROUPS.map((group) => `<option value="${escapeAttr(group)}" ${group === normalized ? "selected" : ""}>${group}</option>`).join("");
}

function defaultInstrumentGroup(symbol) {
  return DEFAULT_GROUP_BY_SYMBOL[String(symbol || "").trim().toUpperCase()] || "未分類";
}

function normalizeInstrumentGroup(group) {
  return INSTRUMENT_GROUPS.includes(group) ? group : "未分類";
}

function buildSnapshotSeries(portfolio) {
  const snapshots = [...state.snapshots];
  snapshots.push({
    date: new Date().toISOString().slice(0, 10),
    label: "目前",
    equityValue: portfolio.equityValue,
    totalAssets: portfolio.totalAssets,
  });
  return snapshots;
}

function drawLineChart(canvas, data) {
  const { ctx, width, height } = prepareCanvas(canvas, { height: 360, mode: "responsive" });
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const pad = width < 520 ? { top: 18, right: 18, bottom: 66, left: 66 } : { top: 20, right: 30, bottom: 64, left: 86 };
  const values = data.flatMap((item) => [item.totalAssets, item.equityValue]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, rawMax * 0.08, 1);
  const min = Math.max(0, rawMin - spread * 0.25);
  const max = rawMax + spread * 0.25;

  drawGrid(ctx, width, height, pad, min, max);
  drawTimeAxis(ctx, data, pad, width, height);
  drawSeries(ctx, data, "totalAssets", "#101010", pad, min, max, width, height);
  drawSeries(ctx, data, "equityValue", "#ffd400", pad, min, max, width, height);
  drawLegend(ctx, [
    ["總資產", "#101010"],
    ["股票市值", "#ffd400"],
  ], height);
}

function drawGrid(ctx, width, height, pad, min, max) {
  ctx.strokeStyle = "#dedbd0";
  ctx.fillStyle = "#777569";
  ctx.lineWidth = 1;
  ctx.font = "13px Arial";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) * i) / 4;
    const value = max - ((max - min) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(shortMoney(value), 12, y + 4);
  }
}

function drawTimeAxis(ctx, data, pad, width, height) {
  if (!data.length) return;
  const plotWidth = width - pad.left - pad.right;
  const axisY = height - pad.bottom + 18;
  const candidateIndexes = width < 520
    ? [0, data.length - 1]
    : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  const indexes = [...new Set(candidateIndexes)].filter((index) => index >= 0 && index < data.length);
  ctx.save();
  ctx.strokeStyle = "#c9c5b8";
  ctx.fillStyle = "#5f5c52";
  ctx.lineWidth = 1;
  ctx.font = width < 520 ? "11px Arial" : "12px Arial";
  ctx.textAlign = "center";
  indexes.forEach((index) => {
    const x = pad.left + (plotWidth * index) / Math.max(data.length - 1, 1);
    ctx.beginPath();
    ctx.moveTo(x, height - pad.bottom);
    ctx.lineTo(x, height - pad.bottom + 6);
    ctx.stroke();
    ctx.fillText(chartDateLabel(data[index]), x, axisY);
  });
  ctx.restore();
}

function chartDateLabel(item) {
  if (item.label) return item.label;
  const raw = String(item.date || "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}`;
  return raw || "-";
}

function chartFullDateLabel(item) {
  if (item.label && item.date) return `${item.label} ${item.date}`;
  return item.date || item.label || "-";
}

function renderAssetChartTimeline(data) {
  if (!els.assetChartTimeline) return;
  if (!data.length) {
    els.assetChartTimeline.textContent = "時間軸：尚無資料";
    return;
  }
  const first = data[0];
  const last = data[data.length - 1];
  els.assetChartTimeline.textContent = `時間軸：${chartFullDateLabel(first)} - ${chartFullDateLabel(last)}`;
}

function drawSeries(ctx, data, key, color, pad, min, max, width, height) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  data.forEach((item, index) => {
    const x = pad.left + ((width - pad.left - pad.right) * index) / Math.max(data.length - 1, 1);
    const y = height - pad.bottom - ((item[key] - min) / (max - min)) * (height - pad.top - pad.bottom);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawLegend(ctx, items, height) {
  ctx.font = "13px Arial";
  items.forEach(([label, color], index) => {
    const x = 96 + index * 120;
    const y = Math.max(28, height - 31);
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 5, 20, 4);
    ctx.fillStyle = "#101010";
    ctx.fillText(label, x + 28, y);
  });
}

function drawAllocationChart(canvas, equity, cash) {
  const { ctx, width, height } = prepareCanvas(canvas, { height: 260, mode: "square" });
  const total = equity + cash;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(54, Math.min(width, height) * 0.35);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!total) return;

  let start = -Math.PI / 2;
  [
    { value: equity, color: "#ffd400" },
    { value: cash, color: "#101010" },
  ].forEach((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.lineWidth = 28;
    ctx.strokeStyle = slice.color;
    ctx.stroke();
    start += angle;
  });

  ctx.fillStyle = "#101010";
  ctx.font = "700 24px Arial";
  ctx.textAlign = "center";
  ctx.fillText(percent(equity / total), centerX, centerY - 2);
  ctx.fillStyle = "#777569";
  ctx.font = "13px Arial";
  ctx.fillText("股票配置", centerX, centerY + 22);
  ctx.textAlign = "left";
}

function prepareCanvas(canvas, options) {
  const settings = typeof options === "number" ? { height: options, mode: "responsive" } : options;
  const rect = canvas.getBoundingClientRect();
  const preferredHeight = Math.round(settings.height || 260);
  const mode = settings.mode || "responsive";
  const measuredWidth = Math.round(rect.width || canvas.clientWidth || canvas.width || preferredHeight);
  const cssWidth = mode === "square"
    ? Math.max(180, Math.min(preferredHeight, measuredWidth || preferredHeight))
    : Math.max(260, measuredWidth);
  const cssHeight = mode === "square" ? cssWidth : preferredHeight;
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function applyCashImpact(tx) {
  const account = state.accounts.find((item) => item.id === tx.accountId);
  if (!account) return;
  const gross = tx.shares * tx.price;
  if (tx.type === "buy") account.balance -= gross + tx.fee + tx.tax;
  if (tx.type === "sell") account.balance += gross - tx.fee - tx.tax;
  if (tx.type === "dividend" || tx.type === "deposit") account.balance += tx.cashAmount;
  if (tx.type === "withdraw" || tx.type === "fee") account.balance -= tx.cashAmount || tx.fee;
}

async function refreshTwsePrices({ silent = false } = {}) {
  return refreshAllPrices({ silent });
}

async function refreshAllPrices({ silent = false } = {}) {
  const instruments = state.instruments.filter((item) => ["TWSE", "TPEx", "US"].includes(item.market));
  if (!instruments.length) {
    setPriceStatus("目前沒有標的可更新");
    return;
  }

  try {
    setPriceStatus("更新行情中...");
    const [twse, tpex, us] = await Promise.allSettled([
      fetchTwsePriceRows(),
      fetchTpexPriceRows(),
      fetchUsPriceRows(),
    ]);
    const rows = [
      ...(twse.status === "fulfilled" ? twse.value : []),
      ...(tpex.status === "fulfilled" ? tpex.value : []),
      ...(us.status === "fulfilled" ? us.value : []),
    ];
    const usSkipped = state.instruments.some((item) => item.market === "US") && !settings.alphaVantageApiKey;
    if (!rows.length && usSkipped) {
      setPriceStatus("美股需先設定 Alpha Vantage API key；台股目前沒有可用行情");
      if (!silent) alert("美股需先設定 Alpha Vantage API key。台股功能不受影響。");
      return;
    }
    if (!rows.length) throw new Error("No price rows");
    const bySymbol = new Map(rows.map((row) => [`${row.market || ""}:${String(row.symbol).toUpperCase()}`, row]));
    let updated = 0;

    for (const instrument of instruments) {
      const row = bySymbol.get(`${instrument.market}:${instrument.symbol}`);
      if (!row) continue;
      const close = number(row.close);
      const changePct = number(row.changePct || 0);
      if (!close) continue;
      state.prices[instrument.symbol] = {
        price: close,
        changePct,
        source: row.source,
        updatedAt: new Date().toISOString(),
      };
      updated += 1;
    }

    commit();
    const skipped = instruments.length - updated;
    const failedSources = [
      twse.status === "rejected" ? "上市" : "",
      tpex.status === "rejected" ? "上櫃" : "",
      us.status === "rejected" ? "美股" : "",
    ].filter(Boolean);
    const details = [
      skipped ? `跳過 ${skipped} 檔` : "",
      usSkipped ? "美股需先設定 Alpha Vantage API key" : "",
      failedSources.length ? `${failedSources.join("、")}資料源失敗` : "",
    ].filter(Boolean);
    const message = `已更新 ${updated} 檔，${formatDateTime(new Date().toISOString())}${details.length ? `；${details.join("；")}` : ""}`;
    setPriceStatus(message);
    if (!silent) alert(message);
  } catch {
    setPriceStatus("行情更新失敗，保留既有價格");
    if (!silent) alert("目前無法從公開資料更新行情。你仍可在設定頁手動更新現價。");
  }
}

async function fetchUsPriceRows() {
  const usInstruments = state.instruments.filter((item) => item.market === "US");
  if (!settings.alphaVantageApiKey || !usInstruments.length) return [];
  const rows = [];
  for (const instrument of usInstruments) {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "GLOBAL_QUOTE");
    url.searchParams.set("symbol", instrument.symbol);
    url.searchParams.set("apikey", settings.alphaVantageApiKey);
    const response = await fetch(url);
    if (!response.ok) continue;
    const data = await response.json();
    const quote = data["Global Quote"] || {};
    const price = quote["05. price"];
    if (!price) continue;
    rows.push({
      symbol: instrument.symbol,
      market: "US",
      close: price,
      changePct: quote["10. change percent"] || 0,
      source: "Alpha Vantage GLOBAL_QUOTE",
    });
  }
  return rows;
}

async function fetchTwsePriceRows() {
  const response = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  if (!response.ok) throw new Error("TWSE price failed");
  const rows = await response.json();
  return rows.map((row) => ({
    symbol: row.Code || row.code || row["證券代號"],
    market: "TWSE",
    close: row.ClosingPrice || row.Close || row.closing_price,
    changePct: row.Change || row.ChangePercent || 0,
    source: "TWSE STOCK_DAY_ALL",
  }));
}

async function fetchTpexPriceRows() {
  const endpoints = [
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_daily_market_value",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) continue;
      const rows = await response.json();
      const mapped = rows
        .map((row) => ({
          symbol: row.SecuritiesCompanyCode || row.Code || row["代號"] || row["證券代號"],
          market: "TPEx",
          close: row.Close || row.ClosingPrice || row["收盤"] || row["收盤價"],
          changePct: row.Change || row.ChangePercent || row["漲跌"] || 0,
          source: "TPEx OpenAPI",
        }))
        .filter((row) => row.symbol && row.close);
      if (mapped.length) return mapped;
    } catch {
      // Try the next public endpoint.
    }
  }

  return [];
}

function setPriceStatus(message) {
  if (els.priceUpdateStatus) els.priceUpdateStatus.textContent = message;
}

function exportBackup() {
  const backup = { ...state, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      state = normalizeState({ ...structuredClone(seedState), ...incoming });
      commit();
    } catch {
      alert("備份檔格式無法讀取。");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function resetSeed() {
  if (!confirm("這會覆蓋目前本機資料，確定要重設嗎？")) return;
  state = normalizeState(structuredClone(seedState));
  commit();
}

function deleteTransaction(id) {
  if (!confirm("刪除交易後，已調整過的現金帳戶不會自動回復。確定刪除嗎？")) return;
  state.transactions = state.transactions.filter((tx) => tx.id !== id);
  commit();
}

function deleteAccount(id) {
  if (!confirm("確定刪除這個帳戶嗎？")) return;
  state.accounts = state.accounts.filter((account) => account.id !== id);
  commit();
}

function updateInstrumentGroup(instrumentId, group) {
  const instrument = state.instruments.find((item) => item.id === instrumentId);
  if (!instrument) return;
  instrument.group = normalizeInstrumentGroup(group);
  commit();
}

function editPosition(instrumentId) {
  editingPositionId = instrumentId;
  render();
}

function cancelPositionEdit() {
  editingPositionId = "";
  render();
}

function savePositionEdit(instrumentId) {
  const position = calculatePortfolio().positions.find((item) => item.id === instrumentId);
  const instrument = state.instruments.find((item) => item.id === instrumentId);
  if (!position || !instrument) {
    alert("找不到這個標的，請重新整理後再試一次。");
    return;
  }

  const sharesInput = document.querySelector(`#editPositionShares-${instrumentId}`);
  const avgCostInput = document.querySelector(`#editPositionAvgCost-${instrumentId}`);
  const shares = number(sharesInput?.value);
  const avgCost = number(avgCostInput?.value);
  if (!Number.isFinite(shares) || !Number.isFinite(avgCost) || shares < 0 || avgCost < 0) {
    alert("請輸入有效的持有股數與股票均價。");
    return;
  }
  if (!Number.isInteger(shares)) {
    alert("持有股數請輸入整數。");
    return;
  }

  state.transactions.push({
    id: uid("tx"),
    date: new Date().toISOString().slice(0, 10),
    type: "adjustment",
    instrumentId,
    accountId: "",
    shares,
    price: avgCost,
    fee: 0,
    tax: 0,
    cashAmount: 0,
    note: "手動調整持股股數與均價",
  });
  editingPositionId = "";
  commit();
}

function clearPosition(instrumentId) {
  const portfolio = calculatePortfolio();
  const position = portfolio.positions.find((item) => item.id === instrumentId);
  if (!position || position.shares <= 0) {
    alert("這個標的目前沒有可清空的持股。");
    return;
  }
  if (!position.price) {
    alert(`「${position.symbol} ${position.name}」目前沒有現價，請先到設定頁手動更新現價後再清空。`);
    return;
  }

  const account = findDefaultAccountForInstrument(instrumentId);
  if (!account) {
    alert("找不到可入帳的現金帳戶，請先新增一個券商、銀行或現金帳戶。");
    return;
  }

  const message = [
    `確定要清空 ${position.symbol} ${position.name} 嗎？`,
    `股數：${int(position.shares)}`,
    `預設賣出價格：${money(position.price, position.currency)}`,
    `入帳帳戶：${account.name}`,
    "系統會新增一筆賣出交易，保留原本的歷史交易紀錄。",
  ].join("\n");
  if (!confirm(message)) return;

  const tx = {
    id: uid("tx"),
    date: new Date().toISOString().slice(0, 10),
    type: "sell",
    instrumentId,
    accountId: account.id,
    shares: position.shares,
    price: position.price,
    fee: 0,
    tax: 0,
    cashAmount: 0,
    note: "清空持股",
  };
  state.transactions.push(tx);
  applyCashImpact(tx);
  commit();
}

function findDefaultAccountForInstrument(instrumentId) {
  const recentTx = [...state.transactions]
    .filter((tx) => tx.instrumentId === instrumentId && tx.accountId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((tx) => state.accounts.some((account) => account.id === tx.accountId));
  if (recentTx) return state.accounts.find((account) => account.id === recentTx.accountId);
  return (
    state.accounts.find((account) => account.type === "broker") ||
    state.accounts.find((account) => account.type === "cash") ||
    state.accounts.find((account) => account.type === "bank") ||
    state.accounts[0] ||
    null
  );
}

function editAccount(id) {
  editingAccountId = id;
  renderAccounts();
}

function cancelAccountEdit() {
  editingAccountId = "";
  renderAccounts();
}

function saveAccountEdit(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  account.name = document.querySelector(`#editAccountName-${id}`).value.trim() || account.name;
  account.type = document.querySelector(`#editAccountType-${id}`).value;
  account.balance = number(document.querySelector(`#editAccountBalance-${id}`).value);
  editingAccountId = "";
  commit();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setDefaultDates() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = new Date().toISOString().slice(0, 10);
  });
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function number(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value, currency = "TWD") {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TWD" ? 0 : 2,
  }).format(value || 0);
}

function currencyForMarket(market) {
  return market === "US" ? "USD" : "TWD";
}

function debounce(fn, wait = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function shortMoney(value) {
  if (Math.abs(value) >= 1000000) return `${Math.round(value / 10000)}萬`;
  return money(value);
}

function int(value) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value || 0);
}

function percent(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function classByValue(value) {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "";
}

function typeLabel(type) {
  return {
    buy: "買進",
    sell: "賣出",
    dividend: "股利",
    deposit: "入金",
    withdraw: "出金",
    fee: "費用",
    adjustment: "持股調整",
  }[type];
}

function accountTypeLabel(type) {
  return {
    bank: "銀行",
    broker: "券商",
    cash: "現金",
  }[type];
}

function marketLabel(market) {
  return {
    TWSE: "上市",
    TPEx: "上櫃",
    US: "美股",
  }[market] || market || "未知市場";
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" class="empty-cell">尚無資料，先新增帳戶、標的或交易紀錄。</td></tr>`;
}

window.deleteTransaction = deleteTransaction;
window.deleteAccount = deleteAccount;
window.editPosition = editPosition;
window.cancelPositionEdit = cancelPositionEdit;
window.savePositionEdit = savePositionEdit;
window.updateInstrumentGroup = updateInstrumentGroup;
window.clearPosition = clearPosition;
window.editAccount = editAccount;
window.cancelAccountEdit = cancelAccountEdit;
window.saveAccountEdit = saveAccountEdit;
