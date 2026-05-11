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

export type SideIntent =
  | { type: "radio.nextTrack" }
  | {
      type: "cashier.advice";
      topic: "sweetness" | "ice" | "size" | "topping" | "drink" | "general";
    };

type OptionMatch = { option: MenuOption; alias: string; length: number; index: number; afterDecisionCue: boolean };
type MatchOptions = { ignoreNegated?: boolean };

export function parseUtterance(text: string): ParsedUtterance {
  const normalized = normalize(text);
  const politeHits = politePhrases.filter((phrase) => normalized.includes(phrase));

  const drinkMatch = findOptionMatch(normalized, drinks, { ignoreNegated: true });
  const drink = drinkMatch?.option;
  const size = findOption(normalized, sizes, { ignoreNegated: true }) ?? inferNaturalSize(normalized);
  const sweetness = findOption(normalized, sweetnessLevels) ?? inferNaturalSweetness(normalized);
  const ice = findOption(normalized, iceLevels) ?? inferNaturalIce(normalized);
  const toppingHits = toppings.filter((topping) => {
    const toppingMatch = findOptionMatch(normalized, [topping], { ignoreNegated: true });
    if (!toppingMatch) return false;
    if (
      drinkMatch &&
      toppingMatch.index < drinkMatch.index &&
      hasCorrectionCueBetween(normalized, toppingMatch.index + toppingMatch.length, drinkMatch.index) &&
      !hasExplicitTopping(normalized, topping)
    ) {
      return false;
    }
    const builtIntoDrinkName = drinkMatch?.alias && hasAny(drinkMatch.alias, topping.aliases);
    return !builtIntoDrinkName || hasExplicitTopping(normalized, topping);
  });
  const quantity = parseQuantity(normalized);
  const orderPatch = {
    ...(quantity ? { quantity } : {}),
    ...(drink ? { drink } : {}),
    ...(size ? { size } : {}),
    ...(sweetness ? { sweetness } : {}),
    ...(ice ? { ice } : {}),
    ...(toppingHits.length ? { toppings: toppingHits } : {}),
  };
  const hasOrderPatch = Object.keys(orderPatch).length > 0;
  const sideIntent = parseSideIntent(normalized);

  return {
    text,
    ...(sideIntent && !hasOrderPatch ? { sideIntent } : {}),
    orderPatch,
    politeHits,
    confirms: detectConfirmation(normalized),
    denies: detectDenial(normalized),
    asksRepeat: asksRepeat(normalized),
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

function findOption(text: string, options: MenuOption[], matchOptions?: MatchOptions): MenuOption | undefined {
  return findOptionMatch(text, options, matchOptions)?.option;
}

function findOptionMatch(text: string, options: MenuOption[], matchOptions: MatchOptions = {}): OptionMatch | undefined {
  return options
    .flatMap((option) =>
      option.aliases.flatMap((rawAlias) => {
        const alias = normalize(rawAlias);
        if (!alias) return [];
        return aliasIndexes(text, alias)
          .filter((index) => isUsableShortAlias(text, alias, index))
          .filter((index) => !matchOptions.ignoreNegated || !isNegatedAlias(text, index))
          .map((index) => ({
            option,
            alias,
            length: alias.length,
            index,
            afterDecisionCue: hasDecisionCueBefore(text, index),
          }));
      }),
    )
    .sort((a, b) => {
      if (a.afterDecisionCue !== b.afterDecisionCue) return Number(b.afterDecisionCue) - Number(a.afterDecisionCue);
      if (a.afterDecisionCue && a.index !== b.index) return b.index - a.index;
      if (a.length !== b.length) return b.length - a.length;
      return b.index - a.index;
    })[0];
}

function hasAny(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => text.includes(normalize(alias)));
}

function hasExplicitTopping(text: string, topping: MenuOption): boolean {
  return topping.aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return [
      `加${normalizedAlias}`,
      `加一份${normalizedAlias}`,
      `加一個${normalizedAlias}`,
      `加點${normalizedAlias}`,
      `多加${normalizedAlias}`,
      `要加${normalizedAlias}`,
      `我要加${normalizedAlias}`,
      `幫我加${normalizedAlias}`,
      `配${normalizedAlias}`,
      `配一點${normalizedAlias}`,
    ].some((phrase) => text.includes(phrase));
  });
}

function inferNaturalSize(text: string): MenuOption | undefined {
  if (["不要大杯", "不用大杯", "不用大的", "不要大的", "不加大"].some((phrase) => text.includes(phrase))) {
    return byId(sizes, "medium");
  }
  if (["不要中杯", "不用中杯", "不要中的"].some((phrase) => text.includes(phrase))) {
    return byId(sizes, "large");
  }
  if (["加大", "升級", "做大", "大杯好了"].some((phrase) => text.includes(phrase))) return byId(sizes, "large");
  if (["一般大小", "普通大小", "標準杯", "中杯就好"].some((phrase) => text.includes(phrase))) return byId(sizes, "medium");
  return undefined;
}

