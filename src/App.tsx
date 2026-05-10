import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BobaScene, { COUNTER_CASHIER_POSE, type FocusTarget } from "./three/BobaScene";
import { BrowserMandarinVoiceProvider } from "./voice/browserMandarinVoice";
import { NvidiaStreamingSpeechVoiceProvider } from "./voice/nvidiaStreamingSpeechVoice";
import { ShopRadio } from "./voice/shopRadio";
import type { DialogueTurn, GameMode, GamePhase, Order, Receipt, RoundObjective, RoundStats } from "./game/types";
import { compactTicketLines, describeOrder, missingRequiredFields, orderTotal, ordersMatch } from "./game/menu";
import { getObjective } from "./game/rounds";
import { mergeOrder, parseUtterance, resetOrder } from "./game/parser";
import { buildReceipt, loadReceipts, saveReceipt } from "./game/scoring";
import { nvidiaVoicePlan } from "./voice/nvidiaVoicePlan";

const openingLine = "歡迎光臨，想喝什麼？";
const technicalLine = "不好意思，我的耳朵好像突然當機了。請再試一次。";
const radioChangedLine = "好，我幫你換一首。";
const listeningFeedback = "請說話，我正在聽。";

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
  const voice = useMemo(() => new NvidiaStreamingSpeechVoiceProvider(new BrowserMandarinVoiceProvider()), []);
  const radioRef = useRef<ShopRadio | null>(null);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<RoundStats>(makeStats());
  const objectiveRef = useRef<RoundObjective | undefined>(undefined);
  const orderRef = useRef<Order>(resetOrder());
  const phaseRef = useRef<GamePhase>("menu");
  const listenCooldownRef = useRef(0);
  const speechTurnRef = useRef(0);
  const listenSourceRef = useRef<"manual" | "gaze">("manual");

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
  const [micReady, setMicReady] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("none");
  const [dialogue, setDialogue] = useState<DialogueTurn[]>([]);
  const [receipt, setReceipt] = useState<Receipt | undefined>();
  const [receipts, setReceipts] = useState<Receipt[]>(() => loadReceipts());
  const [autoListen, setAutoListen] = useState(false);
  const [technicalOverlay, setTechnicalOverlay] = useState(false);
  const [typedInput, setTypedInput] = useState("");
  const [pressure, setPressure] = useState(0);

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setCurrentOrder = useCallback((next: Order) => {
    orderRef.current = next;
    setCurrentOrderState(next);
  }, []);

  const addTurn = useCallback((speaker: DialogueTurn["speaker"], text: string) => {
    setDialogue((turns) => [{ speaker, text, at: Date.now() }, ...turns].slice(0, 8));
  }, []);

  const speakNpc = useCallback(
    async (text: string, role: "cashier" | "announcer" | "system" = "cashier") => {
      const speechTurn = speechTurnRef.current + 1;
      speechTurnRef.current = speechTurn;
      setNpcLine(text);
      addTurn(role === "announcer" ? "系統" : "店員", text);
      setNpcSpeaking(true);
      radioRef.current?.duck(true);
      await voice.speak(text, { voiceRole: role });
      if (speechTurnRef.current === speechTurn) {
        setNpcSpeaking(false);
        radioRef.current?.duck(false);
      }
    },
    [addTurn, voice],
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
      setTechnicalOverlay(false);
      setPressure(0);
      setDialogue([]);
    },
    [setCurrentOrder],
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
    setPhase("briefing");
    setNpcLine(nextObjective.spokenPrompt);
    await voice.speak(nextObjective.spokenPrompt, { voiceRole: "announcer", rate: 0.82 });
    window.setTimeout(() => {
      if (phaseRef.current === "briefing") void enterOrdering();
    }, 900);
  }, [armMic, enterOrdering, resetRoundState, roundIndex, setPhase, voice]);

  const startOpen = useCallback(async () => {
    radioRef.current ??= new ShopRadio();
    radioRef.current.start();
    void armMic();
    resetRoundState("open", undefined);
    setPhase("ordering");
    await speakNpc(openingLine);
  }, [armMic, resetRoundState, setPhase, speakNpc]);

  const finishSuccess = useCallback(async () => {
    const recognized = orderRef.current;
    const total = orderTotal(recognized);
    setPhase("paying");
    await speakNpc(`好，一共 ${total} 元。這邊幫你結帳。`);
    setPhase("serving");
    await speakNpc("你的飲料好了，謝謝。");
    statsRef.current.endedAt = Date.now();
    const nextReceipt = buildReceipt({
      mode,
      objective: objectiveRef.current,
      recognized,
      stats: statsRef.current,
      success: true,
    });
    setReceipt(nextReceipt);
    setReceipts(saveReceipt(nextReceipt));
    setPhase("receipt");
  }, [mode, setPhase, speakNpc]);

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
      if (!order.drink) {
        await speakNpc("不好意思，你想喝哪一杯？");
        return;
      }
      if (missing.includes("杯型")) {
        await speakNpc("要中杯還是大杯？");
        return;
      }
      if (missing.includes("甜度") && missing.includes("冰塊")) {
        await speakNpc("甜度冰塊呢？");
        return;
      }
      if (missing.includes("甜度")) {
        await speakNpc("甜度要怎麼做？");
        return;
      }
      if (missing.includes("冰塊")) {
        await speakNpc("冰塊要怎麼做？");
        return;
      }
      setPhase("confirming");
      await speakNpc(`${describeOrder(order)}，這樣對嗎？`);
    },
    [mode, setPhase, speakNpc],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      setPartial("");
      addTurn("玩家", text);
      const parsed = parseUtterance(text);
      if (parsed.sideIntent?.type === "radio.nextTrack") {
        radioRef.current?.nextTrack();
        await speakNpc(radioChangedLine);
        return;
      }

      statsRef.current.politeHits.push(...parsed.politeHits);

      if (phaseRef.current === "confirming") {
        if (parsed.denies) {
          statsRef.current.corrections += 1;
          setPhase("ordering");
          await speakNpc("沒問題，你要改哪裡？");
          return;
        }
        if (parsed.confirms) {
          const target = objectiveRef.current?.target;
          if (mode === "arcade" && target && !ordersMatch(orderRef.current, target)) {
            await failRound("點單失敗。後面的人已經等到靈魂出竅了。");
            return;
          }
          await finishSuccess();
          return;
        }
      }

      const hadOrder = Boolean(orderRef.current.drink);
      const nextOrder = mergeOrder(orderRef.current, parsed.orderPatch);
      if (hadOrder && Object.keys(parsed.orderPatch).length > 0) {
        statsRef.current.corrections += 1;
      }
      setCurrentOrder(nextOrder);

      if (!Object.keys(parsed.orderPatch).length) {
        statsRef.current.repeats += 1;
        await speakNpc("不好意思，我沒有聽清楚。可以再說一次嗎？");
        return;
      }

      await askNextQuestion(nextOrder);
    },
    [addTurn, askNextQuestion, failRound, finishSuccess, mode, setCurrentOrder, setPhase, speakNpc],
  );

  const startListening = useCallback((source: "manual" | "gaze" = "manual") => {
    if (listening || !["ordering", "confirming"].includes(phaseRef.current)) return;
    if (Date.now() - listenCooldownRef.current < 900) return;
    listenCooldownRef.current = Date.now();
    listenSourceRef.current = source;
    setPartial("");
    setSpeechFeedbackLabel("正在聽");
    setSpeechFeedbackText(listeningFeedback);
    if (npcSpeaking) {
      speechTurnRef.current += 1;
      setNpcSpeaking(false);
      radioRef.current?.duck(false);
    }
    voice.cancelSpeech();
    stopListeningRef.current?.();
    const stop = voice.listenOnce({
      onStart: () => {
        setMicReady(true);
        setListening(true);
      },
      onPartial: (text) => {
        setPartial(text);
        setSpeechFeedbackLabel("正在聽");
        setSpeechFeedbackText(text || listeningFeedback);
      },
      onFinal: (text) => {
        setListening(false);
        setPartial("");
        setSpeechFeedbackLabel("聽到");
        setSpeechFeedbackText(text);
        void handleUtterance(text);
      },
      onError: async () => {
        setListening(false);
        setPartial("");
        if (listenSourceRef.current === "gaze") return;
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
      onEnd: () => setListening(false),
    });
    stopListeningRef.current = stop;
  }, [handleUtterance, listening, npcSpeaking, speakNpc, voice]);

  useEffect(() => {
    if (!autoListen || !micReady) return;
    if (focusTarget !== "cashier") return;
    if (!["ordering", "confirming"].includes(phase)) return;
    if (listening || npcSpeaking) return;
    const timeout = window.setTimeout(() => startListening("gaze"), 1800);
    return () => window.clearTimeout(timeout);
  }, [autoListen, focusTarget, listening, micReady, npcSpeaking, phase, startListening]);

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
    radioRef.current?.duck(npcSpeaking || listening);
  }, [listening, npcSpeaking]);

  useEffect(() => {
    return () => {
      stopListeningRef.current?.();
      radioRef.current?.stop();
    };
  }, []);

  const nextRound = useCallback(() => {
    setRoundIndex((index) => {
      const next = index + 1;
      window.setTimeout(() => void startArcade(next), 0);
      return next;
    });
  }, [startArcade]);

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
  const playerTurn = ["ordering", "confirming"].includes(phase) && !npcSpeaking;

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
        {!liveRound && <div className="status-pill" title={nvidiaVoicePlan.omni.provider}>
          語音：NVIDIA 串流
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
            {listening ? "正在聽..." : npcSpeaking ? "打斷說話" : "輪到你說"}
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
        <section className="receipt-panel">
          <div className="receipt-card">
            <span className="receipt-title">本回合收據</span>
            <strong className="receipt-score">{receipt.score} 分</strong>
            {receipt.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <div className="button-row">
              <button onClick={nextRound}>下一張點單</button>
              <button className="secondary" onClick={() => void startOpen()}>
                自由練習
              </button>
            </div>
          </div>
          <div className="receipt-history">
            <span>收據收藏</span>
            {receipts.slice(0, 5).map((item) => (
              <small key={item.id}>
                {new Date(item.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} · {item.score} 分
              </small>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
