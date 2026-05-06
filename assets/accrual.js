import { roundAmount, todayString } from "./storage.js";

export function applyAccruals(data, today = todayString()) {
  let changed = false;
  const transactions = [...data.transactions];

  const leaveTypes = data.leaveTypes.map((type) => {
    if (!type.accrual || !type.accrual.enabled || !type.accrual.amount || !type.accrual.anchorDate) {
      return type;
    }

    const lastAppliedDate = type.accrual.lastAppliedDate || previousDate(type.accrual.anchorDate);
    const dates = accrualDates({
      anchorDate: type.accrual.anchorDate,
      lastAppliedDate,
      frequency: type.accrual.frequency,
      today
    });

    if (!dates.length) return type;

    changed = true;
    dates.forEach((date) => {
      const exists = transactions.some(
        (transaction) =>
          transaction.kind === "accrual" &&
          transaction.leaveTypeId === type.id &&
          transaction.date === date
      );
      if (exists) return;
      transactions.push({
        id: crypto.randomUUID(),
        leaveTypeId: type.id,
        date,
        delta: roundAmount(type.accrual.amount),
        note: `Automatic ${type.accrual.frequency} accrual`,
        kind: "accrual",
        createdAt: new Date().toISOString()
      });
    });

    return {
      ...type,
      accrual: {
        ...type.accrual,
        lastAppliedDate: dates[dates.length - 1]
      }
    };
  });

  if (!changed) return { data, changed: false };

  return {
    data: {
      ...data,
      leaveTypes,
      transactions,
      updatedAt: new Date().toISOString()
    },
    changed: true
  };
}

export function accrualDates({ anchorDate, lastAppliedDate, frequency, today }) {
  const dates = [];
  let cursor = anchorDate;

  while (cursor <= today) {
    if (cursor > lastAppliedDate) dates.push(cursor);
    cursor = nextAccrualDate(cursor, frequency, anchorDate);
  }

  return dates;
}

export function nextAccrualDate(dateString, frequency, anchorDate = dateString) {
  const date = parseLocalDate(dateString);
  if (frequency === "weekly") date.setDate(date.getDate() + 7);
  if (frequency === "fortnightly") date.setDate(date.getDate() + 14);
  if (frequency === "monthly") {
    const anchorDay = parseLocalDate(anchorDate).getDate();
    date.setMonth(date.getMonth() + 1, 1);
    date.setDate(Math.min(anchorDay, daysInMonth(date.getFullYear(), date.getMonth())));
  }
  if (frequency === "yearly") {
    const anchor = parseLocalDate(anchorDate);
    date.setFullYear(date.getFullYear() + 1, anchor.getMonth(), 1);
    date.setDate(Math.min(anchor.getDate(), daysInMonth(date.getFullYear(), date.getMonth())));
  }
  return formatLocalDate(date);
}

function previousDate(dateString) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() - 1);
  return formatLocalDate(date);
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function daysInMonth(year, zeroBasedMonth) {
  return new Date(year, zeroBasedMonth + 1, 0).getDate();
}