function inferNaturalSweetness(text: string): MenuOption | undefined {
  if (!mentionsSweetness(text) && !mentionsSharedNormal(text)) return undefined;
  if (
    mentionsSharedNormal(text) ||
    text.includes("正常") ||
    text.includes("全糖") ||
    text.includes("全甜") ||
    text.includes("標準甜") ||
    text.includes("糖正常") ||
    text.includes("甜度正常")
  ) {
    return byId(sweetnessLevels, "regular-sugar");
  }
  if (
    text.includes("少糖") ||
    text.includes("少甜") ||
    text.includes("不要太甜") ||
    text.includes("不用太甜") ||
    text.includes("糖少一點") ||
    text.includes("六分") ||
    text.includes("七分") ||
    text.includes("八分")
  ) {
    return byId(sweetnessLevels, "less-sugar");
  }
  if (text.includes("半糖") || text.includes("半甜") || text.includes("五分") || text.includes("四分")) return byId(sweetnessLevels, "half-sugar");
  if (text.includes("微糖") || text.includes("微甜") || text.includes("三分") || text.includes("二分") || text.includes("一分")) {
    return byId(sweetnessLevels, "light-sugar");
  }
  if (
    text.includes("無糖") ||
    text.includes("無甜") ||
    text.includes("零糖") ||
    text.includes("不要糖") ||
    text.includes("不加糖") ||
    text.includes("不甜") ||
    text.includes("wutian") ||
    text.includes("wutien")
  ) {
    return byId(sweetnessLevels, "no-sugar");
  }
  return undefined;
}

function inferNaturalIce(text: string): MenuOption | undefined {
  if (!mentionsIce(text) && !mentionsSharedNormal(text)) return undefined;
  if (mentionsSharedNormal(text)) return byId(iceLevels, "regular-ice");
  if (text.includes("去冰") || text.includes("不要冰") || text.includes("不加冰") || text.includes("常溫") || text.includes("完全去冰")) {
    return byId(iceLevels, "no-ice");
  }
  if (text.includes("熱") || text.includes("溫")) return byId(iceLevels, "hot");
  if (text.includes("正常") || text.includes("一般冰") || text.includes("標準冰") || text.includes("冰正常") || text.includes("冰的")) {
    return byId(iceLevels, "regular-ice");
  }
  if (text.includes("少冰") || text.includes("冰少") || text.includes("少一點冰") || text.includes("不要太冰")) return byId(iceLevels, "less-ice");
  if (text.includes("微冰") || text.includes("一點冰") || text.includes("一點點冰") || text.includes("微微冰")) return byId(iceLevels, "light-ice");
  return undefined;
}

function byId(options: MenuOption[], id: string): MenuOption | undefined {
  return options.find((option) => option.id === id);
}

function mentionsSweetness(text: string) {
  return ["甜度", "甜", "糖", "八分", "七分", "六分", "五分", "四分", "三分", "二分", "一分", "wutian", "wutien"].some((term) =>
    text.includes(term),
  );
}

function mentionsIce(text: string) {
  return ["冰塊", "冰量", "冰", "冷", "熱", "溫", "常溫"].some((term) => text.includes(term));
}

function mentionsSharedNormal(text: string) {
  return ["甜度冰塊都正常", "甜度跟冰塊都正常", "糖冰都正常", "糖冰正常", "都正常"].some((term) => text.includes(term));
}

function parseQuantity(text: string): number | undefined {
  const match = /([0-9一二兩三四五六七八九十]+)(?:杯|份|個)/.exec(text);
  if (!match) return undefined;
  return parseQuantityToken(match[1]);
}

function parseSideIntent(text: string): SideIntent | undefined {
  const radioCommands = ["換音樂", "換歌", "換一首", "下一首", "下一個音樂", "音樂下一首", "可以換音樂嗎", "幫我換一首"];
  if (radioCommands.some((command) => text.includes(command))) {
    return { type: "radio.nextTrack" };
  }

  if (asksForAdvice(text)) {
    if (["甜度", "甜", "糖", "半糖", "微糖", "無糖", "少糖", "全糖"].some((term) => text.includes(term))) {
      return { type: "cashier.advice", topic: "sweetness" };
    }
    if (["冰塊", "冰", "少冰", "微冰", "去冰", "正常冰", "熱的"].some((term) => text.includes(term))) {
      return { type: "cashier.advice", topic: "ice" };
    }
    if (["杯型", "大小", "大杯", "中杯", "尺寸"].some((term) => text.includes(term))) {
      return { type: "cashier.advice", topic: "size" };
    }
    if (["加料", "配料", "珍珠", "波霸", "椰果", "布丁", "芋圓", "仙草"].some((term) => text.includes(term))) {
      return { type: "cashier.advice", topic: "topping" };
    }
    if (["喝什麼", "哪一杯", "飲料", "奶茶", "茶"].some((term) => text.includes(term))) {
      return { type: "cashier.advice", topic: "drink" };
    }
    return { type: "cashier.advice", topic: "general" };
  }
  return undefined;
}

