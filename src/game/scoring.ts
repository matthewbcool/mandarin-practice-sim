import { describeOrder, orderTotal, ordersMatch } from "./menu";
import type { GameMode, Order, Receipt, RoundObjective, RoundStats } from "./types";

export function buildReceipt(params: {
  mode: GameMode;
  objective?: RoundObjective;
  recognized: Order;
  stats: RoundStats;
  success: boolean;
}): Receipt {
  const { mode, objective, recognized, stats, success } = params;
  const elapsed = ((stats.endedAt ?? Date.now()) - stats.startedAt) / 1000;
  const correctness = success && (!objective || ordersMatch(recognized, objective.target)) ? 60 : 0;
  const politeness = Math.min(15, new Set(stats.politeHits).size * 3);
  const smoothness = Math.max(0, 15 - Math.floor(Math.max(0, elapsed - 18) / 4) - stats.corrections * 2);
  const clarity = Math.max(0, 10 - stats.repeats * 3 - stats.technicalMisses * 2);
  const score = Math.max(0, Math.min(100, correctness + politeness + smoothness + clarity));

  return {
    id: crypto.randomUUID(),
    mode,
    objective,
    recognized,
    score,
    success,
    scoreParts: {
      correctness,
      politeness,
      smoothness,
      clarity,
    },
    lines: [
      success ? "點單成功" : "點單失敗",
      `目標：${objective ? describeOrder(objective.target) : "自由點單"}`,
      `實際：${describeOrder(recognized)}`,
      `金額：${orderTotal(recognized)} 元`,
      `修正：${stats.corrections} 次`,
      `禮貌：${stats.politeHits.length ? Array.from(new Set(stats.politeHits)).join("、") : "尚可再加強"}`,
    ],
    createdAt: new Date().toISOString(),
  };
}

export function loadReceipts(storageKey = "boba-receipts"): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Receipt[];
  } catch {
    return [];
  }
}

export function saveReceipt(receipt: Receipt, storageKey = "boba-receipts"): Receipt[] {
  const receipts = [receipt, ...loadReceipts(storageKey)].slice(0, 40);
  localStorage.setItem(storageKey, JSON.stringify(receipts));
  return receipts;
}
