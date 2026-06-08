import type { ParsedUtterance } from "../../game/parser";
import type { GameMode, GamePhase, MenuOption, Order } from "../../game/types";
import { drinks, iceLevels, missingRequiredFields, sizes, sweetnessLevels } from "../../game/menu";

type PendingOrderPrompt = "none" | "drink" | "size" | "sweetness" | "ice" | "confirm";
type CashierPrompt = {
  text: string;
  suggestion?: Partial<Order>;
};

export function applyBobaPromptContext(text: string, patch: Partial<Order>, current: Order, pendingPrompt: string): Partial<Order> {
  const normalized = normalizePromptAnswer(text);
  const prompt = isPendingOrderPrompt(pendingPrompt) ? pendingPrompt : "none";
  const contextualPatch = { ...patch };
  const missing = missingRequiredFields(current);
  const canInferSweetness = prompt !== "ice" || mentionsExplicitSweetness(normalized);
  const canInferIce = prompt !== "sweetness" || mentionsExplicitIce(normalized);

  if (prompt === "sweetness") {
    if (!mentionsExplicitIce(normalized) && !current.ice) delete contextualPatch.ice;
    contextualPatch.sweetness ??= inferSweetnessAnswer(normalized);
  }

  if (prompt === "ice") {
    if (!mentionsExplicitSweetness(normalized) && !current.sweetness) delete contextualPatch.sweetness;
    contextualPatch.ice ??= inferIceAnswer(normalized);
  }

  if (missing.includes("杯型")) {
    contextualPatch.size ??= inferSizeAnswer(normalized);
  }

  if (missing.includes("甜度") && canInferSweetness) {
    contextualPatch.sweetness ??= inferSweetnessAnswer(normalized);
  }

  if (missing.includes("冰塊") && canInferIce) {
    contextualPatch.ice ??= inferIceAnswer(normalized);
  }

  return contextualPatch;
}

export function isBobaOrderRevision(current: Order, patch: Partial<Order>) {
  if (patch.quantity && current.quantity && patch.quantity !== current.quantity) return true;
  if (patch.drink && current.drink && patch.drink.id !== current.drink.id) return true;
  if (patch.size && current.size && patch.size.id !== current.size.id) return true;
  if (patch.sweetness && current.sweetness && patch.sweetness.id !== current.sweetness.id) return true;
  if (patch.ice && current.ice && patch.ice.id !== current.ice.id) return true;
  return false;
}

export function isBobaOrderComplete(order: Order) {
  return missingRequiredFields(order).length === 0;
}

export function isLikelyBobaConfirmationResponse(text: string, parsed: ParsedUtterance) {
  if (parsed.asksRepeat || parsed.denies) return false;
  if (parsed.confirms) return true;
  const normalized = normalizeLooseAnswer(text);
  if (
    [
      "ok",
      "okay",
      "yes",
      "yep",
      "yeah",
      "sure",
      "correct",
      "是",
      "是的",
      "是啊",
      "是喔",
      "alright",
      "allright",
      "allgood",
      "looksright",
      "keyi",
      "keyee",
      "shide",
      "shida",
      "shouldthe",
      "shoulda",
      "surethe",
      "callyee",
      "callie",
      "可以",
      "可以啦",
      "可以了",
      "對",
      "對啦",
      "對了",
      "對的",
      "好",
      "好啊",
      "好的",
      "好喔",
      "好啦",
    ].includes(normalized)
  ) {
    return true;
  }

  return [
    "ok",
    "okay",
    "allgood",
    "looksright",
    "可以",
    "沒錯",
    "這樣就好",
    "就這樣",
    "不用加料",
    "不用了",
    "不需要",
    "沒有了",
    "沒了",
  ].some((phrase) => normalized.includes(phrase));
}

export function shouldAskBobaGeminiIntent(mode: GameMode, parsed: ParsedUtterance) {
  if (parsed.sideIntent?.type === "radio.nextTrack") return false;
  const hasOrderPatch = Object.keys(parsed.orderPatch).length > 0;
  if (parsed.confirms && !hasOrderPatch) return false;
  if (parsed.denies && !hasOrderPatch) return false;
  return true;
}

