import type { MenuOption, Order } from "./types";

export const drinks: MenuOption[] = [
  option("milk-tea", "奶茶", ["奶茶", "一杯奶茶", "普通奶茶", "原味奶茶"], 45),
  option("pearl-milk-tea", "珍珠奶茶", ["珍珠奶茶", "珍奶", "珍珠鮮奶茶", "珍珠奶", "珍珠鮮奶"], 60),
  option("boba-milk-tea", "波霸奶茶", ["波霸奶茶", "波霸珍奶", "波霸珍珠奶茶", "大珍珠奶茶"], 65),
  option("oolong-milk-tea", "烏龍奶茶", ["烏龍奶茶", "烏龍鮮奶茶", "烏龍拿鐵", "烏龍鮮奶"], 55),
  option("black-tea-latte", "紅茶拿鐵", ["紅茶拿鐵", "紅茶鮮奶", "鮮奶紅茶", "紅茶牛奶"], 65),
  option("tieguanyin-milk-tea", "鐵觀音奶茶", ["鐵觀音奶茶", "鐵觀音鮮奶茶", "鐵觀音拿鐵", "鐵觀音鮮奶"], 60),
  option("brown-sugar-boba-milk", "黑糖珍珠鮮奶", ["黑糖珍珠鮮奶", "黑糖珍珠牛奶", "黑糖波霸鮮奶", "黑糖波霸牛奶"], 75),
  option("taro-milk", "芋頭鮮奶", ["芋頭鮮奶", "芋頭牛奶", "芋頭奶"], 70),
  option("matcha-latte", "抹茶拿鐵", ["抹茶拿鐵", "抹茶鮮奶", "抹茶牛奶"], 75),
  option("pudding-milk-tea", "布丁奶茶", ["布丁奶茶", "布丁鮮奶茶"], 65),
  option("grass-jelly-milk-tea", "仙草奶凍", ["仙草奶凍", "仙草奶茶", "仙草凍奶茶"], 65),
  option("black-tea", "紅茶", ["紅茶", "冰紅茶", "台灣紅茶"], 35),
  option("green-tea", "綠茶", ["綠茶", "茉莉綠茶", "茉莉茶"], 35),
  option("oolong-tea", "烏龍茶", ["烏龍茶", "高山烏龍", "烏龍"], 40),
  option("sijichun", "四季春青茶", ["四季春青茶", "四季春", "青茶", "四季青"], 45),
  option("wintermelon-lemon", "冬瓜檸檬", ["冬瓜檸檬", "冬瓜檸檬茶", "冬檸"], 50),
  option("lemon-black-tea", "檸檬紅茶", ["檸檬紅茶", "檸紅", "檸檬紅"], 50),
  option("passion-green-tea", "百香綠茶", ["百香綠茶", "百香果綠茶", "百香果綠", "百香綠"], 55),
  option("yakult-green-tea", "多多綠茶", ["多多綠茶", "養樂多綠茶", "多多綠", "養樂多綠"], 55),
  option("orange-green-tea", "柳橙綠茶", ["柳橙綠茶", "柳橙青茶", "柳橙綠", "柳橙青"], 55),
];

export const sizes: MenuOption[] = [
  option("medium", "中杯", ["中杯", "中", "中的", "普通杯", "普通", "一般杯", "標準杯", "中杯的"], 0),
  option("large", "大杯", ["大杯", "大", "大的", "大杯的", "大杯子", "加大", "升級大杯"], 10),
];

export const sweetnessLevels: MenuOption[] = [
  option("regular-sugar", "正常糖", ["正常糖", "全糖", "正常甜", "全甜", "標準甜", "糖正常", "甜度正常"], 0),
  option("less-sugar", "少糖", ["少糖", "少甜", "七分糖", "七分", "八分糖", "八分", "六分糖", "六分", "不要太甜", "不用太甜", "糖少一點"], 0),
  option("half-sugar", "半糖", ["半糖", "半甜", "五分糖", "五分", "四分糖", "四分"], 0),
  option("light-sugar", "微糖", ["微糖", "微甜", "三分糖", "三分", "二分糖", "二分", "一分糖", "一分", "糖微微"], 0),
  option("no-sugar", "無糖", ["無糖", "無甜", "零糖", "不要糖", "不加糖", "不甜", "完全不甜", "wu tian", "wutian", "wu tien", "wutien"], 0),
];

