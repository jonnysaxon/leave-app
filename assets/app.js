import { applyAccruals } from "./accrual.js";
import { exportExcel, monthRangeDefaults } from "./excel.js";
import { syncData, verifyPrivateRepo } from "./github.js";
import {
  activeLeaveTypes,
  addTransaction,
  archiveLeaveType,
  deleteTransaction,
  exportJson,
  findLeaveType,
  formatAmount,
  importJson,
  loadData,
  newestFirst,
  recomputeBalances,
  replaceData,
  saveData,
  todayString,
  touch,
  updateTransaction,
  upsertLeaveType
} from "./storage.js";

const APP_VERSION = "0.1.2";
let data = loadData();
let activeCalendarInput = null;
let calendarCursor = null;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  enhanceDateInputs();
  bindEvents();
  initialize();
});

function bindElements() {
  [
    "balanceList",
    "transactionForm",
    "transactionLeaveType",
    "transactionAmount",
    "transactionDate",
    "transactionNote",
    "historyFilter",
    "historyList",
    "leaveTypeForm",
    "leaveTypeId",
    "leaveTypeName",
    "leaveTypeUnit",
    "leaveTypeBalance",
    "leaveTypeAllowNegative",
    "accrualEnabled",
    "accrualAmount",
    "accrualFrequency",
    "accrualAnchorDate",
    "resetLeaveTypeForm",
    "managedLeaveTypes",
    "githubForm",
    "githubRepo",
    "githubBranch",
    "githubPath",
    "githubToken",
    "repoWarning",
    "exportJsonButton",
    "importJsonButton",
    "importJsonInput",
    "versionLabel",
    "checkUpdateButton",
    "forceRefreshButton",
    "syncButton",
    "excelButton",
    "excelDialog",
    "excelForm",
    "excelStartMonth",
    "excelEndMonth",
    "editTransactionDialog",
    "editTransactionForm",
    "editTransactionId",
    "editTransactionDate",
    "editTransactionAmount",
    "editTransactionNote",
    "toast",
    "updateBanner",
    "updateNowButton",
    "installHelpButton",
    "calendarDialog",
    "calendarTitle",
    "calendarGrid",
    "calendarPrev",
    "calendarNext",
    "calendarToday",
    "calendarClose"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  document.querySelectorAll("[data-tab-link]").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tabLink));
  });

  els.transactionForm.addEventListener("submit", handleTransactionSubmit);
  els.historyFilter.addEventListener("change", renderHistory);
  els.leaveTypeForm.addEventListener("submit", handleLeaveTypeSubmit);
  els.resetLeaveTypeForm.addEventListener("click", resetLeaveTypeForm);
  els.githubForm.addEventListener("submit", handleGithubSubmit);
  els.exportJsonButton.addEventListener("click", handleJsonExport);
  els.importJsonButton.addEventListener("click", () => els.importJsonInput.click());
  els.importJsonInput.addEventListener("change", handleJsonImport);
  els.syncButton.addEventListener("click", handleSync);
  els.excelButton.addEventListener("click", openExcelDialog);
  els.excelForm.addEventListener("submit", handleExcelSubmit);
  els.editTransactionForm.addEventListener("submit", handleEditTransactionSubmit);
  els.checkUpdateButton.addEventListener("click", () => checkForUpdates(true));
  els.forceRefreshButton.addEventListener("click", forceRefresh);
  els.updateNowButton.addEventListener("click", forceRefresh);
  els.installHelpButton.addEventListener("click", () => toast("In Safari, use Share, then Add to Home Screen."));
  els.calendarPrev.addEventListener("click", () => moveCalendar(-1));
  els.calendarNext.addEventListener("click", () => moveCalendar(1));
  els.calendarToday.addEventListener("click", () => {
    if (activeCalendarInput) setDateValue(activeCalendarInput, todayString());
    els.calendarDialog.close();
  });
  els.calendarClose.addEventListener("click", () => els.calendarDialog.close());

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data && event.data.type === "VERSION_AVAILABLE") {
      els.updateBanner.classList.remove("hidden");
    }
  });
}

