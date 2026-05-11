import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BobaScene, { COUNTER_CASHIER_POSE, type FocusTarget } from "./three/BobaScene";
import { BrowserMandarinVoiceProvider } from "./voice/browserMandarinVoice";
import { GeminiLiveVoiceProvider } from "./voice/geminiLiveVoice";
import { geminiLivePlan } from "./voice/geminiLivePlan";
import { ShopRadio } from "./voice/shopRadio";
import { SuccessCue } from "./voice/successCue";
import type { DialogueTurn, GameMode, GamePhase, Order, Receipt, RoundObjective, RoundStats } from "./game/types";
import { compactTicketLines, describeOrder, drinks, iceLevels, missingRequiredFields, orderTotal, ordersMatch, sizes, sweetnessLevels } from "./game/menu";
import { interpretFreeFlowUtterance } from "./game/geminiIntent";
import { getObjective } from "./game/rounds";
import { mergeOrder, parseUtterance, resetOrder } from "./game/parser";
import { buildReceipt, saveReceipt } from "./game/scoring";

const openingLine = "歡迎光臨，想喝什麼？";
const technicalLine = "不好意思，我的耳朵好像突然當機了。請再試一次。";
const radioChangedLine = "好，我幫你換一首。";
const listeningFeedback = "請說話，我正在聽。";
const listenCooldownMs = 180;
const gazeListenDelayMs = 25;
const orderingEntryDelayMs = 120;
const freeFlowIdleHelpMs = 10000;
const freeFlowGazeMissFeedback = "慢慢來，想好了再說，我會等你。";
const npcSpeechSafetyMs = 5200;
const postNpcAudioTailMs = 120;
const postNpcInterruptDelayMs = 80;

type PendingOrderPrompt = "none" | "drink" | "size" | "sweetness" | "ice" | "confirm";
type CashierPrompt = {
  text: string;
  suggestion?: Partial<Order>;
};

