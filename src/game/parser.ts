import { drinks, emptyOrder, iceLevels, politePhrases, sizes, sweetnessLevels, toppings } from "./menu";
import type { MenuOption, Order } from "./types";

export interface ParsedUtterance {
  text: string;
  sideIntent?: SideIntent;
  orderPatch: Partial<Order>;
  politeHits: string[];
  confirms: boolean;
  denies: boolean;
  asksRepeat: boolean;
}

export type SideIntent = { type: "radio.nextTrack" };

export function parseUtterance(text: string): ParsedUtterance {
  const normalized = normalize(text);
  const sideIntent = parseSideIntent(normalized);
  if (sideIntent) {
    return {
      text,
      sideIntent,
      orderPatch: {},
      politeHits: [],
      confirms: false,
      denies: false,
      asksRepeat: false,
    };
  }

  const drink = findOption(normalized, drinks);
  const size = findOption(normalized, sizes);
  const sweetness = findOption(normalized, sweetnessLevels);
  const ice = findOption(normalized, iceLevels);
  const toppingHits = toppings.filter((topping) => hasAny(normalized, topping.aliases));
  const quantity = parseQuantity(normalized);
  const politeHits = politePhrases.filter((phrase) => normalized.includes(phrase));

  return {
    text,
    orderPatch: {
      ...(quantity ? { quantity } : {}),
      ...(drink ? { drink } : {}),
      ...(size ? { size } : {}),
      ...(sweetness ? { sweetness } : {}),
      ...(ice ? { ice } : {}),
      ...(toppingHits.length ? { toppings: toppingHits } : {}),
    },
    politeHits,
    confirms: ["對", "對啊", "沒錯", "可以", "好", "是", "嗯", "正確"].some((term) => normalized.includes(term)),
    denies: ["不對", "不是", "錯了", "改成", "我要改", "等一下"].some((term) => normalized.includes(term)),
    asksRepeat: ["再說一次", "聽不懂", "什麼", "不好意思"].some((term) => normalized.includes(term)),
  };
}

export function mergeOrder(current: Order, patch: Partial<Order>): Order {
  const next = {
    ...current,
    ...patch,
    toppings: patch.toppings?.length ? dedupeToppings([...current.toppings, ...patch.toppings]) : current.toppings,
  };
  return next.quantity ? next : { ...next, quantity: 1 };
}

export function resetOrder(): Order {
  return emptyOrder();
}

function findOption(text: string, options: MenuOption[]): MenuOption | undefined {
  return options.find((option) => hasAny(text, option.aliases));
}

function hasAny(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => text.includes(normalize(alias)));
}

function parseQuantity(text: string): number | undefined {
  if (text.includes("兩杯") || text.includes("二杯") || text.includes("2杯")) return 2;
  if (text.includes("三杯") || text.includes("3杯")) return 3;
  if (text.includes("四杯") || text.includes("4杯")) return 4;
  if (text.includes("一杯") || text.includes("1杯")) return 1;
  return undefined;
}

function parseSideIntent(text: string): SideIntent | undefined {
  const radioCommands = ["換音樂", "換一首", "下一首", "可以換音樂嗎", "幫我換一首"];
  if (radioCommands.some((command) => text.includes(command))) {
    return { type: "radio.nextTrack" };
  }
  return undefined;
}

function dedupeToppings(items: MenuOption[]): MenuOption[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?]/g, "");
}