function initialize() {
  els.versionLabel.textContent = APP_VERSION;
  setDateValue(els.transactionDate, todayString());
  setDateValue(els.accrualAnchorDate, todayString());

  const result = applyAccruals(data);
  if (result.changed) {
    data = recomputeBalances(result.data);
    persist();
    toast("Accruals applied.");
  }

  populateGithubForm();
  render();
  registerServiceWorker();
}

function render() {
  renderBalances();
  renderTransactionTypeOptions();
  renderHistoryFilter();
  renderHistory();
  renderManagedLeaveTypes();
  renderSyncButton();
}

function persist() {
  data = recomputeBalances(data);
  saveData(data);
  render();
}

function showTab(tabName) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  });
  document.querySelector(".topbar h1").textContent = tabName === "adjust" ? "Add / Adjust" : titleCase(tabName);
}

function renderBalances() {
  const types = activeLeaveTypes(data);
  els.balanceList.innerHTML = "";
  if (!types.length) {
    els.balanceList.innerHTML = `<div class="empty">Create your first leave type in Settings.</div>`;
    return;
  }

  types.forEach((type) => {
    const card = document.createElement("article");
    card.className = "balance-card";
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(type.name)}</h3>
        <p class="meta">${type.accrual?.enabled ? accrualLabel(type) : "No accrual"}</p>
      </div>
      <div class="balance-value">${formatAmount(type.balance, type.unit)}</div>
    `;
    card.addEventListener("click", () => {
      els.historyFilter.value = type.id;
      showTab("history");
      renderHistory();
    });
    els.balanceList.append(card);
  });
}

function renderTransactionTypeOptions() {
  const current = els.transactionLeaveType.value;
  const types = activeLeaveTypes(data);
  els.transactionLeaveType.innerHTML = types
    .map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)}</option>`)
    .join("");
  if (types.some((type) => type.id === current)) els.transactionLeaveType.value = current;
}

