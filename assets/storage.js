const STORAGE_KEY = "leave-tracker:data";
const BACKUP_KEY = "leave-tracker:backups";
const MAX_BACKUPS = 10;

export function createDefaultData() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    leaveTypes: [],
    transactions: [],
    settings: {
      github: {
        repo: "",
        branch: "main",
        path: "leave.json",
        token: ""
      }
    }
  };
}

export function loadData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return createDefaultData();

  try {
    return normalizeData(JSON.parse(stored));
  } catch {
    return createDefaultData();
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
}

export function createDataBackup(data, reason = "Manual backup") {
  const backup = {
    id: crypto.randomUUID(),
    reason,
    createdAt: new Date().toISOString(),
    data: normalizeData(data)
  };
  const backups = [backup, ...listDataBackups()].slice(0, MAX_BACKUPS);
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
  return backup;
}

export function listDataBackups() {
  try {
    const backups = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    return Array.isArray(backups) ? backups : [];
  } catch {
    return [];
  }
}

export function restoreLatestBackup() {
  const [latest] = listDataBackups();
  if (!latest || !latest.data) return null;
  return replaceData(latest.data);
}

export function normalizeData(data) {
  const normalized = {
    ...createDefaultData(),
    ...data,
    settings: {
      ...createDefaultData().settings,
      ...(data.settings || {}),
      github: {
        ...createDefaultData().settings.github,
        ...((data.settings && data.settings.github) || {})
      }
    }
  };

  normalized.leaveTypes = Array.isArray(data.leaveTypes) ? data.leaveTypes : [];
  normalized.transactions = Array.isArray(data.transactions) ? data.transactions : [];
  return recomputeBalances(normalized);
}

export function touch(data) {
  return {
    ...data,
    updatedAt: new Date().toISOString()
  };
}

export function recomputeBalances(data) {
  const leaveTypes = data.leaveTypes.map((type) => ({
    ...type,
    balance: Number(type.startingBalance || 0)
  }));

  const byId = new Map(leaveTypes.map((type) => [type.id, type]));
  sortTransactions(data.transactions).forEach((transaction) => {
    const type = byId.get(transaction.leaveTypeId);
    if (!type) return;
    type.balance = roundAmount(Number(type.balance || 0) + Number(transaction.delta || 0));
  });

  return {
    ...data,
    leaveTypes
  };
}

export function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => {
    const dateCompare = String(a.date).localeCompare(String(b.date));
    if (dateCompare !== 0) return dateCompare;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

export function newestFirst(transactions) {
  return sortTransactions(transactions).reverse();
}

export function activeLeaveTypes(data) {
  return data.leaveTypes.filter((type) => !type.archived);
}

export function findLeaveType(data, id) {
  return data.leaveTypes.find((type) => type.id === id);
}

export function upsertLeaveType(data, input) {
  const now = new Date().toISOString();
  const id = input.id || slugify(input.name) || crypto.randomUUID();
  const existing = findLeaveType(data, id);
  const nextType = {
    id,
    name: input.name.trim(),
    unit: existing ? existing.unit : input.unit,
    startingBalance: Number(input.startingBalance || 0),
    balance: existing ? Number(existing.balance || 0) : Number(input.startingBalance || 0),
    allowNegative: Boolean(input.allowNegative),
    archived: Boolean(input.archived || false),
    createdAt: existing ? existing.createdAt : now,
    accrual: {
      enabled: Boolean(input.accrual && input.accrual.enabled),
      amount: Number((input.accrual && input.accrual.amount) || 0),
      frequency: (input.accrual && input.accrual.frequency) || "monthly",
      anchorDate: (input.accrual && input.accrual.anchorDate) || todayString(),
      lastAppliedDate:
        (input.accrual && input.accrual.lastAppliedDate) ||
        (existing && existing.accrual && existing.accrual.lastAppliedDate) ||
        ""
    }
  };

  const leaveTypes = existing
    ? data.leaveTypes.map((type) => (type.id === id ? nextType : type))
    : [...data.leaveTypes, nextType];

  return touch(recomputeBalances({ ...data, leaveTypes }));
}

export function archiveLeaveType(data, id, archived) {
  const leaveTypes = data.leaveTypes.map((type) =>
    type.id === id ? { ...type, archived: Boolean(archived) } : type
  );
  return touch(recomputeBalances({ ...data, leaveTypes }));
}

export function addTransaction(data, input) {
  const transaction = {
    id: crypto.randomUUID(),
    leaveTypeId: input.leaveTypeId,
    date: input.date,
    delta: roundAmount(Number(input.delta || 0)),
    note: (input.note || "").trim(),
    kind: input.kind || "manual",
    createdAt: new Date().toISOString()
  };

  return touch(recomputeBalances({ ...data, transactions: [...data.transactions, transaction] }));
}

export function updateTransaction(data, id, patch) {
  const transactions = data.transactions.map((transaction) =>
    transaction.id === id
      ? {
          ...transaction,
          date: patch.date,
          delta: roundAmount(Number(patch.delta || 0)),
          note: (patch.note || "").trim()
        }
      : transaction
  );

  return touch(recomputeBalances({ ...data, transactions }));
}

export function deleteTransaction(data, id) {
  return touch(recomputeBalances({ ...data, transactions: data.transactions.filter((item) => item.id !== id) }));
}

export function replaceData(data) {
  const normalized = normalizeData(data);
  saveData(normalized);
  return normalized;
}

export function mergeDataDocuments(localData, remoteData) {
  const local = normalizeData(localData);
  const remote = normalizeData(remoteData);
  const leaveTypeIds = new Set(remote.leaveTypes.map((type) => type.id));
  const transactionIds = new Set(remote.transactions.map((transaction) => transaction.id));

  const localOnlyLeaveTypes = local.leaveTypes.filter((type) => !leaveTypeIds.has(type.id));
  const localOnlyTransactions = local.transactions.filter((transaction) => !transactionIds.has(transaction.id));
  const hasLocalOnlyData = localOnlyLeaveTypes.length > 0 || localOnlyTransactions.length > 0;

  const merged = recomputeBalances({
    ...remote,
    leaveTypes: [...remote.leaveTypes, ...localOnlyLeaveTypes],
    transactions: [...remote.transactions, ...localOnlyTransactions],
    settings: mergeSettings(local.settings, remote.settings),
    updatedAt: hasLocalOnlyData ? new Date().toISOString() : remote.updatedAt
  });

  return {
    data: merged,
    addedLeaveTypes: localOnlyLeaveTypes.length,
    addedTransactions: localOnlyTransactions.length,
    changed: hasLocalOnlyData
  };
}

export function exportJson(data) {
  return JSON.stringify(normalizeData(data), null, 2);
}

export function importJson(text) {
  return normalizeData(JSON.parse(text));
}

export function todayString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatAmount(value, unit, options = {}) {
  const suffix = unit === "days" ? "d" : "h";
  const signed = options.signed && value > 0 ? "+" : "";
  return `${signed}${Number(value).toFixed(2)}${suffix}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mergeSettings(localSettings = {}, remoteSettings = {}) {
  return {
    ...remoteSettings,
    github: {
      ...((remoteSettings && remoteSettings.github) || {}),
      ...((localSettings && localSettings.github) || {}),
      token:
        (localSettings.github && localSettings.github.token) ||
        (remoteSettings.github && remoteSettings.github.token) ||
        ""
    }
  };
}
