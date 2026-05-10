import type { ListenCallbacks, SpeakOptions, VoiceProvider } from "./voiceProvider";

type RecognitionEvent = Event & {
  results: SpeechRecognitionResultListLike;
  resultIndex: number;
};

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: {
    isFinal: boolean;
    [index: number]: {
      transcript: string;
    };
  };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export class BrowserMandarinVoiceProvider implements VoiceProvider {
  name = "瀏覽器語音";
  private recognition?: SpeechRecognitionLike;
  private activeUtterance?: SpeechSynthesisUtterance;

  isListeningSupported(): boolean {
    return Boolean(getRecognitionConstructor());
  }

  listenOnce(callbacks: ListenCallbacks): () => void {
    const Constructor = getRecognitionConstructor();
    if (!Constructor) {
      callbacks.onError?.("這個瀏覽器暫時不能聽你說話。");
      callbacks.onEnd?.();
      return () => undefined;
    }

    this.recognition?.abort();
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = "zh-TW";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => callbacks.onStart?.();
    recognition.onend = () => callbacks.onEnd?.();
    recognition.onerror = (event) => {
      callbacks.onError?.(event.error || event.message || "剛剛沒有聽清楚。");
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) callbacks.onPartial?.(interim.trim());
      if (finalText.trim()) callbacks.onFinal(finalText.trim());
    };

    try {
      recognition.start();
    } catch {
      callbacks.onError?.("麥克風還沒有準備好。");
      callbacks.onEnd?.();
    }

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    };
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    this.cancelSpeech();

    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-TW";
      utterance.rate = options.rate ?? (options.voiceRole === "announcer" ? 0.82 : 0.96);
      utterance.pitch = options.pitch ?? (options.voiceRole === "announcer" ? 1.02 : 1);
      utterance.volume = options.volume ?? 1;
      utterance.voice = pickTaiwanVoice(options.voiceRole);
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = window.setTimeout(done, Math.max(900, text.length * 150));
      utterance.onend = () => {
        window.clearTimeout(timeout);
        done();
      };
      utterance.onerror = () => {
        window.clearTimeout(timeout);
        done();
      };
      this.activeUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  cancelSpeech(): void {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.activeUtterance = undefined;
  }
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const win = window as typeof window & {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

function pickTaiwanVoice(role?: SpeakOptions["voiceRole"]): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const zhTw = voices.filter((voice) => voice.lang.toLowerCase().includes("zh-tw"));
  const zh = voices.filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
  const pool = zhTw.length ? zhTw : zh;
  if (!pool.length) return null;
  if (role === "announcer") return pool.find((voice) => /female|mei|ting|aria/i.test(voice.name)) ?? pool[0];
  return pool.find((voice) => /male|han|yuna|mei|ting/i.test(voice.name)) ?? pool[0];
}