function renderHistoryFilter() {
  const current = els.historyFilter.value;
  els.historyFilter.innerHTML = `<option value="all">All types</option>${data.leaveTypes
    .map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)}</option>`)
    .join("")}`;
  els.historyFilter.value = current && [...els.historyFilter.options].some((option) => option.value === current) ? current : "all";
}

function renderHistory() {
  const filter = els.historyFilter.value;
  const transactions = newestFirst(data.transactions).filter(
    (transaction) => filter === "all" || transaction.leaveTypeId === filter
  );
  els.historyList.innerHTML = "";
  if (!transactions.length) {
    els.historyList.innerHTML = `<div class="empty">No transactions yet.</div>`;
    return;
  }

  transactions.forEach((transaction) => {
    const type = findLeaveType(data, transaction.leaveTypeId);
    if (!type) return;
    const card = document.createElement("article");
    card.className = `history-card ${transaction.kind === "accrual" ? "accrual" : ""}`;
    const deltaClass = transaction.delta >= 0 ? "positive" : "negative";
    card.innerHTML = `
      <div class="history-main">
        <div>
          <h3>${escapeHtml(type.name)}</h3>
          <p class="meta">${escapeHtml(transaction.date)} · ${transaction.kind === "accrual" ? "Accrual" : "Manual"}</p>
        </div>
        <strong class="history-delta ${deltaClass}">${formatAmount(transaction.delta, type.unit, { signed: true })}</strong>
      </div>
      <p class="meta">${escapeHtml(transaction.note || "No note")}</p>
      <div class="button-row">
        <button class="secondary-button" type="button" data-edit-transaction="${escapeHtml(transaction.id)}">Edit</button>
        <button class="danger-button" type="button" data-delete-transaction="${escapeHtml(transaction.id)}">Delete</button>
      </div>
    `;
    card.querySelector("[data-edit-transaction]").addEventListener("click", () => openEditTransaction(transaction.id));
    card.querySelector("[data-delete-transaction]").addEventListener("click", () => {
      if (!confirm("Delete this transaction?")) return;
      data = deleteTransaction(data, transaction.id);
      persist();
      toast("Transaction deleted.");
    });
    els.historyList.append(card);
  });
}

function renderManagedLeaveTypes() {
  els.managedLeaveTypes.innerHTML = "";
  if (!data.leaveTypes.length) return;

  data.leaveTypes.forEach((type) => {
    const row = document.createElement("article");
    row.className = "type-row";
    row.innerHTML = `
      <div class="type-main">
        <div>
          <h3>${escapeHtml(type.name)}</h3>
          <p class="meta">${formatAmount(type.balance, type.unit)}${type.archived ? " · Archived" : ""}</p>
        </div>
      </div>
      <div class="button-row">
        <button class="secondary-button" type="button" data-edit-type="${escapeHtml(type.id)}">Edit</button>
        <button class="secondary-button" type="button" data-archive-type="${escapeHtml(type.id)}">
          ${type.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    `;
    row.querySelector("[data-edit-type]").addEventListener("click", () => editLeaveType(type.id));
    row.querySelector("[data-archive-type]").addEventListener("click", () => {
      data = archiveLeaveType(data, type.id, !type.archived);
      persist();
      toast(type.archived ? "Leave type restored." : "Leave type archived.");
    });
    els.managedLeaveTypes.append(row);
  });
}

function renderSyncButton() {
  const config = data.settings.github;
  const configured = Boolean(config.repo && config.branch && config.path && config.token);
  els.syncButton.disabled = !configured;
  els.syncButton.title = configured ? "Sync with GitHub" : "Add GitHub settings first.";
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  syncDateInput(els.transactionDate);
  const type = findLeaveType(data, els.transactionLeaveType.value);
  if (!type) {
    toast("Create a leave type first.");
    return;
  }
  const amount = Math.abs(Number(els.transactionAmount.value || 0));
  const direction = new FormData(els.transactionForm).get("transactionDirection");
  const delta = direction === "subtract" ? -amount : amount;
  if (!type.allowNegative && type.balance + delta < 0) {
    toast(`${type.name} cannot go negative.`);
    return;
  }

  data = addTransaction(data, {
    leaveTypeId: type.id,
    date: els.transactionDate.value,
    delta,
    note: els.transactionNote.value
  });
  persist();
  els.transactionAmount.value = "";
  els.transactionNote.value = "";
  toast("Adjustment saved.");
}

function handleLeaveTypeSubmit(event) {
  event.preventDefault();
  syncDateInput(els.accrualAnchorDate);
  data = upsertLeaveType(data, {
    id: els.leaveTypeId.value,
    name: els.leaveTypeName.value,
    unit: els.leaveTypeUnit.value,
    startingBalance: els.leaveTypeBalance.value,
    allowNegative: els.leaveTypeAllowNegative.checked,
    accrual: {
      enabled: els.accrualEnabled.checked,
      amount: els.accrualAmount.value,
      frequency: els.accrualFrequency.value,
      anchorDate: els.accrualAnchorDate.value
    }
  });
  persist();
  resetLeaveTypeForm();
  toast("Leave type saved.");
}

function editLeaveType(id) {
  const type = findLeaveType(data, id);
  if (!type) return;
  els.leaveTypeId.value = type.id;
  els.leaveTypeName.value = type.name;
  els.leaveTypeUnit.value = type.unit;
  els.leaveTypeUnit.disabled = true;
  els.leaveTypeBalance.value = type.startingBalance || 0;
  els.leaveTypeAllowNegative.checked = type.allowNegative;
  els.accrualEnabled.checked = Boolean(type.accrual?.enabled);
  els.accrualAmount.value = type.accrual?.amount || 0;
  els.accrualFrequency.value = type.accrual?.frequency || "monthly";
  setDateValue(els.accrualAnchorDate, type.accrual?.anchorDate || todayString());
  els.leaveTypeName.focus();
}

function resetLeaveTypeForm() {
  els.leaveTypeForm.reset();
  els.leaveTypeId.value = "";
  els.leaveTypeUnit.disabled = false;
  els.leaveTypeBalance.value = "0";
  els.leaveTypeAllowNegative.checked = true;
  setDateValue(els.accrualAnchorDate, todayString());
}

async function handleGithubSubmit(event) {
  event.preventDefault();
  const existingToken = data.settings.github.token || "";
  const tokenInput = els.githubToken.value.trim();
  data = touch({
    ...data,
    settings: {
      ...data.settings,
      github: {
        repo: els.githubRepo.value.trim(),
        branch: els.githubBranch.value.trim() || "main",
        path: els.githubPath.value.trim() || "leave.json",
        token: tokenInput.includes("••••") ? existingToken : tokenInput
      }
    }
  });
  saveData(data);
  populateGithubForm();
  renderSyncButton();

  try {
    const isPrivate = await verifyPrivateRepo(data.settings.github);
    els.repoWarning.classList.toggle("hidden", isPrivate);
    els.repoWarning.textContent = isPrivate ? "" : "This repo is public. Use a private repo before syncing.";
    toast(isPrivate ? "GitHub settings saved." : "Repo privacy warning.");
  } catch (error) {
    els.repoWarning.classList.remove("hidden");
    els.repoWarning.textContent = error.message;
    toast(error.message);
  }
}

function populateGithubForm() {
  const config = data.settings.github;
  els.githubRepo.value = config.repo || "";
  els.githubBranch.value = config.branch || "main";
  els.githubPath.value = config.path || "leave.json";
  els.githubToken.value = config.token ? `••••••••${config.token.slice(-4)}` : "";
}

function handleJsonExport() {
  const blob = new Blob([exportJson(data)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `leave-data-${todayString()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function handleJsonImport() {
  const [file] = els.importJsonInput.files;
  if (!file) return;
  try {
    data = replaceData(importJson(await file.text()));
    persist();
    populateGithubForm();
    toast("JSON imported.");
  } catch {
    toast("Could not import that JSON file.");
  } finally {
    els.importJsonInput.value = "";
  }
}

async function handleSync() {
  try {
    els.syncButton.disabled = true;
    const result = await syncData(data);
    data = replaceData(result.data);
    const accrualResult = applyAccruals(data);
    if (accrualResult.changed) data = replaceData(recomputeBalances(accrualResult.data));
    persist();
    populateGithubForm();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  } finally {
    renderSyncButton();
  }
}

function openExcelDialog() {
  const defaults = monthRangeDefaults(data);
  setDateValue(els.excelStartMonth, defaults.startDate);
  setDateValue(els.excelEndMonth, defaults.endDate);
  els.excelDialog.showModal();
}

async function handleExcelSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    els.excelDialog.close();
    return;
  }
  syncDateInput(els.excelStartMonth);
  syncDateInput(els.excelEndMonth);
  if (els.excelStartMonth.value > els.excelEndMonth.value) {
    toast("Start date must be before end date.");
    return;
  }
  try {
    const startMonth = monthFromDate(els.excelStartMonth.value);
    const endMonth = monthFromDate(els.excelEndMonth.value);
    await exportExcel(data, startMonth, endMonth);
    els.excelDialog.close();
    toast("Excel export ready.");
  } catch (error) {
    toast(error.message);
  }
}

