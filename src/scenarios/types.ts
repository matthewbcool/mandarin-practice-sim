import type { ParsedUtterance, SideIntent } from "../game/parser";
import type { KioskCartItem, KioskLanguage, KioskReceipt } from "../game/kiosk";
import type { GameMode, GamePhase, MenuOption, Order, Receipt, RoundObjective, RoundStats } from "../game/types";

export type ScenarioId = string;

export interface ScenarioCard {
  id: ScenarioId;
  title: string;
  kicker: string;
  description: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  loadingStatus: string;
}

export interface ScenarioIntroPanel {
  kicker: string;
  title: string;
  body: string;
}

export interface ScenarioMenuBoardRow {
  label: string;
  price?: string;
  detail?: string;
}

export interface ScenarioMenuBoardPalette {
  faceTop: string;
  face: string;
  faceBottom: string;
  frame: string;
  frameDark: string;
  trim: string;
  ink: string;
  muted: string;
  row: string;
  rowAlt: string;
}

export interface ScenarioMenuBoard {
  x: number;
  title: string;
  subtitle: string;
  footer: string;
  rotationY: number;
  palette: ScenarioMenuBoardPalette;
  rows: ScenarioMenuBoardRow[];
}

export interface ScenarioMenu {
  drinks: MenuOption[];
  sizes: MenuOption[];
  sweetnessLevels: MenuOption[];
  iceLevels: MenuOption[];
  toppings: MenuOption[];
  politePhrases: string[];
}

export interface ScenarioKioskCopy {
  add: { en: string; zh: string };
  addMore: { en: string; zh: string };
  back: { en: string; zh: string };
  cart: { en: string; zh: string };
  checkout: { en: string; zh: string };
  chooseDrink: { en: string; zh: string };
  clear: { en: string; zh: string };
  done: { en: string; zh: string };
  emptyCart: { en: string; zh: string };
  ice: { en: string; zh: string };
  lineTotal: { en: string; zh: string };
  newOrder: { en: string; zh: string };
  next: { en: string; zh: string };
  previous: { en: string; zh: string };
  publicMode: { en: string; zh: string };
  receipt: { en: string; zh: string };
  remove: { en: string; zh: string };
  size: { en: string; zh: string };
  start: { en: string; zh: string };
  sweetness: { en: string; zh: string };
  tapToOrder: { en: string; zh: string };
  title: { en: string; zh: string };
  toppings: { en: string; zh: string };
  total: { en: string; zh: string };
  viewCart: { en: string; zh: string };
}

export interface ScenarioKiosk {
  enabled: boolean;
  storage: {
    receipts: string;
    language: string;
  };
  defaultLanguage: KioskLanguage;
  defaultOptionIds: {
    drink: string;
    size: string;
    sweetness: string;
    ice: string;
  };
  currency: string;
  pageSize: number;
  speechPinyin: Record<string, string>;
  englishOptionLabels: Record<string, string>;
  copy: ScenarioKioskCopy;
  completeLine: string;
}

export interface ScenarioScene {
  assets: {
    worldUrl: string;
    colliderUrl: string;
    cashierUrl: string;
    customerUrl: string;
  };
  loading: {
    preparing: string;
    world: string;
    worldReady: string;
    initializingWorld: string;
    cashier: string;
    cashierReady: string;
    movement: string;
    movementReady: string;
    fallbackScene: string;
    ready: string;
  };
  receipt: {
    title: string;
    arcadeSubtitle: string;
    openSubtitle: string;
    scoreUnit: string;
    scoreParts: Array<{ key: keyof Receipt["scoreParts"]; label: string; max: number }>;
  };
  menuBoards: ScenarioMenuBoard[];
}

