import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BobaScene, { COUNTER_CASHIER_POSE, type FocusTarget, type SceneLoadProgress } from "./three/BobaScene";
import { BrowserMandarinVoiceProvider } from "./voice/browserMandarinVoice";
import { GeminiLiveVoiceProvider } from "./voice/geminiLiveVoice";
import { geminiLivePlan } from "./voice/geminiLivePlan";
import { ShopRadio } from "./voice/shopRadio";
import { SuccessCue } from "./voice/successCue";
import type { DialogueTurn, GameMode, GamePhase, Order, Receipt, RoundObjective, RoundStats } from "./game/types";
import { interpretFreeFlowUtterance } from "./game/geminiIntent";
import {
  loadKioskReceipts,
  saveKioskReceipt,
  type KioskAction,
  type KioskLanguage,
  type KioskReceipt,
  type KioskScreen,
  type KioskViewModel,
} from "./game/kiosk";
import { saveReceipt } from "./game/scoring";
import { defaultScenario, getScenarioById, scenarios } from "./scenarios/registry";
import type { ScenarioDefinition, ScenarioId } from "./scenarios/types";

const listenCooldownMs = 180;
const gazeListenDelayMs = 25;
const orderingEntryDelayMs = 120;
const freeFlowIdleHelpMs = 10000;
const npcSpeechSafetyMs = 5200;
const postNpcAudioTailMs = 120;
const postNpcInterruptDelayMs = 80;
const drinkArrivalReceiptDelayMs = 4600;

type PendingOrderPrompt = "none" | "drink" | "size" | "sweetness" | "ice" | "confirm";
type CashierPrompt = {
  text: string;
  suggestion?: Partial<Order>;
};
type ExperienceMode = "cashier" | "kiosk";
type RuntimeStatus = {
  loaded: boolean;
  geminiEnabled: boolean;
  reason?: string;
};
type ScenarioLoadState = {
  scenarioId: ScenarioId;
  progress: number;
  status: string;
  ready: boolean;
};
type KioskSpeechCue = {
  title: string;
  text: string;
  speakText?: string;
};

const defaultScenarioId = defaultScenario.id;

function byId<T extends { id: string }>(items: T[], id: string): T {
  return items.find((item) => item.id === id) ?? items[0];
}

function readStoredKioskLanguage(scenario: ScenarioDefinition = defaultScenario): KioskLanguage {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(scenario.kiosk.storage.language);
  return stored === "zh" ? "zh" : "en";
}

function getPlatformControlInstructions() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return "Look around the shop, then select the kiosk or cashier when you are ready.";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const headset = /quest|oculus|vive|pico|xr|vr/.test(userAgent);
  if (headset) {
    return "In headset: use your controller ray or gaze to aim. Use kiosk buttons in Public Mode; speak only when Cashier Voice is enabled.";
  }

  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  if (touch) {
    return "On mobile or tablet: swipe to look around, then tap the kiosk. Use the talk button only when Cashier Voice is enabled.";
  }

  return "On desktop: drag to look around and click the kiosk. Use the talk button only when Cashier Voice is enabled.";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function kioskQuantityLabel(quantity: number) {
  if (quantity <= 1) return "一杯";
  if (quantity === 2) return "兩杯";
  return `${quantity}杯`;
}

function kioskQuantityPinyin(quantity: number) {
  if (quantity <= 1) return "yì bēi";
  if (quantity === 2) return "liǎng bēi";
  return `${quantity} bēi`;
}

function kioskSpeechCueForAction(action: KioskAction, currentOrder: Order, scenario: ScenarioDefinition): KioskSpeechCue | undefined {
  const { drinks, sizes, sweetnessLevels, iceLevels, toppings } = scenario.menu;
  switch (action.type) {
    case "selectDrink":
      return optionKioskCue("Drink", byId(drinks, action.id), scenario);
    case "setSize":
      return optionKioskCue("Size", byId(sizes, action.id), scenario);
    case "setSweetness":
      return optionKioskCue("Sweetness", byId(sweetnessLevels, action.id), scenario);
    case "setIce":
      return optionKioskCue("Ice", byId(iceLevels, action.id), scenario);
    case "toggleTopping": {
      const topping = byId(toppings, action.id);
      const removing = currentOrder.toppings.some((item) => item.id === topping.id);
      return removing
        ? { title: "Remove topping", text: `不要${topping.label}  bù yào ${pinyinForOption(topping, scenario)}`, speakText: `不要${topping.label}` }
        : optionKioskCue("Topping", topping, scenario);
    }
    case "setQuantity":
      return {
        title: "Quantity",
        text: `${kioskQuantityLabel(clamp(action.quantity, 1, 9))}  ${kioskQuantityPinyin(clamp(action.quantity, 1, 9))}`,
        speakText: kioskQuantityLabel(clamp(action.quantity, 1, 9)),
      };
    default:
      return undefined;
  }
}

function optionKioskCue(title: string, option: { id: string; label: string }, scenario: ScenarioDefinition): KioskSpeechCue {
  return {
    title,
    text: `${option.label}  ${pinyinForOption(option, scenario)}`,
    speakText: option.label,
  };
}

function pinyinForOption(option: { id: string; label: string }, scenario: ScenarioDefinition) {
  return scenario.kiosk.speechPinyin[option.id] ?? option.label;
}

function makeStats(): RoundStats {
  return {
    startedAt: Date.now(),
    corrections: 0,
    repeats: 0,
    politeHits: [],
    technicalMisses: 0,
  };
}