function openEditTransaction(id) {
  const transaction = data.transactions.find((item) => item.id === id);
  if (!transaction) return;
  els.editTransactionId.value = transaction.id;
  setDateValue(els.editTransactionDate, transaction.date);
  els.editTransactionAmount.value = transaction.delta;
  els.editTransactionNote.value = transaction.note || "";
  els.editTransactionDialog.showModal();
}

function handleEditTransactionSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    els.editTransactionDialog.close();
    return;
  }
  syncDateInput(els.editTransactionDate);
  data = updateTransaction(data, els.editTransactionId.value, {
    date: els.editTransactionDate.value,
    delta: els.editTransactionAmount.value,
    note: els.editTransactionNote.value
  });
  const transaction = data.transactions.find((item) => item.id === els.editTransactionId.value);
  const type = transaction && findLeaveType(data, transaction.leaveTypeId);
  if (type && !type.allowNegative && type.balance < 0) {
    toast(`${type.name} cannot go negative.`);
    data = loadData();
    render();
    return;
  }
  persist();
  els.editTransactionDialog.close();
  toast("Transaction updated.");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    await navigator.serviceWorker.ready;
    checkForUpdates(false, registration);
  } catch {
    // The app still works without the service worker.
  }
}

async function checkForUpdates(showResult, registration) {
  try {
    const activeRegistration = registration || (await navigator.serviceWorker.ready);
    activeRegistration.active?.postMessage({ type: "CHECK_VERSION", currentVersion: APP_VERSION });
    if (showResult) toast("Checked for updates.");
  } catch {
    if (showResult) toast("Update check unavailable.");
  }
}

