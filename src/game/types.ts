export type GameMode = "arcade" | "open" | "kiosk";

export type GamePhase =
  | "menu"
  | "briefing"
  | "ordering"
  | "confirming"
  | "paying"
  | "serving"
  | "kiosk"
  | "receipt"
  | "failed";

export type Speaker = "系統" | "店員" | "玩家" | "後方客人";

export interface MenuOption {
  id: string;
  label: string;
  aliases: string[];
  price?: number;
}

export interface Order {
  quantity: number;
  drink?: MenuOption;
  size?: MenuOption;
  sweetness?: MenuOption;
  ice?: MenuOption;
  toppings: MenuOption[];
}

export interface RoundObjective {
  id: string;
  level: number;
  ticketTitle: string;
  target: Order;
  spokenPrompt: string;
}

export interface DialogueTurn {
  speaker: Speaker;
  text: string;
  at: number;
}

export interface RoundStats {
  startedAt: number;
  endedAt?: number;
  corrections: number;
  repeats: number;
  politeHits: string[];
  technicalMisses: number;
}

export interface Receipt {
  id: string;
  mode: GameMode;
  objective?: RoundObjective;
  recognized: Order;
  score: number;
  scoreParts: {
    correctness: number;
    politeness: number;
    smoothness: number;
    clarity: number;
  };
  success: boolean;
  lines: string[];
  createdAt: string;
}

export interface ConversationResult {
  order: Order;
  nextNpcLine: string;
  phase: GamePhase;
  receipt?: Receipt;
  failReason?: string;
}
