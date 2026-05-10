import { drinks, iceLevels, sizes, sweetnessLevels, toppings } from "./menu";
import type { Order, RoundObjective } from "./types";

const byId = <T extends { id: string }>(items: T[], id: string) => items.find((item) => item.id === id)!;

export const objectives: RoundObjective[] = [
  makeObjective("r1", 1, {
    drink: byId(drinks, "milk-tea"),
  }),
  makeObjective("r2", 1, {
    drink: byId(drinks, "pearl-milk-tea"),
  }),
  makeObjective("r3", 2, {
    drink: byId(drinks, "pearl-milk-tea"),
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
  }),
  makeObjective("r4", 2, {
    drink: byId(drinks, "oolong-milk-tea"),
    sweetness: byId(sweetnessLevels, "light-sugar"),
    ice: byId(iceLevels, "no-ice"),
  }),
  makeObjective("r5", 3, {
    drink: byId(drinks, "black-tea-latte"),
    size: byId(sizes, "large"),
    sweetness: byId(sweetnessLevels, "less-sugar"),
    ice: byId(iceLevels, "light-ice"),
  }),
  makeObjective("r6", 3, {
    drink: byId(drinks, "wintermelon-lemon"),
    size: byId(sizes, "medium"),
    sweetness: byId(sweetnessLevels, "regular-sugar"),
    ice: byId(iceLevels, "regular-ice"),
    toppings: [byId(toppings, "aiyu")],
  }),
  makeObjective("r7", 4, {
    drink: byId(drinks, "brown-sugar-boba-milk"),
    size: byId(sizes, "large"),
    ice: byId(iceLevels, "less-ice"),
  }),
  makeObjective("r8", 4, {
    drink: byId(drinks, "tieguanyin-milk-tea"),
    size: byId(sizes, "large"),
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
    toppings: [byId(toppings, "pudding")],
  }),
  makeObjective("r9", 5, {
    drink: byId(drinks, "passion-green-tea"),
    size: byId(sizes, "large"),
    sweetness: byId(sweetnessLevels, "light-sugar"),
    ice: byId(iceLevels, "regular-ice"),
    toppings: [byId(toppings, "coconut-jelly")],
  }),
  makeObjective("r10", 5, {
    quantity: 2,
    drink: byId(drinks, "pearl-milk-tea"),
    size: byId(sizes, "medium"),
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
  }),
  makeObjective("r11", 6, {
    drink: byId(drinks, "taro-milk"),
    size: byId(sizes, "large"),
    sweetness: byId(sweetnessLevels, "no-sugar"),
    ice: byId(iceLevels, "light-ice"),
    toppings: [byId(toppings, "taro-ball")],
  }),
  makeObjective("r12", 6, {
    quantity: 2,
    drink: byId(drinks, "sijichun"),
    size: byId(sizes, "large"),
    sweetness: byId(sweetnessLevels, "less-sugar"),
    ice: byId(iceLevels, "no-ice"),
    toppings: [byId(toppings, "agar")],
  }),
];

export function getObjective(index: number): RoundObjective {
  return objectives[index % objectives.length];
}

function makeObjective(id: string, level: number, partial: Partial<Order>): RoundObjective {
  const target: Order = {
    quantity: partial.quantity ?? 1,
    drink: partial.drink,
    size: partial.size,
    sweetness: partial.sweetness,
    ice: partial.ice,
    toppings: partial.toppings ?? [],
  };

  const title = `第 ${Number(id.replace("r", ""))} 張點單`;
  return {
    id,
    level,
    ticketTitle: title,
    target,
    spokenPrompt: buildSpokenPrompt(target),
  };
}

function buildSpokenPrompt(order: Order): string {
  const quantity = order.quantity === 2 ? "兩杯" : order.quantity > 1 ? `${order.quantity}杯` : "一杯";
  const chunks = [quantity, order.size?.label, order.drink?.label, order.sweetness?.label, order.ice?.label];
  const toppingText = order.toppings.length ? `，加${order.toppings.map((topping) => topping.label).join("、")}` : "";
  return `這一回合，請點${chunks.filter(Boolean).join("")}${toppingText}。`;
}