function byId<T extends { id: string }>(items: T[], id: string): T {
  return items.find((item) => item.id === id) ?? items[0];
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
  const voice = useMemo(() => new GeminiLiveVoiceProvider(new BrowserMandarinVoiceProvider()), []);
  const radioRef = useRef<ShopRadio | null>(null);
  const successCueRef = useRef<SuccessCue | null>(null);
  const successCuePlayedRef = useRef(false);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<RoundStats>(makeStats());
  const objectiveRef = useRef<RoundObjective | undefined>(undefined);
  const orderRef = useRef<Order>(resetOrder());
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

  const [mode, setMode] = useState<GameMode>("arcade");
  const [phase, setPhaseState] = useState<GamePhase>("menu");
  const [roundIndex, setRoundIndex] = useState(0);
  const [objective, setObjective] = useState<RoundObjective | undefined>();
  const [currentOrder, setCurrentOrderState] = useState<Order>(resetOrder());
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
    setDialogue((turns) => [{ speaker, text, at: Date.now() }, ...turns].slice(0, 8));
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
      setCurrentOrder(resetOrder());
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
      npcAudioTokenRef.current += 1;
      setNpcAudioActive(false);
      setNpcSpeakingState(false);
      listenBlockedUntilRef.current = 0;
      setInteractionTick((tick) => tick + 1);
      setDialogue([]);
    },
    [setCurrentOrder, setNpcAudioActive, setNpcSpeakingState],
  );

  const armMic = useCallback(async () => {
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
  }, [voice]);

  const enterOrdering = useCallback(async () => {
    setPhase("ordering");
    await speakNpc(openingLine);
  }, [setPhase, speakNpc]);

  const startArcade = useCallback(async (objectiveIndex = roundIndex) => {
    radioRef.current ??= new ShopRadio();
    radioRef.current.start();
    void armMic();
    const nextObjective = getObjective(objectiveIndex);
    resetRoundState("arcade", nextObjective);
    preloadSuccessCue();
    setPhase("briefing");
    setNpcLine(nextObjective.spokenPrompt);
    await voice.speak(nextObjective.spokenPrompt, { voiceRole: "announcer", rate: 0.82 });
    window.setTimeout(() => {
      if (phaseRef.current === "briefing") void enterOrdering();
    }, orderingEntryDelayMs);
  }, [armMic, enterOrdering, preloadSuccessCue, resetRoundState, roundIndex, setPhase, voice]);

  const startOpen = useCallback(async () => {
    radioRef.current ??= new ShopRadio();
    radioRef.current.start();
    void armMic();
    resetRoundState("open", undefined);
    preloadSuccessCue();
    setPhase("ordering");
    await speakNpc(openingLine);
  }, [armMic, preloadSuccessCue, resetRoundState, setPhase, speakNpc]);

  const finishSuccess = useCallback(async () => {
    const recognized = orderRef.current;
    const total = orderTotal(recognized);
    statsRef.current.endedAt = Date.now();
    const nextReceipt = buildReceipt({
      mode,
      objective: objectiveRef.current,
      recognized,
      stats: statsRef.current,
      success: true,
    });
    setReceipt(nextReceipt);
    saveReceipt(nextReceipt);

    if (mode === "open") {
      pendingPromptRef.current = "none";
      setPhase("serving");
      playSuccessCue();
      void speakNpc(`好，${describeOrder(recognized)}，一共 ${total} 元。你的飲料好了！`);
      window.setTimeout(() => {
        if (phaseRef.current === "serving") setPhase("receipt");
      }, 3600);
      return;
    }

    setPhase("paying");
    await speakNpc(`好，一共 ${total} 元。這邊幫你結帳。`);
    setPhase("serving");
    playSuccessCue();
    await speakNpc("你的飲料好了，謝謝。");
    setPhase("receipt");
  }, [mode, playSuccessCue, setPhase, speakNpc]);

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
      const missing = missingRequiredFields(order, objectiveOrder);
      if (mode === "open") {
        pendingPromptRef.current = promptForMissingFields(missing);
        const attempt = nextPromptAttempt(freeFlowPromptKey(order, missing, "ask"));
        await speakCashierPrompt(buildFreeFlowMissingQuestion(order, missing, attempt));
        return;
      }
      if (!order.drink) {
        pendingPromptRef.current = "drink";
        await speakNpc("不好意思，你想喝哪一杯？");
        return;
      }
      if (missing.includes("杯型")) {
        pendingPromptRef.current = "size";
        await speakNpc("要中杯還是大杯？");
        return;
      }
      if (missing.includes("甜度") && missing.includes("冰塊")) {
        pendingPromptRef.current = "none";
        await speakNpc("甜度冰塊呢？");
        return;
      }
      if (missing.includes("甜度")) {
        pendingPromptRef.current = "sweetness";
        await speakNpc("甜度要怎麼做？");
        return;
      }
      if (missing.includes("冰塊")) {
        pendingPromptRef.current = "ice";
        await speakNpc("冰塊要怎麼做？");
        return;
      }
      pendingPromptRef.current = "confirm";
      setPhase("confirming");
      await speakNpc("好，這樣對嗎？");
    },
    [mode, nextPromptAttempt, setPhase, speakCashierPrompt, speakNpc],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      markInteraction();
      setPartial("");
      addTurn("玩家", text);
      let parsed = parseUtterance(text);
      let modelCashierLine: string | undefined;
      if (shouldAskGeminiIntent(mode, parsed)) {
        const interpreted = await interpretFreeFlowUtterance({
          text,
          mode,
          phase: phaseRef.current,
          currentOrder: orderRef.current,
          pendingPrompt: pendingPromptRef.current,
          pendingSuggestion: pendingSuggestionRef.current,
          localParsed: parsed,
        });
        parsed = interpreted.parsed;
        modelCashierLine = interpreted.cashierLine;
      }
      if (parsed.sideIntent?.type === "radio.nextTrack") {
        radioRef.current?.nextTrack();
        await speakNpc(radioChangedLine);
        return;
      }
      if (parsed.sideIntent?.type === "cashier.advice") {
        await speakNpc(modelCashierLine ?? buildCashierAdvice(parsed.sideIntent.topic, orderRef.current, objectiveRef.current?.target));
        return;
      }

      statsRef.current.politeHits.push(...parsed.politeHits);
      let orderPatch =
        mode === "open" ? applyFreeFlowPromptContext(text, parsed.orderPatch, orderRef.current, pendingPromptRef.current) : parsed.orderPatch;
      const confirmsCurrentAnswer = isLikelyConfirmationResponse(text, parsed);
      if (mode === "open" && confirmsCurrentAnswer && pendingSuggestionRef.current) {
        orderPatch = { ...orderPatch, ...pendingSuggestionRef.current };
        pendingSuggestionRef.current = undefined;
      } else if (mode === "open" && parsed.denies && pendingSuggestionRef.current && !Object.keys(orderPatch).length) {
        pendingSuggestionRef.current = undefined;
        const missing = missingRequiredFields(orderRef.current);
        const attempt = nextPromptAttempt(freeFlowPromptKey(orderRef.current, missing, "deny"));
        await speakCashierPrompt(buildFreeFlowRepairQuestion(orderRef.current, phaseRef.current, attempt));
        return;
      }
      const hasOrderPatch = Object.keys(orderPatch).length > 0;

      if (phaseRef.current === "confirming") {
        if (parsed.denies && !hasOrderPatch) {
          statsRef.current.corrections += 1;
          setPhase("ordering");
          await speakNpc("沒問題，你要改哪裡？");
          return;
        }
        if (confirmsCurrentAnswer && !hasOrderPatch && isFreeFlowComplete(orderRef.current)) {
          const target = objectiveRef.current?.target;
          if (mode === "arcade" && target && !ordersMatch(orderRef.current, target)) {
            await failRound("點單失敗。後面的人已經等到靈魂出竅了。");
            return;
          }
          await finishSuccess();
          return;
        }
        if (hasOrderPatch) {
          setPhase("ordering");
        }
      }

      const nextOrder = mergeOrder(orderRef.current, orderPatch);
      if (isOrderRevision(orderRef.current, orderPatch)) {
        statsRef.current.corrections += 1;
      }
      setCurrentOrder(nextOrder);

      if (!hasOrderPatch) {
        if (mode === "open") {
          if (isFreeFlowComplete(orderRef.current) && confirmsCurrentAnswer) {
            pendingSuggestionRef.current = undefined;
            await finishSuccess();
            return;
          }
          if (modelCashierLine) {
            await speakNpc(modelCashierLine);
            return;
          }
          const missing = missingRequiredFields(orderRef.current);
          const attempt = nextPromptAttempt(freeFlowPromptKey(orderRef.current, missing, "repair"));
          await speakCashierPrompt(buildFreeFlowRepairQuestion(orderRef.current, phaseRef.current, attempt));
          return;
        }
        statsRef.current.repeats += 1;
        await speakNpc("不好意思，我沒有聽清楚。可以再說一次嗎？");
        return;
      }

      if (mode === "open" && isFreeFlowComplete(nextOrder)) {
        pendingSuggestionRef.current = undefined;
        await finishSuccess();
        return;
      }

      if (mode === "open" && hasOrderPatch) {
        pendingSuggestionRef.current = undefined;
        if (modelCashierLine) {
          pendingPromptRef.current = promptForMissingFields(missingRequiredFields(nextOrder));
          await speakNpc(modelCashierLine);
          return;
        }
      }
      await askNextQuestion(nextOrder);
    },
    [addTurn, askNextQuestion, failRound, finishSuccess, markInteraction, mode, nextPromptAttempt, setCurrentOrder, setPhase, speakCashierPrompt, speakNpc],
  );

  const startListening = useCallback((source: "manual" | "gaze" = "manual") => {
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
      setSpeechFeedbackText(listeningFeedback);
      const stop = voice.listenOnce({
        onStart: () => {
          setMicReady(true);
          setListeningState(true);
          setSpeechFeedbackLabel("正在聽");
          setSpeechFeedbackText(listeningFeedback);
        },
        onPartial: (text) => {
          setPartial(text);
          setSpeechFeedbackLabel("正在聽");
          setSpeechFeedbackText(text || listeningFeedback);
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
              setSpeechFeedbackText(freeFlowGazeMissFeedback);
            }
            return;
          }
          setSpeechFeedbackLabel("沒有聽到");
          setSpeechFeedbackText("請再說一次。");
          statsRef.current.technicalMisses += 1;
          if (statsRef.current.technicalMisses >= 2) {
            setTechnicalOverlay(true);
            await speakNpc(technicalLine);
          } else {
            await speakNpc("不好意思，可以講大聲一點嗎？");
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
  }, [handleUtterance, listening, markInteraction, mode, setListeningState, setNpcAudioActive, setNpcSpeakingState, speakNpc, voice]);

  useEffect(() => {
    if (!autoListen || !micReady) return;
    if (focusTarget !== "cashier") return;
    if (!["ordering", "confirming"].includes(phase)) return;
    if (listening || npcSpeaking || npcAudioActive) return;
    const delay = Math.max(gazeListenDelayMs, listenBlockedUntilRef.current - Date.now());
    const timeout = window.setTimeout(() => startListening("gaze"), delay);
    return () => window.clearTimeout(timeout);
  }, [autoListen, focusTarget, listening, micReady, npcAudioActive, npcSpeaking, phase, startListening]);

  useEffect(() => {
    if (mode !== "open") return undefined;
    if (!["ordering", "confirming"].includes(phase)) return undefined;
    if (listening || npcSpeaking || npcAudioActive) return undefined;

    const timeout = window.setTimeout(() => {
      if (mode !== "open") return;
      if (!["ordering", "confirming"].includes(phaseRef.current)) return;
      const missing = missingRequiredFields(orderRef.current);
      const attempt = nextPromptAttempt(freeFlowPromptKey(orderRef.current, missing, "idle"));
      void speakCashierPrompt(buildFreeFlowIdleHelp(orderRef.current, phaseRef.current, attempt));
    }, freeFlowIdleHelpMs);

    return () => window.clearTimeout(timeout);
  }, [currentOrder, interactionTick, listening, mode, nextPromptAttempt, npcAudioActive, npcSpeaking, phase, speakCashierPrompt]);

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
    const text = buildReceiptShareText(receipt);
    const url = window.location.href;
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };

    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: "珍奶快打收據", text, url });
        setShareStatus("已開啟分享。");
        return;
      }
      await writeClipboardText(`${text}\n${url}`);
      setShareStatus("分享文字已複製。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await writeClipboardText(`${text}\n${url}`);
        setShareStatus("分享文字已複製。");
      } catch {
        setShareStatus("分享暫時無法使用。");
      }
    }
  }, [receipt]);

  const typedSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput.trim();
    setSpeechFeedbackLabel("文字輸入");
    setSpeechFeedbackText(text);
    void handleUtterance(text);
    setTypedInput("");
  };

  const liveRound = ["ordering", "confirming", "paying", "serving"].includes(phase);
  const playerTurn = ["ordering", "confirming"].includes(phase) && !npcSpeaking && !npcAudioActive;

  return (
    <main>
      <BobaScene
        phase={phase}
        listening={listening}
        npcSpeaking={npcSpeaking}
        npcLine={npcLine}
        playerSpeechLabel={speechFeedbackLabel}
        playerSpeechText={speechFeedbackText}
        pressure={pressure}
        currentOrder={currentOrder}
        receipt={receipt}
        cashierPose={COUNTER_CASHIER_POSE}
        onFocusTargetChange={setFocusTarget}
      />

      <div
        className={`reticle ${focusTarget !== "none" ? "reticle--active" : ""} ${playerTurn ? "reticle--ready" : ""} ${listening ? "reticle--listening" : ""}`}
      />

      <section className={`hud hud--top ${liveRound ? "hud--quiet" : ""}`}>
        <div className="brand">
          <span>珍奶快打</span>
          <small>{mode === "arcade" ? `第 ${roundIndex + 1} 關` : "自由模式"}</small>
        </div>
        {!liveRound && <div className="status-pill" title={geminiLivePlan.model}>
          語音：Gemini Live
        </div>}
        {mode === "arcade" && liveRound && pressure > 0 && (
          <div className="pressure-meter">
            <span>後方耐心</span>
            <div>
              <i style={{ width: `${Math.max(8, 100 - pressure)}%` }} />
            </div>
          </div>
        )}
        <label className="toggle">
          <input type="checkbox" checked={autoListen} onChange={(event) => setAutoListen(event.target.checked)} />
          <span>凝視聆聽</span>
        </label>
      </section>

      {phase === "menu" && (
        <section className="panel start-panel">
          <span className="mode-kicker">台灣飲料店實戰</span>
          <h1>珍奶快打</h1>
          <p>聽目標，站上櫃台，用中文把飲料點對。越順，分數越高；越卡，後面越急。</p>
          <div className="button-row">
            <button onClick={() => void startArcade()}>開始挑戰</button>
            <button className="secondary" onClick={() => void startOpen()}>
              自由練習
            </button>
          </div>
        </section>
      )}

      {phase === "briefing" && objective && (
        <section className="ticket">
          <div className="ticket-label">{objective.ticketTitle}</div>
          {compactTicketLines(objective.target).map((line) => (
            <strong key={line}>{line}</strong>
          ))}
          <small>聽完就點，別讓後面等太久。</small>
        </section>
      )}

      {["ordering", "confirming", "paying", "serving"].includes(phase) && (
        <section className="npc-caption sr-only" aria-live="polite">
          <span className={npcSpeaking ? "caption-dot caption-dot--speaking" : "caption-dot"} />
          <p>{npcLine}</p>
        </section>
      )}

      {partial && <section className="partial">「{partial}」</section>}

      {["ordering", "confirming", "paying", "serving"].includes(phase) && speechFeedbackText && (
        <section className={`speech-feedback ${listening ? "speech-feedback--listening" : ""}`} aria-live="polite">
          <span>{speechFeedbackLabel}</span>
          <p>{speechFeedbackText}</p>
        </section>
      )}

      {["ordering", "confirming"].includes(phase) && (
        <section className={`controls ${playerTurn ? "controls--ready" : ""}`}>
          <button className={listening ? "danger" : ""} onClick={() => startListening("manual")} disabled={!voice.isListeningSupported()}>
            {listening ? "正在聽..." : npcSpeaking || npcAudioActive ? "打斷說話" : "輪到你說"}
          </button>
          <details>
            <summary>文字測試</summary>
            <form onSubmit={typedSubmit}>
              <input value={typedInput} onChange={(event) => setTypedInput(event.target.value)} placeholder="我要一杯珍珠奶茶半糖少冰" />
              <button type="submit">送出</button>
            </form>
          </details>
        </section>
      )}

      {technicalOverlay && (
        <section className="technical">
          <h2>收音異常</h2>
          <p>系統連續兩次沒有聽清楚。請檢查麥克風，或改用按一下說話。</p>
          <button onClick={() => setTechnicalOverlay(false)}>繼續</button>
        </section>
      )}

      {phase === "failed" && (
        <section className="fail-screen">
          <h2>點單失敗</h2>
          <p>{npcLine}</p>
          <button onClick={() => void startArcade()}>重新挑戰</button>
        </section>
      )}

      {phase === "receipt" && receipt && (
        <section className={`end-actions ${focusTarget === "receipt" ? "end-actions--quiet" : ""}`} aria-label="回合完成操作">
          <div className="button-row">
            <button onClick={() => void shareReceipt()}>分享成績</button>
            <button onClick={nextRound}>下一張點單</button>
            <button className="secondary" onClick={() => void startOpen()}>
              自由練習
            </button>
          </div>
          {shareStatus && <small className="share-status">{shareStatus}</small>}
        </section>
      )}
    </main>
  );
}