export interface ScenarioTask {
  makeEmptyOrder: () => Order;
  makeKioskOrder: (drink?: MenuOption) => Order;
  cloneOrder: (order: Order) => Order;
  orderTotal: (order: Order) => number;
  describeOrder: (order: Order) => string;
  compactTicketLines: (order: Order) => string[];
  ordersMatch: (actual: Order, target: Order) => boolean;
  missingRequiredFields: (actual: Order, target?: Order) => string[];
  promptForMissingFields: (missing: string[]) => "none" | "drink" | "size" | "sweetness" | "ice" | "confirm";
  hasOrderContent: (order: Order) => boolean;
}

export interface ScenarioParser {
  parseUtterance: (text: string) => ParsedUtterance;
  mergeOrder: (current: Order, patch: Partial<Order>) => Order;
  resetOrder: () => Order;
}

export interface ScenarioPrompts {
  applyPromptContext: (text: string, patch: Partial<Order>, current: Order, pendingPrompt: string) => Partial<Order>;
  isOrderRevision: (current: Order, patch: Partial<Order>) => boolean;
  isComplete: (order: Order) => boolean;
  isLikelyConfirmationResponse: (text: string, parsed: ParsedUtterance) => boolean;
  normalizeTranscriptKey: (text: string) => string;
  shouldAskGeminiIntent: (mode: GameMode, parsed: ParsedUtterance) => boolean;
  freeFlowPromptKey: (order: Order, missing: string[], source: "ask" | "repair" | "idle" | "deny") => string;
  buildFreeFlowMissingQuestion: (order: Order, missing: string[], attempt: number) => { text: string; suggestion?: Partial<Order> };
  buildFreeFlowIdleHelp: (order: Order, phase: GamePhase, attempt: number) => { text: string; suggestion?: Partial<Order> };
  buildFreeFlowRepairQuestion: (order: Order, phase: GamePhase, attempt: number) => { text: string; suggestion?: Partial<Order> };
  buildAdvice: (topic: Extract<SideIntent, { type: "cashier.advice" }>["topic"], order: Order, target?: Order) => string;
}

export interface ScenarioRounds {
  objectives: RoundObjective[];
  getObjective: (index: number) => RoundObjective;
}

export interface ScenarioScoring {
  storageKey: string;
  buildReceipt: (params: {
    mode: GameMode;
    objective?: RoundObjective;
    recognized: Order;
    stats: RoundStats;
    success: boolean;
  }) => Receipt;
  buildShareText: (receipt: Receipt) => string;
  buildKioskReceipt: (cart: KioskCartItem[]) => KioskReceipt;
}

export interface ScenarioCopy {
  brand: {
    title: string;
    kioskSubtitle: string;
    arcadeRoundLabel: (roundIndex: number) => string;
    openSubtitle: string;
    startKicker: string;
    startTitle: string;
    startBody: string;
    challengeButton: string;
    freePracticeButton: string;
    shareTitle: string;
  };
  intro: (controlInstructions: string) => ScenarioIntroPanel[];
  lines: {
    opening: string;
    technical: string;
    radioChanged: string;
    listeningFeedback: string;
    freeFlowGazeMissFeedback: string;
    cashierBreak: string;
    kioskSpeechFeedback: string;
    arcadeMissingDrink: string;
    arcadeMissingSize: string;
    arcadeMissingSweetnessIce: string;
    arcadeMissingSweetness: string;
    arcadeMissingIce: string;
    arcadeConfirm: string;
    revisionPrompt: string;
    unclear: string;
    louder: string;
    failure: string;
    success: (total: number) => string;
    briefingHint: string;
    failTitle: string;
    receiptActionsLabel: string;
    shareOpened: string;
    shareCopied: string;
    shareUnavailable: string;
    technicalTitle: string;
    technicalBody: string;
    textInputPlaceholder: string;
  };
}

export interface ScenarioDefinition {
  id: ScenarioId;
  locale: string;
  card: ScenarioCard;
  menu: ScenarioMenu;
  kiosk: ScenarioKiosk;
  scene: ScenarioScene;
  task: ScenarioTask;
  parser: ScenarioParser;
  prompts: ScenarioPrompts;
  rounds: ScenarioRounds;
  scoring: ScenarioScoring;
  copy: ScenarioCopy;
}
