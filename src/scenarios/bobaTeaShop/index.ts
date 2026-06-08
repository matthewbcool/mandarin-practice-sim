import { buildKioskReceipt, makeKioskOrder } from "../../game/kiosk";
import { compactTicketLines, describeOrder, drinks, emptyOrder, iceLevels, missingRequiredFields, orderTotal, ordersMatch, politePhrases, sizes, sweetnessLevels, toppings } from "../../game/menu";
import { mergeOrder, parseUtterance, resetOrder } from "../../game/parser";
import { getObjective, objectives } from "../../game/rounds";
import { buildReceipt } from "../../game/scoring";
import type { MenuOption, Order, Receipt } from "../../game/types";
import type { ScenarioDefinition } from "../types";
import { bobaKiosk } from "./kiosk";
import {
  applyBobaPromptContext,
  bobaFreeFlowPromptKey,
  buildBobaCashierAdvice,
  buildBobaFreeFlowIdleHelp,
  buildBobaFreeFlowMissingQuestion,
  buildBobaFreeFlowRepairQuestion,
  isBobaOrderComplete,
  isBobaOrderRevision,
  isLikelyBobaConfirmationResponse,
  normalizeBobaTranscriptKey,
  promptForBobaMissingFields,
  shouldAskBobaGeminiIntent,
} from "./prompts";
import { bobaScene } from "./scene";

export const bobaTeaShopScenario: ScenarioDefinition = {
  id: "boba-tea-shop",
  locale: "zh-TW",
  card: {
    id: "boba-tea-shop",
    title: "Boba Tea Shop",
    kicker: "Boba Tea Shop",
    description: "Practice ordering bubble tea at the self-ordering kiosk.",
    image: "/assets/scenarios/boba-tea-shop.jpg",
    imageWidth: 960,
    imageHeight: 540,
    loadingStatus: "Loading Boba Tea Shop...",
  },
  menu: {
    drinks,
    sizes,
    sweetnessLevels,
    iceLevels,
    toppings,
    politePhrases,
  },
  kiosk: bobaKiosk,
  scene: bobaScene,
  task: {
    makeEmptyOrder: emptyOrder,
    makeKioskOrder,
    cloneOrder,
    orderTotal,
    describeOrder,
    compactTicketLines,
    ordersMatch,
    missingRequiredFields,
    promptForMissingFields: promptForBobaMissingFields,
    hasOrderContent,
  },
  parser: {
    parseUtterance,
    mergeOrder,
    resetOrder,
  },
  prompts: {
    applyPromptContext: applyBobaPromptContext,
    isOrderRevision: isBobaOrderRevision,
    isComplete: isBobaOrderComplete,
    isLikelyConfirmationResponse: isLikelyBobaConfirmationResponse,
    normalizeTranscriptKey: normalizeBobaTranscriptKey,
    shouldAskGeminiIntent: shouldAskBobaGeminiIntent,
    freeFlowPromptKey: bobaFreeFlowPromptKey,
    buildFreeFlowMissingQuestion: buildBobaFreeFlowMissingQuestion,
    buildFreeFlowIdleHelp: buildBobaFreeFlowIdleHelp,
    buildFreeFlowRepairQuestion: buildBobaFreeFlowRepairQuestion,
    buildAdvice: buildBobaCashierAdvice,
  },
  rounds: {
    objectives,
    getObjective,
  },
  scoring: {
    storageKey: "boba-receipts",
    buildReceipt,
    buildShareText,
    buildKioskReceipt,
  },
  copy: {
    brand: {
      title: "珍奶快打",
      kioskSubtitle: "自助點餐",
      arcadeRoundLabel: (roundIndex) => `第 ${roundIndex + 1} 關`,
      openSubtitle: "自由模式",
      startKicker: "Taiwan drink shop practice",
      startTitle: "珍奶快打",
      startBody: "Listen to the target order, step up to the counter, and order the drink in Mandarin. The smoother you are, the higher your score.",
      challengeButton: "Start Challenge",
      freePracticeButton: "Free Practice",
      shareTitle: "珍奶快打收據",
    },
    intro: (controlInstructions) => [
      {
        kicker: "Welcome",
        title: "Welcome to the boba tea ordering simulator",
        body: "Use the kiosk to practice a complete drink order. When Cashier Voice is enabled, the barista will ask questions and you answer out loud.",
      },
      {
        kicker: "Controls",
        title: "How to move around",
        body: controlInstructions,
      },
      {
        kicker: "Cashier",
        title: "Public Mode means kiosk-only",
        body: "If the badge says Public Mode, the barista is on break and will not start a voice conversation. Tap the kiosk screen, choose English or Chinese, and place the order there.",
      },
    ],
    lines: {
      opening: "歡迎光臨，想喝什麼？",
      technical: "不好意思，我的耳朵好像突然當機了。請再試一次。",
      radioChanged: "好，我幫你換一首。",
      listeningFeedback: "請說話，我正在聽。",
      freeFlowGazeMissFeedback: "慢慢來，想好了再說，我會等你。",
      cashierBreak: "Cashier voice is off in Public Mode. Please use the self-ordering kiosk.",
      kioskSpeechFeedback: "Cashier voice is off. Tap the kiosk screen to place an order.",
      arcadeMissingDrink: "不好意思，你想喝哪一杯？",
      arcadeMissingSize: "要中杯還是大杯？",
      arcadeMissingSweetnessIce: "甜度冰塊呢？",
      arcadeMissingSweetness: "甜度要怎麼做？",
      arcadeMissingIce: "冰塊要怎麼做？",
      arcadeConfirm: "好，這樣對嗎？",
      revisionPrompt: "沒問題，你要改哪裡？",
      unclear: "不好意思，我沒有聽清楚。可以再說一次嗎？",
      louder: "不好意思，可以講大聲一點嗎？",
      failure: "點單失敗。後面的人已經等到靈魂出竅了。",
      success: (total) => `好，收您 ${total} 元。你的飲料好了！`,
      briefingHint: "聽完就點，別讓後面等太久。",
      failTitle: "點單失敗",
      receiptActionsLabel: "回合完成操作",
      shareOpened: "已開啟分享。",
      shareCopied: "分享文字已複製。",
      shareUnavailable: "分享暫時無法使用。",
      technicalTitle: "收音異常",
      technicalBody: "系統連續兩次沒有聽清楚。請檢查麥克風，或改用按一下說話。",
      textInputPlaceholder: "我要一杯珍珠奶茶半糖少冰",
    },
  },
};

function cloneOrder(order: Order): Order {
  return {
    ...order,
    toppings: [...order.toppings],
  };
}

function hasOrderContent(order: Order): boolean {
  return Boolean(order.drink || order.size || order.sweetness || order.ice || order.toppings.length || order.quantity > 1);
}

function buildShareText(receipt: Receipt) {
  const modeText = receipt.mode === "arcade" ? "挑戰模式" : "自由練習";
  return `我在珍奶快打${modeText}拿到 ${receipt.score} 分，成功點了 ${describeOrder(receipt.recognized)}。`;
}

export function bobaOptionById<T extends MenuOption>(items: T[], id: string): T {
  return items.find((item) => item.id === id) ?? items[0];
}