function applyFreeFlowPromptContext(text: string, patch: Partial<Order>, current: Order, pendingPrompt: PendingOrderPrompt): Partial<Order> {
  const normalized = normalizePromptAnswer(text);
  const contextualPatch = { ...patch };
  const missing = missingRequiredFields(current);
  const canInferSweetness = pendingPrompt !== "ice" || mentionsExplicitSweetness(normalized);
  const canInferIce = pendingPrompt !== "sweetness" || mentionsExplicitIce(normalized);

  if (pendingPrompt === "sweetness") {
    if (!mentionsExplicitIce(normalized) && !current.ice) delete contextualPatch.ice;
    contextualPatch.sweetness ??= inferSweetnessAnswer(normalized);
  }

  if (pendingPrompt === "ice") {
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

function speechSafetyMs(text: string, role: "cashier" | "announcer" | "system") {
  const base = role === "announcer" ? 7000 : npcSpeechSafetyMs;
  return Math.min(Math.max(base, text.length * 180), 9000);
}

function speechAudioMaxMs(text: string, role: "cashier" | "announcer" | "system") {
  return speechSafetyMs(text, role) + (role === "announcer" ? 1600 : 900);
}

function isOrderRevision(current: Order, patch: Partial<Order>) {
  if (patch.quantity && current.quantity && patch.quantity !== current.quantity) return true;
  if (patch.drink && current.drink && patch.drink.id !== current.drink.id) return true;
  if (patch.size && current.size && patch.size.id !== current.size.id) return true;
  if (patch.sweetness && current.sweetness && patch.sweetness.id !== current.sweetness.id) return true;
  if (patch.ice && current.ice && patch.ice.id !== current.ice.id) return true;
  return false;
}

function isFreeFlowComplete(order: Order) {
  return missingRequiredFields(order).length === 0;
}

function isLikelyConfirmationResponse(text: string, parsed: ReturnType<typeof parseUtterance>) {
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

function buildReceiptShareText(receipt: Receipt) {
  const modeText = receipt.mode === "arcade" ? "挑戰模式" : "自由練習";
  return `我在珍奶快打${modeText}拿到 ${receipt.score} 分，成功點了 ${describeOrder(receipt.recognized)}。`;
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

function shouldAskGeminiIntent(mode: GameMode, parsed: ReturnType<typeof parseUtterance>) {
  if (mode !== "open") return false;
  if (parsed.sideIntent?.type === "radio.nextTrack") return false;
  if (parsed.confirms || parsed.denies) return false;
  return true;
}

function freeFlowPromptKey(order: Order, missing: string[], source: "ask" | "repair" | "idle" | "deny") {
  const drink = order.drink?.id ?? "no-drink";
  const fields = missing.length ? missing.join("-") : "complete";
  return `${source}:${drink}:${fields}`;
}

function promptForMissingFields(missing: string[]): PendingOrderPrompt {
  if (missing.includes("飲料")) return "drink";
  if (missing.includes("杯型")) return "size";
  if (missing.includes("甜度")) return "sweetness";
  if (missing.includes("冰塊")) return "ice";
  return "none";
}

function buildFreeFlowMissingQuestion(order: Order, missing: string[], attempt: number): CashierPrompt {
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

function buildFreeFlowIdleHelp(order: Order, phase: GamePhase, attempt: number): CashierPrompt {
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

function buildFreeFlowRepairQuestion(order: Order, phase: GamePhase, attempt: number): CashierPrompt {
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

function buildCashierAdvice(topic: "sweetness" | "ice" | "size" | "topping" | "drink" | "general", order: Order, target?: Order) {
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
