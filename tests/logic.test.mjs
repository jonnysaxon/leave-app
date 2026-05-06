import assert from "node:assert/strict";
import test from "node:test";

import { accrualDates, applyAccruals } from "../assets/accrual.js";
import { buildSummaryRows } from "../assets/excel.js";
import { addTransaction, mergeDataDocuments, recomputeBalances, updateTransaction } from "../assets/storage.js";

function baseData() {
  return {
    schemaVersion: 1,
    updatedAt: "2026-05-01T00:00:00.000Z",
    leaveTypes: [
      {
        id: "annual",
        name: "Annual Leave",
        unit: "hours",
        startingBalance: 10,
        balance: 10,
        allowNegative: true,
        accrual: {
          enabled: true,
          amount: 2,
          frequency: "monthly",
          anchorDate: "2026-01-31",
          lastAppliedDate: "2026-02-28"
        }
      }
    ],
    transactions: [],
    settings: { github: { repo: "", branch: "main", path: "leave.json", token: "" } }
  };
}

test("accrual dates respect month ends and last applied date", () => {
  assert.deepEqual(
    accrualDates({
      anchorDate: "2026-01-31",
      lastAppliedDate: "2026-02-28",
      frequency: "monthly",
      today: "2026-05-06"
    }),
    ["2026-03-31", "2026-04-30"]
  );
});

test("applyAccruals is idempotent", () => {
  const first = applyAccruals(baseData(), "2026-05-06");
  const second = applyAccruals(first.data, "2026-05-06");
  assert.equal(first.data.transactions.length, 2);
  assert.equal(second.data.transactions.length, 2);
  assert.equal(second.changed, false);
});

test("balances recompute after transaction edits", () => {
  let data = baseData();
  data.leaveTypes[0].accrual.enabled = false;
  data = addTransaction(data, { leaveTypeId: "annual", date: "2026-05-01", delta: -3, note: "" });
  assert.equal(data.leaveTypes[0].balance, 7);
  data = updateTransaction(data, data.transactions[0].id, { date: "2026-05-01", delta: -5, note: "" });
  assert.equal(data.leaveTypes[0].balance, 5);
});

test("excel summary computes monthly net, balance, and comments", () => {
  const data = recomputeBalances({
    ...baseData(),
    leaveTypes: [{ ...baseData().leaveTypes[0], accrual: { enabled: false }, startingBalance: 10 }],
    transactions: [
      {
        id: "t1",
        leaveTypeId: "annual",
        date: "2026-04-22",
        delta: -7.5,
        note: "Dentist appointment",
        kind: "manual",
        createdAt: "2026-04-22T00:00:00.000Z"
      }
    ]
  });
  const summary = buildSummaryRows(data, "2026-04", "2026-05");
  assert.equal(summary.values[1][1], -7.5);
  assert.equal(summary.values[1][2], 2.5);
  assert.match(summary.values[1][3], /Dentist appointment/);
  assert.equal(summary.values[2][1], "");
  assert.equal(summary.values[2][2], 2.5);
});

test("mergeDataDocuments preserves local-only records when remote is newer", () => {
  const local = {
    ...baseData(),
    updatedAt: "2026-05-01T00:00:00.000Z",
    transactions: [
      {
        id: "local-only",
        leaveTypeId: "annual",
        date: "2026-05-01",
        delta: -1,
        note: "Local entry",
        kind: "manual",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ]
  };
  const remote = {
    ...baseData(),
    updatedAt: "2026-05-02T00:00:00.000Z",
    transactions: [
      {
        id: "remote-only",
        leaveTypeId: "annual",
        date: "2026-05-02",
        delta: -2,
        note: "Remote entry",
        kind: "manual",
        createdAt: "2026-05-02T00:00:00.000Z"
      }
    ]
  };

  const merge = mergeDataDocuments(local, remote);
  assert.equal(merge.changed, true);
  assert.deepEqual(
    merge.data.transactions.map((transaction) => transaction.id).sort(),
    ["local-only", "remote-only"]
  );
  assert.equal(merge.data.leaveTypes[0].balance, 7);
});
