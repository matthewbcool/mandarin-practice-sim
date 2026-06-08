import { describeOrder, drinks, iceLevels, orderTotal, sizes, sweetnessLevels } from "./menu";
import type { MenuOption, Order } from "./types";

export type KioskLanguage = "en" | "zh";
export type KioskScreen = "drinks" | "customize" | "cart" | "receipt";

export interface KioskCartItem {
  id: string;
  order: Order;
}

export interface KioskReceipt {
  id: string;
  items: KioskCartItem[];
  total: number;
  lines: string[];
  createdAt: string;
}

export interface KioskViewModel {
  screen: KioskScreen;
  language: KioskLanguage;
  drinkPage: number;
  selected: Order;
  cart: KioskCartItem[];
  receipt?: KioskReceipt;
}

export type KioskAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "back" }
  | { type: "nextDrinkPage" }
  | { type: "previousDrinkPage" }
  | { type: "selectDrink"; id: string }
  | { type: "setSize"; id: string }
  | { type: "setSweetness"; id: string }
  | { type: "setIce"; id: string }
  | { type: "toggleTopping"; id: string }
  | { type: "setQuantity"; quantity: number }
  | { type: "addToCart" }
  | { type: "showCart" }
  | { type: "removeItem"; id: string }
  | { type: "clearCart" }
  | { type: "checkout" }
  | { type: "newOrder" }
  | { type: "setLanguage"; language: KioskLanguage };

export const kioskReceiptStorageKey = "boba-kiosk-receipts";
export const kioskLanguageStorageKey = "boba-kiosk-language";

export function makeKioskOrder(drink: MenuOption = drinks[0]): Order {
  return {
    quantity: 1,
    drink,
    size: byId(sizes, "medium"),
    sweetness: byId(sweetnessLevels, "half-sugar"),
    ice: byId(iceLevels, "less-ice"),
    toppings: [],
  };
}

export function cartTotal(cart: KioskCartItem[]): number {
  return cart.reduce((total, item) => total + orderTotal(item.order), 0);
}

export function buildKioskReceipt(cart: KioskCartItem[]): KioskReceipt {
  const total = cartTotal(cart);
  return {
    id: `kiosk-${Date.now().toString(36)}`,
    items: cart,
    total,
    lines: cart.map((item) => `${describeOrder(item.order)} - ${orderTotal(item.order)} 元`),
    createdAt: new Date().toISOString(),
  };
}

export function loadKioskReceipts(storageKey = kioskReceiptStorageKey): KioskReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveKioskReceipt(receipt: KioskReceipt, storageKey = kioskReceiptStorageKey): KioskReceipt[] {
  const next = [receipt, ...loadKioskReceipts(storageKey)].slice(0, 12);
  window.localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  return items.find((item) => item.id === id) ?? items[0];
}