export default function App() {
  const browserVoice = useMemo(() => new BrowserMandarinVoiceProvider(), []);
  const geminiVoice = useMemo(() => new GeminiLiveVoiceProvider(browserVoice), [browserVoice]);
  const radioRef = useRef<ShopRadio | null>(null);
  const successCueRef = useRef<SuccessCue | null>(null);
  const successCuePlayedRef = useRef(false);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<RoundStats>(makeStats());
  const objectiveRef = useRef<RoundObjective | undefined>(undefined);
  const orderRef = useRef<Order>(defaultScenario.parser.resetOrder());
  const phaseRef = useRef<GamePhase>("menu");
  const listenCooldownRef = useRef(0);
  const speechTurnRef = useRef(0);
  const listenSourceRef = useRef<"manual" | "gaze">("manual");
  const pendingPromptRef = useRef<PendingOrderPrompt>("none");
  const npcAudioActiveRef = useRef(false);
  const npcAudioTokenRef = useRef(0);
  const npcSpeakingRef = useRef(false);
  const listeningRef = useRef(false);
  const listenBlockedUntilRef = useRef(0);
  const promptAttemptsRef = useRef<Record<string, number>>({});
  const pendingSuggestionRef = useRef<Partial<Order> | undefined>(undefined);
  const dialogueRef = useRef<DialogueTurn[]>([]);
  const completionTokenRef = useRef(0);
  const lastHandledTranscriptRef = useRef<{ text: string; at: number } | undefined>(undefined);

  const [mode, setMode] = useState<GameMode>("arcade");
  const [phase, setPhaseState] = useState<GamePhase>("menu");
  const [roundIndex, setRoundIndex] = useState(0);
  const [objective, setObjective] = useState<RoundObjective | undefined>();
  const [currentOrder, setCurrentOrderState] = useState<Order>(() => defaultScenario.parser.resetOrder());
  const [npcLine, setNpcLine] = useState("準備好就開始。");
  const [partial, setPartial] = useState("");
  const [speechFeedbackText, setSpeechFeedbackText] = useState("");
  const [speechFeedbackLabel, setSpeechFeedbackLabel] = useState("聽到");
  const [listening, setListening] = useState(false);
  const [npcSpeaking, setNpcSpeaking] = useState(false);
  const [npcAudioActive, setNpcAudioActiveState] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("none");
  const [dialogue, setDialogue] = useState<DialogueTurn[]>([]);
  const [receipt, setReceipt] = useState<Receipt | undefined>();
  const [autoListen, setAutoListen] = useState(true);
  const [technicalOverlay, setTechnicalOverlay] = useState(false);
  const [typedInput, setTypedInput] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [pressure, setPressure] = useState(0);
  const [interactionTick, setInteractionTick] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({ loaded: false, geminiEnabled: false });
  const [focusedScenarioId, setFocusedScenarioId] = useState<ScenarioId>(defaultScenarioId);
  const [sceneLoadState, setSceneLoadState] = useState<ScenarioLoadState>({
    scenarioId: defaultScenarioId,
    progress: 0,
    status: defaultScenario.card.loadingStatus,
    ready: false,
  });
  const [scenarioEntered, setScenarioEntered] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [introIndex, setIntroIndex] = useState(0);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [kioskScreen, setKioskScreen] = useState<KioskScreen>("drinks");
  const [kioskLanguage, setKioskLanguage] = useState<KioskLanguage>(readStoredKioskLanguage);
  const [kioskDrinkPage, setKioskDrinkPage] = useState(0);
  const [kioskSelected, setKioskSelected] = useState<Order>(() => defaultScenario.task.makeKioskOrder());
  const [kioskCart, setKioskCart] = useState<Array<{ id: string; order: Order }>>([]);
  const [kioskReceipt, setKioskReceipt] = useState<KioskReceipt | undefined>();
  const [, setKioskReceipts] = useState<KioskReceipt[]>(() => loadKioskReceipts(defaultScenario.kiosk.storage.receipts));

  const voice = runtimeStatus.geminiEnabled ? geminiVoice : browserVoice;
  const experience: ExperienceMode = runtimeStatus.loaded && runtimeStatus.geminiEnabled ? "cashier" : "kiosk";
  const focusedScenario = getScenarioById(focusedScenarioId);
  const introPanels = useMemo(() => focusedScenario.copy.intro(getPlatformControlInstructions()), [focusedScenario]);
  const loadingReady = runtimeStatus.loaded && sceneLoadState.ready && sceneLoadState.scenarioId === focusedScenarioId;
  const loadingProgress = Math.round(
    clamp((runtimeStatus.loaded ? 0.1 : 0) * 100 + sceneLoadState.progress * 90, 0, loadingReady ? 100 : 99),
  );
  const loadingStatus = runtimeStatus.loaded ? (loadingReady ? "" : sceneLoadState.status || focusedScenario.card.loadingStatus) : "Checking voice mode...";
  const showLoadingGate = !scenarioEntered;
  const introReady = loadingReady;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(geminiLivePlan.statusEndpoint);
        const payload = (await response.json().catch(() => ({}))) as { enabled?: boolean; reason?: string };
        if (cancelled) return;
        setRuntimeStatus({
          loaded: true,
          geminiEnabled: response.ok && Boolean(payload.enabled),
          reason: response.ok ? payload.reason : "Gemini status endpoint is unavailable.",
        });
      } catch {
        if (!cancelled) {
          setRuntimeStatus({
            loaded: true,
            geminiEnabled: false,
            reason: "Gemini status endpoint is unavailable.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const focusScenario = useCallback(
    (scenarioId: ScenarioId) => {
      if (scenarioId === focusedScenarioId) return;
      const scenario = getScenarioById(scenarioId);
      setFocusedScenarioId(scenario.id);
      setScenarioEntered(false);
      setIntroComplete(false);
      setIntroIndex(0);
      setKioskLanguage(readStoredKioskLanguage(scenario));
      setKioskDrinkPage(0);
      setKioskSelected(scenario.task.makeKioskOrder());
      setKioskCart([]);
      setKioskReceipt(undefined);
      setKioskOpen(false);
      setSceneLoadState({
        scenarioId: scenario.id,
        progress: 0,
        status: scenario.card.loadingStatus,
        ready: false,
      });
    },
    [focusedScenarioId],
  );

  const handleSceneLoadProgress = useCallback((progress: SceneLoadProgress) => {
    const scenario = getScenarioById(progress.scenarioId);
    setSceneLoadState({
      scenarioId: scenario.id,
      progress: clamp(progress.progress, 0, 1),
      status: progress.status,
      ready: progress.ready,
    });
  }, []);

  const enterScenario = useCallback(() => {
    if (!loadingReady) return;
    setScenarioEntered(true);
  }, [loadingReady]);

  useEffect(() => {
    window.localStorage.setItem(focusedScenario.kiosk.storage.language, kioskLanguage);
  }, [focusedScenario, kioskLanguage]);

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setCurrentOrder = useCallback((next: Order) => {
    orderRef.current = next;
    setCurrentOrderState(next);
  }, []);

  const setListeningState = useCallback((next: boolean) => {
    listeningRef.current = next;
    setListening(next);
  }, []);

  const setNpcSpeakingState = useCallback((next: boolean) => {
    npcSpeakingRef.current = next;
    setNpcSpeaking(next);
  }, []);

  const setNpcAudioActive = useCallback((next: boolean) => {
    npcAudioActiveRef.current = next;
    setNpcAudioActiveState(next);
  }, []);

  const addTurn = useCallback((speaker: DialogueTurn["speaker"], text: string) => {
    const turn = { speaker, text, at: Date.now() };
    const next = [turn, ...dialogueRef.current].slice(0, 8);
    dialogueRef.current = next;
    setDialogue(next);
  }, []);

  const markInteraction = useCallback(() => {
    setInteractionTick((tick) => tick + 1);
  }, []);

  const preloadSuccessCue = useCallback(() => {
    successCueRef.current ??= new SuccessCue();
    successCueRef.current.preload();
  }, []);

  const playSuccessCue = useCallback(() => {
    if (successCuePlayedRef.current) return;
    successCuePlayedRef.current = true;
    successCueRef.current ??= new SuccessCue();
    successCueRef.current.play();
  }, []);

  const nextPromptAttempt = useCallback((key: string) => {
    const attempt = promptAttemptsRef.current[key] ?? 0;
    promptAttemptsRef.current[key] = attempt + 1;
    return attempt;
  }, []);

  const speakNpc = useCallback(
    async (text: string, role: "cashier" | "announcer" | "system" = "cashier") => {
      const speechTurn = speechTurnRef.current + 1;
      speechTurnRef.current = speechTurn;
      markInteraction();
      setNpcLine(text);
      addTurn(role === "announcer" ? "系統" : "店員", text);
      const audioToken = npcAudioTokenRef.current + 1;
      npcAudioTokenRef.current = audioToken;
      voice.cancelSpeech();
      setNpcAudioActive(true);
      setNpcSpeakingState(true);
      radioRef.current?.duck(true);

      const releaseTurn = () => {
        if (speechTurnRef.current !== speechTurn) return;
        setNpcSpeakingState(false);
      };

      let safetyTimer: number | undefined;
      let audioStopTimer: number | undefined;
      const finishAudioGuard = () => {
        if (npcAudioTokenRef.current !== audioToken) return;
        listenBlockedUntilRef.current = Date.now() + postNpcAudioTailMs;
        setNpcAudioActive(false);
      };
      const speechPromise = voice
        .speak(text, { voiceRole: role })
        .catch((error) => {
          console.warn("NPC speech failed", error);
        })
        .finally(finishAudioGuard);
      const safetyPromise = new Promise<void>((resolve) => {
        safetyTimer = window.setTimeout(() => {
          releaseTurn();
          resolve();
        }, speechSafetyMs(text, role));
      });
      audioStopTimer = window.setTimeout(() => {
        if (npcAudioTokenRef.current !== audioToken) return;
        voice.cancelSpeech();
        finishAudioGuard();
      }, speechAudioMaxMs(text, role));

      await Promise.race([speechPromise, safetyPromise]);
      if (safetyTimer) window.clearTimeout(safetyTimer);
      if (audioStopTimer && !npcAudioActiveRef.current) window.clearTimeout(audioStopTimer);
      releaseTurn();
    },
    [addTurn, markInteraction, setNpcAudioActive, setNpcSpeakingState, voice],
  );

  const speakCashierPrompt = useCallback(
    async (prompt: CashierPrompt) => {
      pendingSuggestionRef.current = prompt.suggestion;
      await speakNpc(prompt.text);
    },
    [speakNpc],
  );

  const resetRoundState = useCallback(
    (nextMode: GameMode, nextObjective?: RoundObjective) => {
      statsRef.current = makeStats();
      objectiveRef.current = nextObjective;
      setObjective(nextObjective);
      setMode(nextMode);
      setCurrentOrder(focusedScenario.parser.resetOrder());
      setReceipt(undefined);
      setPartial("");
      setSpeechFeedbackText("");
      setSpeechFeedbackLabel("聽到");
      setShareStatus("");
      setTechnicalOverlay(false);
      setPressure(0);
      successCuePlayedRef.current = false;
      successCueRef.current?.stop();
      pendingPromptRef.current = "none";
      promptAttemptsRef.current = {};
      pendingSuggestionRef.current = undefined;
      completionTokenRef.current += 1;
      lastHandledTranscriptRef.current = undefined;
      npcAudioTokenRef.current += 1;
      setNpcAudioActive(false);
      setNpcSpeakingState(false);
      if (nextMode !== "kiosk") setKioskOpen(false);
      listenBlockedUntilRef.current = 0;
      setInteractionTick((tick) => tick + 1);
      dialogueRef.current = [];
      setDialogue([]);
    },
    [focusedScenario, setCurrentOrder, setNpcAudioActive, setNpcSpeakingState],
  );

  const armMic = useCallback(async () => {
    if (experience !== "cashier") {
      setMicReady(false);
      setAutoListen(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicReady(voice.isListeningSupported());
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicReady(true);
    } catch {
      setMicReady(false);
      setAutoListen(false);
    }
  }, [experience, voice]);

  useEffect(() => {
    if (!introComplete || experience !== "kiosk" || phaseRef.current !== "menu") return;
    resetRoundState("kiosk");
    setPhase("kiosk");
    setAutoListen(false);
    setMicReady(false);
    setNpcLine(focusedScenario.copy.lines.cashierBreak);
    setSpeechFeedbackLabel("Public Mode");
    setSpeechFeedbackText(focusedScenario.copy.lines.kioskSpeechFeedback);
  }, [experience, focusedScenario, introComplete, resetRoundState, setPhase]);

  const enterOrdering = useCallback(async () => {
    setPhase("ordering");
    await speakNpc(focusedScenario.copy.lines.opening);
  }, [focusedScenario, setPhase, speakNpc]);

  const startArcade = useCallback(async (objectiveIndex = roundIndex) => {
    if (experience !== "cashier") return;
    radioRef.current ??= new ShopRadio();
    radioRef.current.start();
    void armMic();
    const nextObjective = focusedScenario.rounds.getObjective(objectiveIndex);
    resetRoundState("arcade", nextObjective);
    preloadSuccessCue();
    setPhase("briefing");
    setNpcLine(nextObjective.spokenPrompt);
    await voice.speak(nextObjective.spokenPrompt, { voiceRole: "announcer", rate: 0.82 });
    window.setTimeout(() => {
      if (phaseRef.current === "briefing") void enterOrdering();
    }, orderingEntryDelayMs);
  }, [armMic, enterOrdering, experience, focusedScenario, preloadSuccessCue, resetRoundState, roundIndex, setPhase, voice]);

  const startOpen = useCallback(async () => {
    if (experience !== "cashier") return;
    radioRef.current ??= new ShopRadio();
    radioRef.current.start();
    void armMic();
    resetRoundState("open", undefined);
    preloadSuccessCue();
    setPhase("ordering");
    await speakNpc(focusedScenario.copy.lines.opening);
  }, [armMic, experience, focusedScenario, preloadSuccessCue, resetRoundState, setPhase, speakNpc]);

  const finishSuccess = useCallback(async () => {
    const recognized = orderRef.current;
    const total = focusedScenario.task.orderTotal(recognized);
    statsRef.current.endedAt = Date.now();
    const completionToken = completionTokenRef.current + 1;
    completionTokenRef.current = completionToken;
    const nextReceipt = focusedScenario.scoring.buildReceipt({
      mode,
      objective: objectiveRef.current,
      recognized,
      stats: statsRef.current,
      success: true,
    });
    saveReceipt(nextReceipt, focusedScenario.scoring.storageKey);

    pendingPromptRef.current = "none";
    setPhase("serving");
    playSuccessCue();
    void speakNpc(focusedScenario.copy.lines.success(total));
    window.setTimeout(() => {
      if (completionTokenRef.current !== completionToken || phaseRef.current !== "serving") return;
      setReceipt(nextReceipt);
      setPhase("receipt");
    }, drinkArrivalReceiptDelayMs);
  }, [focusedScenario, mode, playSuccessCue, setPhase, speakNpc]);

  const failRound = useCallback(
    async (reason: string) => {
      statsRef.current.endedAt = Date.now();
      setPhase("failed");
      setNpcLine(reason);
      await voice.speak(reason, { voiceRole: "system", rate: 0.86 });
    },
    [setPhase, voice],
  );

  const askNextQuestion = useCallback(
    async (order: Order) => {
      const objectiveOrder = mode === "arcade" ? objectiveRef.current?.target : undefined;
      const missing = focusedScenario.task.missingRequiredFields(order, objectiveOrder);
      if (mode === "open") {
        pendingPromptRef.current = focusedScenario.task.promptForMissingFields(missing);
        const attempt = nextPromptAttempt(focusedScenario.prompts.freeFlowPromptKey(order, missing, "ask"));
        await speakCashierPrompt(focusedScenario.prompts.buildFreeFlowMissingQuestion(order, missing, attempt));
        return;
      }
      if (!order.drink) {
        pendingPromptRef.current = "drink";
        await speakNpc(focusedScenario.copy.lines.arcadeMissingDrink);
        return;
      }
      if (missing.includes("杯型")) {
        pendingPromptRef.current = "size";
        await speakNpc(focusedScenario.copy.lines.arcadeMissingSize);
        return;
      }
      if (missing.includes("甜度") && missing.includes("冰塊")) {
        pendingPromptRef.current = "none";
        await speakNpc(focusedScenario.copy.lines.arcadeMissingSweetnessIce);
        return;
      }
      if (missing.includes("甜度")) {
        pendingPromptRef.current = "sweetness";
        await speakNpc(focusedScenario.copy.lines.arcadeMissingSweetness);
        return;
      }
      if (missing.includes("冰塊")) {
        pendingPromptRef.current = "ice";
        await speakNpc(focusedScenario.copy.lines.arcadeMissingIce);
        return;
      }
      pendingPromptRef.current = "confirm";
      setPhase("confirming");
      await speakNpc(focusedScenario.copy.lines.arcadeConfirm);
    },
    [focusedScenario, mode, nextPromptAttempt, setPhase, speakCashierPrompt, speakNpc],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      const transcriptKey = focusedScenario.prompts.normalizeTranscriptKey(text);
      const now = Date.now();
      const recent = lastHandledTranscriptRef.current;
      if (recent && recent.text === transcriptKey && now - recent.at < 1800) {
        return;
      }
      lastHandledTranscriptRef.current = { text: transcriptKey, at: now };
      markInteraction();
      setPartial("");
      addTurn("玩家", text);
      let parsed = focusedScenario.parser.parseUtterance(text);
      let modelCashierLine: string | undefined;
      if (focusedScenario.prompts.shouldAskGeminiIntent(mode, parsed)) {
        const interpreted = await interpretFreeFlowUtterance({
          scenario: focusedScenario,
          text,
          mode,
          phase: phaseRef.current,
          currentOrder: orderRef.current,
          targetOrder: mode === "arcade" ? objectiveRef.current?.target : undefined,
          pendingPrompt: pendingPromptRef.current,
          pendingSuggestion: pendingSuggestionRef.current,
          localParsed: parsed,
          recentTurns: dialogueRef.current,
        });
        parsed = interpreted.parsed;
        modelCashierLine = interpreted.cashierLine;
      }
      if (parsed.sideIntent?.type === "radio.nextTrack") {
        radioRef.current?.nextTrack();
        await speakNpc(focusedScenario.copy.lines.radioChanged);
        return;
      }
      if (parsed.sideIntent?.type === "cashier.advice" && Object.keys(parsed.orderPatch).length === 0) {
        await speakNpc(modelCashierLine ?? focusedScenario.prompts.buildAdvice(parsed.sideIntent.topic, orderRef.current, objectiveRef.current?.target));
        return;
      }

      statsRef.current.politeHits.push(...parsed.politeHits);
      let orderPatch =
        mode === "open" ? focusedScenario.prompts.applyPromptContext(text, parsed.orderPatch, orderRef.current, pendingPromptRef.current) : parsed.orderPatch;
      const confirmsCurrentAnswer = focusedScenario.prompts.isLikelyConfirmationResponse(text, parsed);
      if (mode === "open" && confirmsCurrentAnswer && pendingSuggestionRef.current) {
        orderPatch = { ...orderPatch, ...pendingSuggestionRef.current };
        pendingSuggestionRef.current = undefined;
      } else if (mode === "open" && parsed.denies && pendingSuggestionRef.current && !Object.keys(orderPatch).length) {
        pendingSuggestionRef.current = undefined;
        const missing = focusedScenario.task.missingRequiredFields(orderRef.current);
        const attempt = nextPromptAttempt(focusedScenario.prompts.freeFlowPromptKey(orderRef.current, missing, "deny"));
        await speakCashierPrompt(focusedScenario.prompts.buildFreeFlowRepairQuestion(orderRef.current, phaseRef.current, attempt));
        return;
      }
      const hasOrderPatch = Object.keys(orderPatch).length > 0;

      if (phaseRef.current === "confirming") {
        if (parsed.denies && !hasOrderPatch) {
          statsRef.current.corrections += 1;
          setPhase("ordering");
          await speakNpc(focusedScenario.copy.lines.revisionPrompt);
          return;
        }
        if (confirmsCurrentAnswer && !hasOrderPatch && focusedScenario.prompts.isComplete(orderRef.current)) {
          const target = objectiveRef.current?.target;
          if (mode === "arcade" && target && !focusedScenario.task.ordersMatch(orderRef.current, target)) {
            await failRound(focusedScenario.copy.lines.failure);
            return;
          }
          await finishSuccess();
          return;
        }
        if (hasOrderPatch) {
          setPhase("ordering");
        }
      }

      const nextOrder = focusedScenario.parser.mergeOrder(orderRef.current, orderPatch);
      if (focusedScenario.prompts.isOrderRevision(orderRef.current, orderPatch)) {
        statsRef.current.corrections += 1;
      }
      setCurrentOrder(nextOrder);

      if (!hasOrderPatch) {
        if (mode === "open") {
          if (focusedScenario.prompts.isComplete(orderRef.current) && confirmsCurrentAnswer) {
            pendingSuggestionRef.current = undefined;
            await finishSuccess();
            return;
          }
          if (modelCashierLine) {
            await speakNpc(modelCashierLine);
            return;
          }
          const missing = focusedScenario.task.missingRequiredFields(orderRef.current);
          const attempt = nextPromptAttempt(focusedScenario.prompts.freeFlowPromptKey(orderRef.current, missing, "repair"));
          await speakCashierPrompt(focusedScenario.prompts.buildFreeFlowRepairQuestion(orderRef.current, phaseRef.current, attempt));
          return;
        }
        statsRef.current.repeats += 1;
        await speakNpc(focusedScenario.copy.lines.unclear);
        return;
      }

      if (mode === "open" && focusedScenario.prompts.isComplete(nextOrder)) {
        pendingSuggestionRef.current = undefined;
        await finishSuccess();
        return;
      }

      const objectiveOrder = mode === "arcade" ? objectiveRef.current?.target : undefined;
      const missingNext = focusedScenario.task.missingRequiredFields(nextOrder, objectiveOrder);
      if (modelCashierLine) {
        pendingSuggestionRef.current = undefined;
        pendingPromptRef.current = focusedScenario.task.promptForMissingFields(missingNext);
        if (mode === "arcade" && missingNext.length === 0) {
          pendingPromptRef.current = "confirm";
          setPhase("confirming");
        } else if (phaseRef.current === "confirming") {
          setPhase("ordering");
        }
        await speakNpc(modelCashierLine);
        return;
      }
      await askNextQuestion(nextOrder);
    },
    [addTurn, askNextQuestion, failRound, finishSuccess, focusedScenario, markInteraction, mode, nextPromptAttempt, setCurrentOrder, setPhase, speakCashierPrompt, speakNpc],
  );

  const startListening = useCallback((source: "manual" | "gaze" = "manual") => {
    if (experience !== "cashier") return;
    if (listening || !["ordering", "confirming"].includes(phaseRef.current)) return;
    if (source === "gaze" && (npcAudioActiveRef.current || Date.now() < listenBlockedUntilRef.current)) return;
    if (Date.now() - listenCooldownRef.current < listenCooldownMs) return;
    listenCooldownRef.current = Date.now();
    listenSourceRef.current = source;
    setPartial("");
    setSpeechFeedbackLabel("準備收音");
    setSpeechFeedbackText("正在打開麥克風。");
    const interruptedNpcAudio = npcSpeakingRef.current || npcAudioActiveRef.current;
    if (interruptedNpcAudio) {
      speechTurnRef.current += 1;
      npcAudioTokenRef.current += 1;
      setNpcSpeakingState(false);
      setNpcAudioActive(false);
      listenBlockedUntilRef.current = Date.now() + postNpcInterruptDelayMs;
    }
    voice.cancelSpeech();
    stopListeningRef.current?.();

    const beginListening = () => {
      if (source === "gaze" && (npcAudioActiveRef.current || Date.now() < listenBlockedUntilRef.current)) return;
      setListeningState(true);
      setSpeechFeedbackLabel("正在聽");
      setSpeechFeedbackText(focusedScenario.copy.lines.listeningFeedback);
      const stop = voice.listenOnce({
        onStart: () => {
          setMicReady(true);
          setListeningState(true);
          setSpeechFeedbackLabel("正在聽");
          setSpeechFeedbackText(focusedScenario.copy.lines.listeningFeedback);
        },
        onPartial: (text) => {
          setPartial(text);
          setSpeechFeedbackLabel("正在聽");
          setSpeechFeedbackText(text || focusedScenario.copy.lines.listeningFeedback);
        },
        onVoiceStart: () => {
          setSpeechFeedbackLabel("聽到了");
          setSpeechFeedbackText("正在辨識...");
        },
        onFinal: (text) => {
          setListeningState(false);
          setPartial("");
          setSpeechFeedbackLabel("聽到");
          setSpeechFeedbackText(text);
          void handleUtterance(text);
        },
        onError: async () => {
          setListeningState(false);
          setPartial("");
          if (listenSourceRef.current === "gaze") {
            if (mode === "open") {
              markInteraction();
              setSpeechFeedbackLabel("慢慢來");
              setSpeechFeedbackText(focusedScenario.copy.lines.freeFlowGazeMissFeedback);
            }
            return;
          }
          setSpeechFeedbackLabel("沒有聽到");
          setSpeechFeedbackText("請再說一次。");
          statsRef.current.technicalMisses += 1;
          if (statsRef.current.technicalMisses >= 2) {
            setTechnicalOverlay(true);
            await speakNpc(focusedScenario.copy.lines.technical);
          } else {
            await speakNpc(focusedScenario.copy.lines.louder);
          }
        },
        onEnd: () => setListeningState(false),
      });
      stopListeningRef.current = stop;
    };

    if (source === "manual" && interruptedNpcAudio) {
      window.setTimeout(beginListening, postNpcInterruptDelayMs);
    } else {
      beginListening();
    }
  }, [experience, focusedScenario, handleUtterance, listening, markInteraction, mode, setListeningState, setNpcAudioActive, setNpcSpeakingState, speakNpc, voice]);

  useEffect(() => {
    if (experience !== "cashier") return;
    if (!autoListen || !micReady) return;
    if (focusTarget !== "cashier") return;
    if (!["ordering", "confirming"].includes(phase)) return;
    if (listening || npcSpeaking || npcAudioActive) return;
    const delay = Math.max(gazeListenDelayMs, listenBlockedUntilRef.current - Date.now());
    const timeout = window.setTimeout(() => startListening("gaze"), delay);
    return () => window.clearTimeout(timeout);
  }, [autoListen, experience, focusTarget, listening, micReady, npcAudioActive, npcSpeaking, phase, startListening]);

  useEffect(() => {
    if (experience !== "cashier") return undefined;
    if (mode !== "open") return undefined;
    if (!["ordering", "confirming"].includes(phase)) return undefined;
    if (listening || npcSpeaking || npcAudioActive) return undefined;

    const timeout = window.setTimeout(() => {
      if (mode !== "open") return;
      if (!["ordering", "confirming"].includes(phaseRef.current)) return;
      const missing = focusedScenario.task.missingRequiredFields(orderRef.current);
      const attempt = nextPromptAttempt(focusedScenario.prompts.freeFlowPromptKey(orderRef.current, missing, "idle"));
      void speakCashierPrompt(focusedScenario.prompts.buildFreeFlowIdleHelp(orderRef.current, phaseRef.current, attempt));
    }, freeFlowIdleHelpMs);

    return () => window.clearTimeout(timeout);
  }, [currentOrder, experience, focusedScenario, interactionTick, listening, mode, nextPromptAttempt, npcAudioActive, npcSpeaking, phase, speakCashierPrompt]);

  useEffect(() => {
    if (mode !== "arcade" || !["ordering", "confirming"].includes(phase)) {
      setPressure(0);
      return undefined;
    }

    const update = () => {
      const elapsed = Math.max(0, (Date.now() - statsRef.current.startedAt) / 1000 - 18);
      const next = Math.min(
        100,
        elapsed * 3.5 + statsRef.current.corrections * 10 + statsRef.current.repeats * 12 + statsRef.current.technicalMisses * 15,
      );
      setPressure(Math.round(next));
    };
    update();
    const interval = window.setInterval(update, 500);
    return () => window.clearInterval(interval);
  }, [mode, phase]);

  useEffect(() => {
    radioRef.current?.duck(npcSpeaking || npcAudioActive || listening);
  }, [listening, npcAudioActive, npcSpeaking]);

  useEffect(() => {
    return () => {
      stopListeningRef.current?.();
      radioRef.current?.stop();
      successCueRef.current?.stop();
    };
  }, []);

  const nextRound = useCallback(() => {
    setRoundIndex((index) => {
      const next = index + 1;
      window.setTimeout(() => void startArcade(next), 0);
      return next;
    });
  }, [startArcade]);

  const shareReceipt = useCallback(async () => {
    if (!receipt) return;
    const text = focusedScenario.scoring.buildShareText(receipt);
    const url = window.location.href;
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };

    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: focusedScenario.copy.brand.shareTitle, text, url });
        setShareStatus(focusedScenario.copy.lines.shareOpened);
        return;
      }
      await writeClipboardText(`${text}\n${url}`);
      setShareStatus(focusedScenario.copy.lines.shareCopied);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await writeClipboardText(`${text}\n${url}`);
        setShareStatus(focusedScenario.copy.lines.shareCopied);
      } catch {
        setShareStatus(focusedScenario.copy.lines.shareUnavailable);
      }
    }
  }, [focusedScenario, receipt]);

  const advanceFromReceipt = useCallback(() => {
    if (mode === "arcade") {
      nextRound();
      return;
    }
    void startOpen();
  }, [mode, nextRound, startOpen]);

  const kioskView = useMemo<KioskViewModel>(
    () => ({
      screen: kioskScreen,
      language: kioskLanguage,
      drinkPage: kioskDrinkPage,
      selected: kioskSelected,
      cart: kioskCart,
      receipt: kioskReceipt,
    }),
    [kioskCart, kioskDrinkPage, kioskLanguage, kioskReceipt, kioskScreen, kioskSelected],
  );

  const handleCashierBreak = useCallback(() => {
    markInteraction();
    setNpcLine(focusedScenario.copy.lines.cashierBreak);
    setSpeechFeedbackLabel("店員");
    setSpeechFeedbackText(focusedScenario.copy.lines.cashierBreak);
    addTurn("店員", focusedScenario.copy.lines.cashierBreak);
    browserVoice.cancelSpeech();
    void browserVoice.speak(focusedScenario.copy.lines.cashierBreak, { voiceRole: "cashier" });
  }, [addTurn, browserVoice, focusedScenario, markInteraction]);

  const speakKioskCue = useCallback(
    (cue: KioskSpeechCue) => {
      setSpeechFeedbackLabel(cue.title);
      setSpeechFeedbackText(cue.text);
      void browserVoice.speak(cue.speakText ?? cue.text, { voiceRole: "system", rate: 0.9 });
    },
    [browserVoice],
  );

  const handleKioskAction = useCallback(
    (action: KioskAction) => {
      markInteraction();
      const speechCue = kioskSpeechCueForAction(action, kioskSelected, focusedScenario);
      if (speechCue) speakKioskCue(speechCue);
      const { drinks, sizes, sweetnessLevels, iceLevels, toppings } = focusedScenario.menu;
      switch (action.type) {
        case "open":
          setKioskOpen(true);
          setKioskScreen(kioskReceipt ? "receipt" : kioskCart.length ? "cart" : "drinks");
          return;
        case "close":
          setKioskOpen(false);
          return;
        case "back":
          if (kioskScreen === "customize") setKioskScreen("drinks");
          else if (kioskScreen === "cart") setKioskScreen("drinks");
          else if (kioskScreen === "receipt") {
            setKioskReceipt(undefined);
            setKioskCart([]);
            setKioskScreen("drinks");
          } else setKioskOpen(false);
          return;
        case "nextDrinkPage":
          setKioskDrinkPage((page) => Math.min(page + 1, Math.ceil(drinks.length / focusedScenario.kiosk.pageSize) - 1));
          return;
        case "previousDrinkPage":
          setKioskDrinkPage((page) => Math.max(0, page - 1));
          return;
        case "selectDrink":
          setKioskSelected(focusedScenario.task.makeKioskOrder(byId(drinks, action.id)));
          setKioskReceipt(undefined);
          setKioskScreen("customize");
          return;
        case "setSize":
          setKioskSelected((order) => ({ ...order, size: byId(sizes, action.id) }));
          return;
        case "setSweetness":
          setKioskSelected((order) => ({ ...order, sweetness: byId(sweetnessLevels, action.id) }));
          return;
        case "setIce":
          setKioskSelected((order) => ({ ...order, ice: byId(iceLevels, action.id) }));
          return;
        case "toggleTopping": {
          const topping = byId(toppings, action.id);
          setKioskSelected((order) => {
            const exists = order.toppings.some((item) => item.id === topping.id);
            return {
              ...order,
              toppings: exists ? order.toppings.filter((item) => item.id !== topping.id) : [...order.toppings, topping],
            };
          });
          return;
        }
        case "setQuantity":
          setKioskSelected((order) => ({ ...order, quantity: clamp(action.quantity, 1, 9) }));
          return;
        case "addToCart":
          if (!kioskSelected.drink) return;
          setKioskCart((cart) => [...cart, { id: `item-${Date.now().toString(36)}-${cart.length}`, order: focusedScenario.task.cloneOrder(kioskSelected) }]);
          setKioskReceipt(undefined);
          setKioskSelected(focusedScenario.task.makeKioskOrder());
          setKioskScreen("cart");
          return;
        case "showCart":
          setKioskScreen("cart");
          return;
        case "removeItem":
          setKioskCart((cart) => cart.filter((item) => item.id !== action.id));
          return;
        case "clearCart":
          setKioskCart([]);
          setKioskReceipt(undefined);
          setKioskScreen("drinks");
          return;
        case "checkout": {
          if (!kioskCart.length) return;
          const completionToken = completionTokenRef.current + 1;
          completionTokenRef.current = completionToken;
          const nextReceipt = focusedScenario.scoring.buildKioskReceipt(kioskCart);
          const servedOrder = focusedScenario.task.cloneOrder(nextReceipt.items[0]?.order ?? kioskCart[0].order);
          const completeLine = focusedScenario.kiosk.completeLine;
          successCuePlayedRef.current = false;
          setCurrentOrder(servedOrder);
          setKioskReceipt(nextReceipt);
          setKioskReceipts(saveKioskReceipt(nextReceipt, focusedScenario.kiosk.storage.receipts));
          setKioskScreen("receipt");
          setKioskOpen(false);
          setSpeechFeedbackLabel("自助點餐");
          setSpeechFeedbackText(completeLine);
          setNpcLine(completeLine);
          setPhase("serving");
          playSuccessCue();
          browserVoice.cancelSpeech();
          void browserVoice.speak(completeLine, { voiceRole: "system", rate: 0.9 });
          window.setTimeout(() => {
            if (completionTokenRef.current !== completionToken || phaseRef.current !== "serving") return;
            setPhase("kiosk");
          }, drinkArrivalReceiptDelayMs);
          return;
        }
        case "newOrder":
          completionTokenRef.current += 1;
          setKioskReceipt(undefined);
          setKioskCart([]);
          setKioskSelected(focusedScenario.task.makeKioskOrder());
          setKioskScreen("drinks");
          setPhase("kiosk");
          return;
        case "setLanguage":
          setKioskLanguage(action.language);
          return;
      }
    },
    [browserVoice, focusedScenario, kioskCart, kioskReceipt, kioskScreen, kioskSelected, markInteraction, playSuccessCue, setCurrentOrder, setPhase, speakKioskCue],
  );

  const completeIntro = useCallback(() => {
    if (!introReady) return;
    setIntroComplete(true);
  }, [introReady]);

  const nextIntroPanel = useCallback(() => {
    if (introIndex < introPanels.length - 1) {
      setIntroIndex((index) => index + 1);
      return;
    }
    completeIntro();
  }, [completeIntro, introIndex, introPanels.length]);

  const typedSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput.trim();
    setSpeechFeedbackLabel("文字輸入");
    setSpeechFeedbackText(text);
    void handleUtterance(text);
    setTypedInput("");
  };

  const liveRound = experience === "cashier" && ["ordering", "confirming", "paying", "serving"].includes(phase);
  const playerTurn = experience === "cashier" && ["ordering", "confirming"].includes(phase) && !npcSpeaking && !npcAudioActive;
  const showSpeechFeedback = !showLoadingGate && (liveRound || (experience === "kiosk" && phase === "kiosk"));

  return (
    <main>
      <BobaScene
        key={focusedScenarioId}
        scenario={focusedScenario}
        scenarioId={focusedScenarioId}
        phase={phase}
        experience={experience}
        listening={listening}
        npcSpeaking={npcSpeaking}
        npcLine={npcLine}
        playerSpeechLabel={speechFeedbackLabel}
        playerSpeechText={speechFeedbackText}
        pressure={pressure}
        currentOrder={currentOrder}
        receipt={receipt}
        cashierPose={COUNTER_CASHIER_POSE}
        kioskOpen={kioskOpen}
        kioskView={kioskView}
        onFocusTargetChange={setFocusTarget}
        onReceiptAdvance={advanceFromReceipt}
        onKioskAction={handleKioskAction}
        onCashierBreak={handleCashierBreak}
        loadingActive={showLoadingGate}
        loadingTitle={focusedScenario.card.title}
        loadingStatus={loadingStatus}
        loadingProgress={loadingProgress}
        loadingReady={loadingReady}
        onLoadingEnter={enterScenario}
        onSceneLoadProgress={handleSceneLoadProgress}
      />

      {introComplete && !showLoadingGate && (
        <div
          className={`reticle ${focusTarget !== "none" ? "reticle--active" : ""} ${playerTurn ? "reticle--ready" : ""} ${listening ? "reticle--listening" : ""}`}
        />
      )}

      {!showLoadingGate && (
        <section className={`hud hud--top ${liveRound ? "hud--quiet" : ""}`}>
          <div className="brand">
            <span>{focusedScenario.copy.brand.title}</span>
            <small>{experience === "kiosk" ? focusedScenario.copy.brand.kioskSubtitle : mode === "arcade" ? focusedScenario.copy.brand.arcadeRoundLabel(roundIndex) : focusedScenario.copy.brand.openSubtitle}</small>
          </div>
          {!liveRound && <div className="status-pill" title={experience === "kiosk" ? "Cashier voice is off. Use the kiosk to order." : geminiLivePlan.model}>
            {runtimeStatus.loaded
              ? experience === "cashier"
                ? "Cashier voice"
                : "Public Mode"
              : "Loading"}
          </div>}
          {mode === "arcade" && liveRound && pressure > 0 && (
            <div className="pressure-meter">
              <span>後方耐心</span>
              <div>
                <i style={{ width: `${Math.max(8, 100 - pressure)}%` }} />
              </div>
            </div>
          )}
          {experience === "cashier" && (
            <label className="toggle">
              <input type="checkbox" checked={autoListen} onChange={(event) => setAutoListen(event.target.checked)} />
              <span>Gaze listen</span>
            </label>
          )}
        </section>
      )}

      {showLoadingGate && (
        <section className="scenario-loader" aria-live="polite">
          <div className="scenario-shell">
            <h1 className="sr-only">Choose a scenario</h1>
            <div className="scenario-carousel" role="listbox" aria-label="Available scenarios">
              <button className="scenario-nav" disabled aria-label="Previous scenario">
                ‹
              </button>
              <div className="scenario-track">
                {scenarios.map((scenario) => {
                  const active = scenario.id === focusedScenarioId;
                  const card = scenario.card;
                  return (
                    <button
                      key={scenario.id}
                      className={`scenario-card ${active ? "scenario-card--active" : ""}`}
                      role="option"
                      aria-selected={active}
                      onFocus={() => focusScenario(scenario.id)}
                      onMouseEnter={() => focusScenario(scenario.id)}
                      onClick={() => focusScenario(scenario.id)}
                    >
                      <span className="scenario-shot">
                        <img src={card.image} alt="" width={card.imageWidth} height={card.imageHeight} decoding="async" />
                      </span>
                      <span className="scenario-copy">
                        <strong>{card.kicker}</strong>
                        <span>{card.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button className="scenario-nav" disabled aria-label="Next scenario">
                ›
              </button>
            </div>
            {loadingReady ? (
              <div className="scenario-actions">
                <button onClick={enterScenario}>
                  Enter
                </button>
              </div>
            ) : (
              <>
                <div className="scenario-load-meta">
                  <span>{loadingProgress}%</span>
                </div>
                <div
                  className="loading-progress"
                  role="progressbar"
                  aria-label={`Loading ${focusedScenario.card.title}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={loadingProgress}
                >
                  <i style={{ width: `${loadingProgress}%` }} />
                </div>
                {loadingStatus && <p>{loadingStatus}</p>}
              </>
            )}
          </div>
        </section>
      )}

      {!showLoadingGate && !introComplete && (
        <section className="intro-loader" aria-live="polite">
          <div className="intro-art" aria-hidden="true">
            <span>{introIndex + 1}</span>
          </div>
          <span className="mode-kicker">{introPanels[introIndex].kicker}</span>
          <h1>{introPanels[introIndex].title}</h1>
          <p>{introPanels[introIndex].body}</p>
          <div className="intro-progress" aria-label="Intro progress">
            {introPanels.map((panel, index) => (
              <i key={panel.title} className={index <= introIndex ? "intro-progress--active" : ""} />
            ))}
          </div>
          <div className="button-row">
            <button onClick={nextIntroPanel} disabled={introIndex === introPanels.length - 1 && !introReady}>
              {introIndex === introPanels.length - 1 ? (introReady ? "Enter" : "Loading") : "Next"}
            </button>
            <button className="secondary" onClick={completeIntro} disabled={!introReady}>
              Skip
            </button>
          </div>
        </section>
      )}

      {introComplete && experience === "cashier" && phase === "menu" && (
        <section className="panel start-panel">
          <span className="mode-kicker">{focusedScenario.copy.brand.startKicker}</span>
          <h1>{focusedScenario.copy.brand.startTitle}</h1>
          <p>{focusedScenario.copy.brand.startBody}</p>
          <div className="button-row">
            <button onClick={() => void startArcade()}>{focusedScenario.copy.brand.challengeButton}</button>
            <button className="secondary" onClick={() => void startOpen()}>
              {focusedScenario.copy.brand.freePracticeButton}
            </button>
          </div>
        </section>
      )}

      {phase === "briefing" && objective && (
        <section className="ticket">
          <div className="ticket-label">{objective.ticketTitle}</div>
          {focusedScenario.task.compactTicketLines(objective.target).map((line) => (
            <strong key={line}>{line}</strong>
          ))}
          <small>{focusedScenario.copy.lines.briefingHint}</small>
        </section>
      )}

      {["ordering", "confirming", "paying", "serving"].includes(phase) && (
        <section className="npc-caption sr-only" aria-live="polite">
          <span className={npcSpeaking ? "caption-dot caption-dot--speaking" : "caption-dot"} />
          <p>{npcLine}</p>
        </section>
      )}

      {!showLoadingGate && partial && <section className="partial">「{partial}」</section>}

      {showSpeechFeedback && speechFeedbackText && (
        <section className={`speech-feedback ${listening ? "speech-feedback--listening" : ""}`} aria-live="polite">
          <span>{speechFeedbackLabel}</span>
          <p>{speechFeedbackText}</p>
        </section>
      )}

      {!showLoadingGate && ["ordering", "confirming"].includes(phase) && (
        <section className={`controls ${playerTurn ? "controls--ready" : ""}`}>
          <button className={listening ? "danger" : ""} onClick={() => startListening("manual")} disabled={!voice.isListeningSupported()}>
            {listening ? "Listening..." : npcSpeaking || npcAudioActive ? "Interrupt" : "Speak"}
          </button>
          <details>
            <summary>Text test</summary>
            <form onSubmit={typedSubmit}>
              <input value={typedInput} onChange={(event) => setTypedInput(event.target.value)} placeholder={focusedScenario.copy.lines.textInputPlaceholder} />
              <button type="submit">Submit</button>
            </form>
          </details>
        </section>
      )}

      {technicalOverlay && (
        <section className="technical">
          <h2>{focusedScenario.copy.lines.technicalTitle}</h2>
          <p>{focusedScenario.copy.lines.technicalBody}</p>
          <button onClick={() => setTechnicalOverlay(false)}>Continue</button>
        </section>
      )}

      {phase === "failed" && (
        <section className="fail-screen">
          <h2>{focusedScenario.copy.lines.failTitle}</h2>
          <p>{npcLine}</p>
          <button onClick={() => void startArcade()}>Try Again</button>
        </section>
      )}

      {phase === "receipt" && receipt && (
        <section className={`end-actions ${focusTarget === "receipt" ? "end-actions--quiet" : ""}`} aria-label={focusedScenario.copy.lines.receiptActionsLabel}>
          <div className="button-row">
            <button onClick={() => void shareReceipt()}>Share Score</button>
            <button onClick={nextRound}>Next Order</button>
            <button className="secondary" onClick={() => void startOpen()}>
              Free Practice
            </button>
          </div>
          {shareStatus && <small className="share-status">{shareStatus}</small>}
        </section>
      )}
    </main>
  );
}

function speechSafetyMs(text: string, role: "cashier" | "announcer" | "system") {
  const base = role === "announcer" ? 7000 : npcSpeechSafetyMs;
  return Math.min(Math.max(base, text.length * 180), 9000);
}

function speechAudioMaxMs(text: string, role: "cashier" | "announcer" | "system") {
  return speechSafetyMs(text, role) + (role === "announcer" ? 1600 : 900);
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}
