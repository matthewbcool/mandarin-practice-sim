import { drinks, iceLevels, missingRequiredFields, orderTotal, sizes, sweetnessLevels, toppings } from "./menu";
import type { ParsedUtterance, SideIntent } from "./parser";
import type { DialogueTurn, GameMode, GamePhase, MenuOption, Order } from "./types";
import { geminiLivePlan } from "../voice/geminiLivePlan";

type PendingPrompt = "none" | "drink" | "size" | "sweetness" | "ice" | "confirm";

type GeminiIntentPayload = {
  orderPatch?: {
    quantity?: number | null;
    drinkId?: string | null;
    sizeId?: string | null;
    sweetnessId?: string | null;
    iceId?: string | null;
    toppingIds?: string[] | null;
  };
  sideIntent?: {
    type?: string;
    topic?: string;
  } | null;
  confirms?: boolean;
  denies?: boolean;
  cashierLine?: string;
  confidence?: number;
  model?: string;
};

export type GeminiIntentResult = {
  parsed: ParsedUtterance;
  cashierLine?: string;
  model?: string;
};

export async function interpretFreeFlowUtterance(args: {
  text: string;
  mode: GameMode;
  phase: GamePhase;
  currentOrder: Order;
  targetOrder?: Order;
  pendingPrompt: PendingPrompt;
  pendingSuggestion?: Partial<Order>;
  localParsed: ParsedUtterance;
  recentTurns?: DialogueTurn[];
}): Promise<GeminiIntentResult> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), geminiLivePlan.intentTimeoutMs);
    const response = await fetch(geminiLivePlan.intentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        transcript: args.text,
        mode: args.mode,
        phase: args.phase,
        pendingPrompt: args.pendingPrompt,
        currentOrder: serializeOrder(args.currentOrder),
        targetOrder: args.targetOrder ? serializeOrder(args.targetOrder) : undefined,
        pendingSuggestion: serializePatch(args.pendingSuggestion ?? {}),
        localParsed: serializeParsed(args.localParsed),
        orderAfterLocalParse: serializeOrder(mergeOrderPreview(args.currentOrder, args.localParsed.orderPatch)),
        missingFieldsBefore: missingRequiredFields(args.currentOrder, args.targetOrder),
        missingFieldsAfterLocalParse: missingRequiredFields(mergeOrderPreview(args.currentOrder, args.localParsed.orderPatch), args.targetOrder),
        totalAfterLocalParse: orderTotal(mergeOrderPreview(args.currentOrder, args.localParsed.orderPatch)),
        recentTurns: serializeTurns(args.recentTurns ?? []),
        menu: serializeMenu(),
      }),
    }).finally(() => window.clearTimeout(timeout));

    if (!response.ok) throw new Error(`Gemini intent returned ${response.status}`);
    const payload = (await response.json()) as GeminiIntentPayload;
    const geminiPatch = hydratePatch(payload.orderPatch, args.text);
    const orderPatch = mergePatches(args.localParsed.orderPatch, geminiPatch);
    const hasOrderPatch = Object.keys(orderPatch).length > 0;
    const sideIntent = hasOrderPatch ? undefined : hydrateSideIntent(payload.sideIntent) ?? args.localParsed.sideIntent;

    return {
      parsed: {
        ...args.localParsed,
        ...(sideIntent ? { sideIntent } : { sideIntent: undefined }),
        orderPatch,
        confirms: args.localParsed.confirms || Boolean(payload.confirms),
        denies: args.localParsed.denies || Boolean(payload.denies),
      },
      cashierLine: cleanCashierLine(payload.cashierLine),
      model: payload.model,
    };
  } catch (error) {
    if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_GEMINI_LIVE === "1") {
      console.info("[Gemini Intent] using local parser fallback", error);
    }
    return { parsed: args.localParsed };
  }
}

function serializeParsed(parsed: ParsedUtterance) {
  return {
    orderPatch: serializePatch(parsed.orderPatch),
    sideIntent: parsed.sideIntent,
    politeHits: parsed.politeHits,
    confirms: parsed.confirms,
    denies: parsed.denies,
    asksRepeat: parsed.asksRepeat,
  };
}