export function bobaFreeFlowPromptKey(order: Order, missing: string[], source: "ask" | "repair" | "idle" | "deny") {
  const drink = order.drink?.id ?? "no-drink";
  const fields = missing.length ? missing.join("-") : "complete";
  return `${source}:${drink}:${fields}`;
}

export function promptForBobaMissingFields(missing: string[]): PendingOrderPrompt {
  if (missing.includes("飲料")) return "drink";
  if (missing.includes("杯型")) return "size";
  if (missing.includes("甜度")) return "sweetness";
  if (missing.includes("冰塊")) return "ice";
  return "none";
}

export function buildBobaFreeFlowMissingQuestion(order: Order, missing: string[], attempt: number): CashierPrompt {
  if (!order.drink) {
    return pickPrompt(
      [
        { text: "想喝什麼？" },
        { text: "今天想點哪一杯？" },
        { text: "有想好要喝什麼嗎？" },
        { text: "那我先推薦珍珠奶茶，可以嗎？", suggestion: { drink: byId(drinks, "pearl-milk-tea") } },
      ],
      attempt,
    );
  }

  if (missing.includes("杯型") && missing.includes("甜度") && missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "中杯還是大杯？甜度冰塊怎麼做？" },
        { text: "杯型、甜度、冰塊要怎麼做？" },
        { text: "我先確認一下，要大杯嗎？甜度冰塊呢？", suggestion: { size: byId(sizes, "large") } },
        { text: "那先幫你做中杯、半糖、少冰可以嗎？", suggestion: defaultSizeSweetnessIcePatch() },
      ],
      attempt,
    );
  }

  if (missing.includes("杯型") && missing.includes("甜度")) {
    return pickPrompt(
      [
        { text: "中杯還是大杯？甜度呢？" },
        { text: "杯型跟甜度怎麼做？" },
        { text: "我先問杯型，你要中杯還是大杯？甜度也可以一起說。" },
        { text: "那我先幫你做中杯半糖，可以嗎？", suggestion: { size: byId(sizes, "medium"), sweetness: byId(sweetnessLevels, "half-sugar") } },
      ],
      attempt,
    );
  }

  if (missing.includes("杯型") && missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "中杯還是大杯？冰塊呢？" },
        { text: "杯型跟冰塊怎麼做？" },
        { text: "我先問杯型，你要中杯還是大杯？冰塊也可以一起說。" },
        { text: "那我先幫你做中杯少冰，可以嗎？", suggestion: { size: byId(sizes, "medium"), ice: byId(iceLevels, "less-ice") } },
      ],
      attempt,
    );
  }

  if (missing.includes("杯型")) {
    return pickPrompt(
      [
        { text: "中杯還是大杯？" },
        { text: "杯型要哪一種？" },
        { text: "要不要做大杯？", suggestion: { size: byId(sizes, "large") } },
        { text: "那先中杯可以嗎？", suggestion: { size: byId(sizes, "medium") } },
      ],
      attempt,
    );
  }

  if (missing.includes("甜度") && missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "甜度冰塊怎麼做？" },
        { text: "甜度跟冰塊呢？" },
        { text: "糖冰要怎麼調？" },
        { text: "那我先幫你做半糖少冰，可以嗎？", suggestion: defaultSweetnessIcePatch() },
      ],
      attempt,
    );
  }

  if (missing.includes("甜度")) {
    return pickPrompt(
      [
        { text: "甜度呢？" },
        { text: "甜度要怎麼做？" },
        { text: "糖要正常還是少一點？" },
        { text: "那半糖可以嗎？", suggestion: { sweetness: byId(sweetnessLevels, "half-sugar") } },
      ],
      attempt,
    );
  }

  if (missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "冰塊呢？" },
        { text: "冰量要怎麼做？" },
        { text: "要正常冰、少冰，還是去冰？" },
        { text: "那少冰可以嗎？", suggestion: { ice: byId(iceLevels, "less-ice") } },
      ],
      attempt,
    );
  }

  return { text: "好，沒問題。" };
}