export const iceLevels: MenuOption[] = [
  option("regular-ice", "正常冰", ["正常冰", "正常", "一般冰", "標準冰", "冰正常", "冰塊正常", "冰的", "冷的"], 0),
  option("less-ice", "少冰", ["少冰", "冰少一點", "少一點冰", "冰少", "不要太冰", "冰塊少一點"], 0),
  option("light-ice", "微冰", ["微冰", "一點冰", "一點點冰", "微微冰"], 0),
  option("no-ice", "去冰", ["去冰", "不要冰", "不加冰", "常溫", "完全去冰"], 0),
  option("hot", "熱", ["熱", "熱的", "溫", "溫的", "熱飲", "做熱", "做溫"], 0),
];

export const toppings: MenuOption[] = [
  option("pearl", "珍珠", ["珍珠", "粉圓"], 10),
  option("boba", "波霸", ["波霸", "大珍珠"], 10),
  option("mini-pearl", "小珍珠", ["小珍珠"], 10),
  option("coconut-jelly", "椰果", ["椰果"], 10),
  option("pudding", "布丁", ["布丁"], 15),
  option("grass-jelly", "仙草", ["仙草", "仙草凍"], 10),
  option("aiyu", "愛玉", ["愛玉"], 15),
  option("taro-ball", "芋圓", ["芋圓"], 15),
  option("agar", "寒天", ["寒天", "寒天晶球"], 10),
  option("milk-foam", "奶蓋", ["奶蓋"], 20),
];

export const politePhrases = ["請問", "我要", "麻煩", "麻煩你", "不好意思", "謝謝", "拜託", "可以幫我", "幫我"];

export const emptyOrder = (): Order => ({
  quantity: 1,
  toppings: [],
});

export function orderTotal(order: Order): number {
  const base = order.drink?.price ?? 0;
  const size = order.size?.price ?? 0;
  const extras = order.toppings.reduce((total, item) => total + (item.price ?? 0), 0);
  return Math.max(0, (base + size + extras) * (order.quantity || 1));
}

export function describeOrder(order: Order): string {
  const chunks = [
    quantityLabel(order.quantity),
    order.size?.label,
    order.drink?.label ?? "未選飲料",
    order.sweetness?.label,
    order.ice?.label,
  ];
  const toppingText = order.toppings.length ? `加${order.toppings.map((topping) => topping.label).join("、")}` : undefined;
  return [...chunks, toppingText].filter(Boolean).join("，");
}

export function compactTicketLines(order: Order): string[] {
  const lines = [
    `${quantityLabel(order.quantity)} ${order.drink?.label ?? ""}`.trim(),
    order.size?.label,
    order.sweetness?.label,
    order.ice?.label,
    order.toppings.length ? `加 ${order.toppings.map((topping) => topping.label).join("、")}` : undefined,
  ];
  return lines.filter(Boolean) as string[];
}

export function ordersMatch(actual: Order, target: Order): boolean {
  if ((actual.quantity || 1) !== (target.quantity || 1)) return false;
  if (actual.drink?.id !== target.drink?.id) return false;
  if (target.size && actual.size?.id !== target.size.id) return false;
  if (target.sweetness && actual.sweetness?.id !== target.sweetness.id) return false;
  if (target.ice && actual.ice?.id !== target.ice.id) return false;
  const actualToppings = new Set(actual.toppings.map((topping) => topping.id));
  return target.toppings.every((topping) => actualToppings.has(topping.id));
}

export function missingRequiredFields(actual: Order, target?: Order): string[] {
  const fields: string[] = [];
  if (!actual.drink) fields.push("飲料");
  if ((target?.size || actual.drink) && !actual.size) fields.push("杯型");
  if ((target?.sweetness || actual.drink) && !actual.sweetness) fields.push("甜度");
  if ((target?.ice || actual.drink) && !actual.ice) fields.push("冰塊");
  return fields;
}

function option(id: string, label: string, aliases: string[], price = 0): MenuOption {
  return { id, label, aliases: [label, ...aliases], price };
}

function quantityLabel(quantity: number): string {
  if (quantity <= 1) return "一杯";
  if (quantity === 2) return "兩杯";
  return `${quantity}杯`;
}
