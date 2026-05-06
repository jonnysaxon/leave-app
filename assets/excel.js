import { findLeaveType, formatAmount, roundAmount, sortTransactions, todayString } from "./storage.js";

export function monthRangeDefaults(data) {
  const months = data.transactions.map((transaction) => transaction.date.slice(0, 7)).sort();
  const currentDate = todayString();
  const currentMonth = currentDate.slice(0, 7);
  return {
    startDate: `${months[0] || currentMonth}-01`,
    endDate: currentDate
  };
}

export async function exportExcel(data, startMonth, endMonth) {
  const XLSX = await loadXlsx();
  const rows = buildSummaryRows(data, startMonth, endMonth);
  const worksheet = XLSX.utils.aoa_to_sheet(rows.values);
  worksheet["!cols"] = rows.widths.map((width) => ({ wch: width }));
  worksheet["!freeze"] = { xSplit: 1, ySplit: 1 };

  rows.values[0].forEach((_, col) => {
    const address = XLSX.utils.encode_cell({ r: 0, c: col });
    if (worksheet[address]) worksheet[address].s = { font: { bold: true } };
  });

  rows.numberCells.forEach(({ row, col }) => {
    const address = XLSX.utils.encode_cell({ r: row, c: col });
    if (worksheet[address]) worksheet[address].z = "0.00";
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leave Summary");

  const filename = `leave-export-${startMonth}-to-${endMonth}.xlsx`;
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBytes(bytes, filename);
}

export function buildSummaryRows(data, startMonth, endMonth) {
  const months = monthsBetween(startMonth, endMonth);
  const selectedLeaveTypes = data.leaveTypes.filter((type) => {
    if (!type.archived) return true;
    return data.transactions.some(
      (transaction) =>
        transaction.leaveTypeId === type.id &&
        transaction.date.slice(0, 7) >= startMonth &&
        transaction.date.slice(0, 7) <= endMonth
    );
  });

  const headers = ["Month"];
  selectedLeaveTypes.forEach((type) => {
    headers.push(`${type.name} - Net (${type.unit})`);
    headers.push(`${type.name} - Balance (${type.unit})`);
  });
  headers.push("Comments");

  const transactions = sortTransactions(data.transactions);
  const values = [headers];
  const numberCells = [];

  months.forEach((month, index) => {
    const row = [month];
    const monthEnd = lastDayOfMonth(month);
    selectedLeaveTypes.forEach((type) => {
      const monthlyTransactions = transactions.filter(
        (transaction) => transaction.leaveTypeId === type.id && transaction.date.slice(0, 7) === month
      );
      const net = roundAmount(monthlyTransactions.reduce((sum, transaction) => sum + Number(transaction.delta || 0), 0));
      const balance = balanceAtEndOfMonth(type, transactions, monthEnd);
      row.push(monthlyTransactions.length ? net : "");
      row.push(balance);
      if (monthlyTransactions.length) numberCells.push({ row: index + 1, col: row.length - 2 });
      numberCells.push({ row: index + 1, col: row.length - 1 });
    });

    row.push(commentsForMonth(data, transactions, month));
    values.push(row);
  });

  const widths = headers.map((header, col) =>
    Math.min(
      48,
      Math.max(
        String(header).length + 2,
        ...values.slice(1).map((row) => String(row[col] ?? "").length + 2)
      )
    )
  );

  return { values, widths, numberCells };
}

function balanceAtEndOfMonth(type, transactions, monthEnd) {
  const total = transactions
    .filter((transaction) => transaction.leaveTypeId === type.id && transaction.date <= monthEnd)
    .reduce((sum, transaction) => sum + Number(transaction.delta || 0), Number(type.startingBalance || 0));
  return roundAmount(total);
}

function commentsForMonth(data, transactions, month) {
  return transactions
    .filter((transaction) => transaction.date.slice(0, 7) === month)
    .map((transaction) => {
      const type = findLeaveType(data, transaction.leaveTypeId);
      if (!type) return "";
      const note = transaction.note ? ` · ${transaction.note}` : "";
      return `${transaction.date} · ${type.name} · ${formatAmount(transaction.delta, type.unit, { signed: true })}${note}`;
    })
    .filter(Boolean)
    .join("; ");
}

function monthsBetween(startMonth, endMonth) {
  const months = [];
  const [startYear, startIndex] = startMonth.split("-").map(Number);
  const [endYear, endIndex] = endMonth.split("-").map(Number);
  const cursor = new Date(startYear, startIndex - 1, 1);
  const end = new Date(endYear, endIndex - 1, 1);

  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function lastDayOfMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await import("./vendor/xlsx.full.min.js");
  if (!window.XLSX) throw new Error("Excel exporter is unavailable.");
  return window.XLSX;
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