export function buildBobaFreeFlowIdleHelp(order: Order, phase: GamePhase, attempt: number): CashierPrompt {
  if (phase === "confirming") {
    return pickPrompt(
      [
        { text: "如果這樣可以，跟我說一聲就好；要改也可以直接說。" },
        { text: "這張單我先放著，你看要不要改。" },
        { text: "沒問題的話，我就幫你送單囉？" },
      ],
      attempt,
    );
  }

  if (!order.drink) {
    return pickPrompt(
      [
        { text: "還在看嗎？如果不知道喝什麼，珍珠奶茶跟烏龍奶茶都蠻多人點。" },
        { text: "不急，你可以先看一下菜單。想要奶茶還是茶類？" },
        { text: "要不要先試珍珠奶茶？", suggestion: { drink: byId(drinks, "pearl-milk-tea") } },
      ],
      attempt,
    );
  }

  const missing = missingRequiredFields(order);
  if (missing.includes("杯型")) {
    return pickPrompt(
      [
        { text: "杯型的話，有中杯跟大杯。你要哪一種？" },
        { text: "如果不確定，第一次喝中杯就可以。" },
        { text: "那先做中杯可以嗎？", suggestion: { size: byId(sizes, "medium") } },
      ],
      attempt,
    );
  }

  if (missing.includes("甜度") && missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "甜度冰塊可以一起說，像半糖少冰、微糖去冰都可以。" },
        { text: "如果不確定，奶茶做半糖少冰蠻剛好的。" },
        { text: "那半糖少冰可以嗎？", suggestion: defaultSweetnessIcePatch() },
      ],
      attempt,
    );
  }

  if (missing.includes("甜度")) {
    return pickPrompt(
      [
        { text: "甜度有正常糖、少糖、半糖、微糖、無糖。你要哪一種？" },
        { text: "如果怕太甜，可以做半糖或微糖。" },
        { text: "那半糖可以嗎？", suggestion: { sweetness: byId(sweetnessLevels, "half-sugar") } },
      ],
      attempt,
    );
  }

  if (missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "冰塊有正常冰、少冰、微冰、去冰。你要哪一種？" },
        { text: "現在喝的話，我會建議少冰。" },
        { text: "那少冰可以嗎？", suggestion: { ice: byId(iceLevels, "less-ice") } },
      ],
      attempt,
    );
  }

  return pickPrompt(
    [
      { text: "這樣差不多了。還要加什麼嗎？" },
      { text: "還需要加料嗎？" },
      { text: "沒要加料的話，我就幫你結帳囉。" },
    ],
    attempt,
  );
}

export function buildBobaFreeFlowRepairQuestion(order: Order, phase: GamePhase, attempt: number): CashierPrompt {
  if (phase === "confirming") {
    return pickPrompt(
      [
        { text: "不好意思，這樣可以嗎？" },
        { text: "我確認一下，剛剛那張單 OK 嗎？" },
        { text: "如果沒問題，說可以就好。" },
      ],
      attempt,
    );
  }

  if (!order.drink) {
    return pickPrompt(
      [
        { text: "不好意思，想喝哪一杯？" },
        { text: "我剛剛沒抓到飲料名稱，想喝奶茶還是茶？" },
        { text: "要不要先點珍珠奶茶？", suggestion: { drink: byId(drinks, "pearl-milk-tea") } },
      ],
      attempt,
    );
  }

  const missing = missingRequiredFields(order);
  if (missing.includes("杯型")) {
    return pickPrompt(
      [
        { text: "不好意思，中杯還是大杯？" },
        { text: "杯型我沒聽到，要中杯嗎？", suggestion: { size: byId(sizes, "medium") } },
        { text: "那中杯可以嗎？", suggestion: { size: byId(sizes, "medium") } },
      ],
      attempt,
    );
  }
  if (missing.includes("甜度") && missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "不好意思，甜度冰塊呢？" },
        { text: "我沒聽到糖冰，半糖少冰可以嗎？", suggestion: defaultSweetnessIcePatch() },
        { text: "還是你要正常糖正常冰？", suggestion: { sweetness: byId(sweetnessLevels, "regular-sugar"), ice: byId(iceLevels, "regular-ice") } },
      ],
      attempt,
    );
  }
  if (missing.includes("甜度")) {
    return pickPrompt(
      [
        { text: "不好意思，甜度呢？" },
        { text: "糖我沒聽到，半糖可以嗎？", suggestion: { sweetness: byId(sweetnessLevels, "half-sugar") } },
        { text: "還是要微糖？", suggestion: { sweetness: byId(sweetnessLevels, "light-sugar") } },
      ],
      attempt,
    );
  }
  if (missing.includes("冰塊")) {
    return pickPrompt(
      [
        { text: "不好意思，冰塊呢？" },
        { text: "冰塊我沒聽到，少冰可以嗎？", suggestion: { ice: byId(iceLevels, "less-ice") } },
        { text: "還是要去冰？", suggestion: { ice: byId(iceLevels, "no-ice") } },
      ],
      attempt,
    );
  }
  return pickPrompt(
    [
      { text: "不好意思，我剛剛沒聽清楚。" },
      { text: "可以再說一次嗎？" },
      { text: "我這邊再確認一下，你想怎麼改？" },
    ],
    attempt,
  );
}