function serializePatch(patch: Partial<Order>) {
  return {
    quantity: patch.quantity,
    drinkId: patch.drink?.id,
    sizeId: patch.size?.id,
    sweetnessId: patch.sweetness?.id,
    iceId: patch.ice?.id,
    toppingIds: patch.toppings?.map((item) => item.id),
  };
}

function serializeOrder(order: Order) {
  return {
    quantity: order.quantity,
    drinkId: order.drink?.id,
    drinkLabel: order.drink?.label,
    sizeId: order.size?.id,
    sizeLabel: order.size?.label,
    sweetnessId: order.sweetness?.id,
    sweetnessLabel: order.sweetness?.label,
    iceId: order.ice?.id,
    iceLabel: order.ice?.label,
    toppingIds: order.toppings.map((item) => item.id),
    toppingLabels: order.toppings.map((item) => item.label),
  };
}

function serializeTurns(turns: DialogueTurn[]) {
  return turns
    .slice(0, 6)
    .reverse()
    .map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
    }));
}

function serializeMenu() {
  return {
    drinks: drinks.map(serializeOption),
    sizes: sizes.map(serializeOption),
    sweetnessLevels: sweetnessLevels.map(serializeOption),
    iceLevels: iceLevels.map(serializeOption),
    toppings: toppings.map(serializeOption),
  };
}

function serializeOption(option: MenuOption) {
  return {
    id: option.id,
    label: option.label,
    aliases: option.aliases,
    price: option.price ?? 0,
  };
}

function mergeOrderPreview(current: Order, patch: Partial<Order>): Order {
  return {
    quantity: patch.quantity ?? current.quantity,
    drink: patch.drink ?? current.drink,
    size: patch.size ?? current.size,
    sweetness: patch.sweetness ?? current.sweetness,
    ice: patch.ice ?? current.ice,
    toppings: patch.toppings ?? current.toppings,
  };
}

function hydratePatch(raw: GeminiIntentPayload["orderPatch"], transcript: string): Partial<Order> {
  if (!raw) return {};
  const patch: Partial<Order> = {};
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && raw.quantity > 0) {
    patch.quantity = Math.min(4, Math.max(1, Math.round(raw.quantity)));
  }
  const drink = findById(drinks, raw.drinkId);
  const size = findById(sizes, raw.sizeId);
  const sweetness = findById(sweetnessLevels, raw.sweetnessId);
  const ice = findById(iceLevels, raw.iceId);
  const toppingHits = Array.isArray(raw.toppingIds)
    ? raw.toppingIds.map((id) => findById(toppings, id)).filter((item): item is MenuOption => Boolean(item))
    : [];

  if (drink) patch.drink = drink;
  if (size) patch.size = size;
  if (sweetness) patch.sweetness = sweetness;
  if (ice) patch.ice = ice;
  if (toppingHits.length && explicitlyAddsTopping(transcript)) patch.toppings = toppingHits;
  return patch;
}

function explicitlyAddsTopping(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return ["加", "加料", "加一份", "加一個", "加點", "多加", "配", "放", "with", "extra"].some((term) => normalized.includes(term));
}

function hydrateSideIntent(raw: GeminiIntentPayload["sideIntent"]): SideIntent | undefined {
  if (raw?.type === "radio.nextTrack") return { type: "radio.nextTrack" };
  if (raw?.type !== "cashier.advice") return undefined;
  const topic = raw.topic;
  if (topic === "sweetness" || topic === "ice" || topic === "size" || topic === "topping" || topic === "drink" || topic === "general") {
    return { type: "cashier.advice", topic };
  }
  return { type: "cashier.advice", topic: "general" };
}

function mergePatches(localPatch: Partial<Order>, geminiPatch: Partial<Order>): Partial<Order> {
  const toppingsPatch = dedupeOptions([...(localPatch.toppings ?? []), ...(geminiPatch.toppings ?? [])]);
  return {
    ...localPatch,
    ...geminiPatch,
    ...(toppingsPatch.length ? { toppings: toppingsPatch } : {}),
  };
}

function dedupeOptions(items: MenuOption[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cleanCashierLine(text?: string) {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 90);
}

function findById<T extends MenuOption>(items: T[], id?: string | null) {
  return id ? items.find((item) => item.id === id) : undefined;
}