function asksForAdvice(text: string): boolean {
  return [
    "推薦",
    "有推薦",
    "推薦一下",
    "建議",
    "你覺得",
    "妳覺得",
    "怎麼選",
    "怎麼點",
    "怎麼做",
    "哪個比較好",
    "哪一個比較好",
    "什麼比較好",
    "幫我選",
    "幫我挑",
    "可以幫我",
  ].some((phrase) => text.includes(phrase));
}

function detectConfirmation(text: string): boolean {
  if (asksRepeat(text)) return false;
  if (detectDenial(text) && !["不用加料", "不用了", "不需要", "沒有了", "沒了"].some((phrase) => text.includes(phrase))) return false;
  if (
    [
      "對",
      "好",
      "是",
      "是的",
      "是啊",
      "是喔",
      "嗯",
      "ok",
      "okay",
      "yes",
      "yep",
      "yeah",
      "sure",
      "correct",
      "keyi",
      "keyee",
      "shide",
      "shida",
      "shouldthe",
      "shoulda",
      "surethe",
      "callyee",
      "callie",
    ].includes(text)
  ) {
    return true;
  }
  return [
    "對啊",
    "對的",
    "沒錯",
    "正確",
    "可以",
    "沒問題",
    "好啊",
    "好的",
    "好喔",
    "好啦",
    "就這樣",
    "先這樣",
    "這樣就好",
    "就好",
    "好了",
    "不用加料",
    "不用了",
    "不需要",
    "沒有了",
    "沒了",
    "allgood",
    "looksright",
  ].some((term) => text.includes(term));
}

function detectDenial(text: string): boolean {
  if (text === "錯") return true;
  return [
    "不對",
    "不是",
    "錯了",
    "有錯",
    "不行",
    "不可以",
    "不要了",
    "不用了",
    "不用",
    "不需要",
    "沒有了",
    "沒了",
    "等一下",
    "先等一下",
    "我要改",
    "改成",
    "換成",
    "改一下",
    "換一下",
    "改",
    "換",
  ].some((term) => text.includes(term));
}

function asksRepeat(text: string): boolean {
  return ["再說一次", "再講一次", "重複一次", "可以重複", "聽不懂", "沒聽清楚", "什麼", "蛤", "不好意思"].some((term) =>
    text.includes(term),
  );
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
  return text
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[乌龙观铁鲜绿柠冻圆盖没]/g, (char) => simplifiedCharacterMap[char] ?? char)
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "");
}

function aliasIndexes(text: string, alias: string): number[] {
  const indexes: number[] = [];
  let index = text.indexOf(alias);
  while (index >= 0) {
    indexes.push(index);
    index = text.indexOf(alias, index + 1);
  }
  return indexes;
}

function hasDecisionCueBefore(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 8), index);
  if (["不要", "不用", "不想", "不加", "不需要", "沒有要", "先不要"].some((cue) => before.endsWith(cue))) return false;
  return ["改成", "換成", "變成", "做成", "改", "換", "做", "點", "選", "來", "我要", "要", "幫我", "麻煩"].some((cue) =>
    before.endsWith(cue),
  );
}

function isUsableShortAlias(text: string, alias: string, index: number) {
  if (alias !== "大" && alias !== "中") return true;
  if (text === alias || hasDecisionCueBefore(text, index)) return true;
  const after = text.slice(index + alias.length, index + alias.length + 2);
  return after.startsWith("杯") || after.startsWith("的");
}

function hasCorrectionCueBetween(text: string, start: number, end: number) {
  const segment = text.slice(start, end);
  return ["改成", "換成", "改", "換", "變成"].some((cue) => segment.includes(cue));
}

function isNegatedAlias(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 6), index);
  return ["不要", "不用", "不加", "不需要", "不想加", "先不要", "沒有要", "免", "去掉", "拿掉"].some((cue) => before.endsWith(cue));
}

function parseQuantityToken(token: string): number | undefined {
  const direct = Number(token);
  if (Number.isInteger(direct) && direct > 0 && direct < 10) return direct;
  const quantityMap: Record<string, number> = {
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return quantityMap[token];
}

const simplifiedCharacterMap: Record<string, string> = {
  乌: "烏",
  龙: "龍",
  观: "觀",
  铁: "鐵",
  鲜: "鮮",
  绿: "綠",
  柠: "檸",
  冻: "凍",
  圆: "圓",
  盖: "蓋",
  没: "沒",
};