export function buildBobaCashierAdvice(topic: "sweetness" | "ice" | "size" | "topping" | "drink" | "general", order: Order, target?: Order) {
  const drinkId = order.drink?.id ?? target?.drink?.id;
  const targetSweetness = target?.sweetness?.label;

  if (topic === "sweetness") {
    if (targetSweetness && order.drink?.id === target?.drink?.id) {
      return `這杯我會建議${targetSweetness}，喝起來比較剛好。你要照這樣做嗎？`;
    }
    if (drinkId === "wintermelon-lemon") return "冬瓜本身就有甜，我會建議微糖或無糖。你想做哪一個？";
    if (drinkId === "brown-sugar-boba-milk") return "黑糖珍珠鮮奶本身偏甜，通常甜度不用另外加。冰塊你要少冰還是微冰？";
    if (drinkId?.includes("green") || drinkId === "sijichun") return "茶感比較清爽的話，我會建議微糖；想順口一點就半糖。你想要哪個？";
    return "奶茶類我通常會建議半糖，甜味夠但不會太膩。你要半糖嗎？";
  }

  if (topic === "ice") {
    return "如果等一下就喝，我會建議少冰；想茶味濃一點可以微冰或去冰。你要哪一種？";
  }

  if (topic === "size") {
    return "第一次喝可以中杯，想慢慢喝或加料的話大杯比較划算。你要中杯還是大杯？";
  }

  if (topic === "topping") {
    if (drinkId?.includes("milk") || drinkId?.includes("tea")) return "奶茶類加珍珠最安全，想甜一點也可以加布丁。你要加什麼？";
    return "水果茶我會建議椰果或愛玉，喝起來比較清爽。你想加哪個？";
  }

  if (topic === "drink") {
    const safePick = target?.drink?.label ?? byId(drinks, "pearl-milk-tea").label;
    return `第一次來的話，${safePick}很受歡迎。你想點這杯嗎？`;
  }

  const defaultSweetness = targetSweetness ?? byId(sweetnessLevels, "half-sugar").label;
  return `可以，我會建議先選${defaultSweetness}、少冰，喝起來比較平衡。你想照這樣做嗎？`;
}