async function forceRefresh() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  window.location.reload();
}

function accrualLabel(type) {
  return `+${type.accrual.amount} ${type.unit} ${type.accrual.frequency}`;
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function enhanceDateInputs() {
  document.querySelectorAll('input[type="date"]').forEach((dateInput) => {
    const textInput = document.createElement("input");
    const button = document.createElement("button");
    const wrapper = document.createElement("div");

    textInput.type = "text";
    textInput.className = "date-text-input";
    textInput.placeholder = "YYYY-MM-DD";
    textInput.pattern = "\\d{4}-\\d{2}-\\d{2}";
    textInput.inputMode = "numeric";
    textInput.required = dateInput.required;
    textInput.autocomplete = "off";
    textInput.setAttribute("aria-label", dateInput.id);

    button.type = "button";
    button.className = "date-picker-button";
    button.textContent = "Cal";
    button.setAttribute("aria-label", "Open calendar");

    wrapper.className = "date-field";
    dateInput.classList.add("native-date-input");
    dateInput.required = false;
    dateInput.tabIndex = -1;

    dateInput.before(wrapper);
    wrapper.append(textInput, button, dateInput);
    dateInput.dateTextInput = textInput;

    textInput.addEventListener("input", () => {
      if (isDateString(textInput.value)) dateInput.value = textInput.value;
      if (!textInput.value) dateInput.value = "";
    });

    textInput.addEventListener("blur", () => {
      syncDateInput(dateInput);
    });

    dateInput.addEventListener("change", () => {
      textInput.value = dateInput.value;
    });

    button.addEventListener("click", () => openCalendar(dateInput));
  });
}

function setDateValue(dateInput, value) {
  dateInput.value = value || "";
  if (dateInput.dateTextInput) dateInput.dateTextInput.value = dateInput.value;
}

function syncDateInput(dateInput) {
  if (!dateInput.dateTextInput) return;
  const value = dateInput.dateTextInput.value.trim();
  if (isDateString(value)) {
    dateInput.value = value;
    dateInput.dateTextInput.value = value;
  } else if (!value) {
    dateInput.value = "";
  }
}

function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function openCalendar(dateInput) {
  syncDateInput(dateInput);
  activeCalendarInput = dateInput;
  calendarCursor = parseDateParts(dateInput.value || todayString());
  renderCalendar();
  els.calendarDialog.showModal();
}

function moveCalendar(offset) {
  calendarCursor = new Date(calendarCursor.year, calendarCursor.month - 1 + offset, 1);
  calendarCursor = {
    year: calendarCursor.getFullYear(),
    month: calendarCursor.getMonth() + 1,
    day: 1
  };
  renderCalendar();
}

function renderCalendar() {
  const selected = parseDateParts(activeCalendarInput?.value || "");
  const first = new Date(calendarCursor.year, calendarCursor.month - 1, 1);
  const daysInCurrentMonth = new Date(calendarCursor.year, calendarCursor.month, 0).getDate();
  const leadingDays = first.getDay();
  const monthLabel = first.toLocaleString(undefined, { month: "long", year: "numeric" });

  els.calendarTitle.textContent = monthLabel;
  els.calendarGrid.innerHTML = "";
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => {
    const label = document.createElement("div");
    label.className = "calendar-weekday";
    label.textContent = day;
    els.calendarGrid.append(label);
  });

  for (let index = 0; index < leadingDays; index += 1) {
    els.calendarGrid.append(document.createElement("span"));
  }

  for (let day = 1; day <= daysInCurrentMonth; day += 1) {
    const button = document.createElement("button");
    const value = formatDateParts(calendarCursor.year, calendarCursor.month, day);
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = day;
    if (
      selected &&
      selected.year === calendarCursor.year &&
      selected.month === calendarCursor.month &&
      selected.day === day
    ) {
      button.classList.add("is-selected");
    }
    button.addEventListener("click", () => {
      setDateValue(activeCalendarInput, value);
      els.calendarDialog.close();
    });
    els.calendarGrid.append(button);
  }
}

function parseDateParts(value) {
  if (!isDateString(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthFromDate(dateString) {
  return dateString.slice(0, 7);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