export function normalizeBobaTranscriptKey(text: string) {
  return normalizePromptAnswer(text).replace(/[「」『』"'“”‘’]/g, "");
}

function pickPrompt(prompts: CashierPrompt[], attempt: number): CashierPrompt {
  return prompts[Math.min(attempt, prompts.length - 1)];
}

function defaultSizeSweetnessIcePatch(): Partial<Order> {
  return {
    size: byId(sizes, "medium"),
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
  };
}

function defaultSweetnessIcePatch(): Partial<Order> {
  return {
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
  };
}

function inferSizeAnswer(text: string) {
  if (["不要大杯", "不用大杯", "不用大的", "不要大的", "不加大"].some((phrase) => text.includes(phrase))) return byId(sizes, "medium");
  if (["不要中杯", "不用中杯", "不要中的"].some((phrase) => text.includes(phrase))) return byId(sizes, "large");
  if (["加大", "升級", "做大", "大杯好了"].some((phrase) => text.includes(phrase))) return byId(sizes, "large");
  if (text.includes("大杯") || text === "大" || text.includes("大的") || text.includes("大杯的")) return byId(sizes, "large");
  if (text.includes("中杯") || text === "中" || text.includes("中的") || text.includes("普通") || text.includes("一般大小")) return byId(sizes, "medium");
  return undefined;
}

function inferSweetnessAnswer(text: string) {
  if (text.includes("甜度冰塊都正常") || text.includes("甜度跟冰塊都正常") || text.includes("糖冰正常") || text.includes("都正常")) {
    return byId(sweetnessLevels, "regular-sugar");
  }
  if (mentionsExplicitIce(text) && !mentionsExplicitSweetness(text)) return undefined;
  if (text.includes("正常") || text.includes("全糖") || text.includes("全甜") || text.includes("標準甜") || text.includes("糖正常")) return byId(sweetnessLevels, "regular-sugar");
  if (text.includes("少糖") || text.includes("少甜") || text.includes("六分") || text.includes("七分") || text.includes("八分") || text.includes("不要太甜") || text.includes("不用太甜") || text.includes("糖少一點")) return byId(sweetnessLevels, "less-sugar");
  if (text.includes("半糖") || text.includes("半甜") || text.includes("五分") || text.includes("四分") || text === "半") return byId(sweetnessLevels, "half-sugar");
  if (text.includes("微糖") || text.includes("微甜") || text.includes("三分") || text.includes("二分") || text.includes("一分") || text === "微") return byId(sweetnessLevels, "light-sugar");
  if (
    text.includes("無糖") ||
    text.includes("無甜") ||
    text.includes("零糖") ||
    text.includes("不加糖") ||
    text.includes("不要糖") ||
    text.includes("不甜") ||
    text.includes("wutian") ||
    text.includes("wutien") ||
    text === "不要"
  ) {
    return byId(sweetnessLevels, "no-sugar");
  }
  return undefined;
}

function inferIceAnswer(text: string) {
  if (text.includes("甜度冰塊都正常") || text.includes("甜度跟冰塊都正常") || text.includes("糖冰正常") || text.includes("都正常")) return byId(iceLevels, "regular-ice");
  if (mentionsExplicitSweetness(text) && !mentionsExplicitIce(text)) return undefined;
  if (text.includes("去冰") || text.includes("不加冰") || text.includes("不要冰") || text.includes("常溫") || text === "不要") return byId(iceLevels, "no-ice");
  if (text.includes("熱")) return byId(iceLevels, "hot");
  if (text.includes("正常") || text === "冰" || text.includes("一般冰") || text.includes("標準冰") || text.includes("冰正常")) return byId(iceLevels, "regular-ice");
  if (text.includes("少冰") || text.includes("冰少") || text.includes("少一點冰") || text.includes("不要太冰")) return byId(iceLevels, "less-ice");
  if (text.includes("微冰") || text.includes("一點冰") || text.includes("一點點冰") || text === "微") return byId(iceLevels, "light-ice");
  return undefined;
}

function mentionsExplicitSweetness(text: string) {
  return ["糖", "甜", "八分", "七分", "六分", "五分", "四分", "三分", "二分", "一分", "wutian", "wutien"].some((term) =>
    text.includes(term),
  );
}

function mentionsExplicitIce(text: string) {
  return ["冰", "冷", "熱", "溫", "常溫"].some((term) => text.includes(term));
}

function normalizePromptAnswer(text: string) {
  return text
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[乌龙观铁鲜绿柠冻圆盖没]/g, (char) => ({ 乌: "烏", 龙: "龍", 观: "觀", 铁: "鐵", 鲜: "鮮", 绿: "綠", 柠: "檸", 冻: "凍", 圆: "圓", 盖: "蓋", 没: "沒" })[char] ?? char)
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "");
}

function normalizeLooseAnswer(text: string) {
  return normalizePromptAnswer(text).replace(/['"]/g, "");
}

function isPendingOrderPrompt(value: string): value is PendingOrderPrompt {
  return value === "none" || value === "drink" || value === "size" || value === "sweetness" || value === "ice" || value === "confirm";
}

function byId<T extends MenuOption>(items: T[], id: string): T {
  return items.find((item) => item.id === id) ?? items[0];
}
