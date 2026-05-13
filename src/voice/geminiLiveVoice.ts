import type { LiveServerMessage, Session } from "@google/genai";
import { geminiLivePlan } from "./geminiLivePlan";
import type { ListenCallbacks, SpeakOptions, VoiceProvider } from "./voiceProvider";

type AudioContextConstructor = typeof AudioContext;
type GeminiSdk = typeof import("@google/genai");

type LiveTokenResponse = {
  token: string;
  model: string;
};

type TtsResponse = {
  audioBase64: string;
  mimeType: string;
  cached?: boolean;
};

type LiveAudioChunk = {
  data: string;
  mimeType: string;
};

const listenConfig = {
  openTimeoutMs: 4500,
  minListenMs: 350,
  maxListenMs: 8000,
  initialSilenceMs: 4200,
  silenceMs: 520,
  speechThreshold: 0.01,
  silenceThreshold: 0.006,
  finalWaitMs: 700,
  retryAfterFailureMs: 15000,
  maxQueuedAudioChunks: 520,
};

const ttsConfig = {
  liveOpenTimeoutMs: 4500,
  liveFirstAudioTimeoutMs: 4500,
  synthesisTimeoutMs: 16000,
  retryAfterFailureMs: 15000,
};

const taiwanMandarinInstruction = [
  "你在台灣手搖飲店的點餐情境中工作。",
  "所有輸入與輸出都以繁體中文處理，使用自然的台灣華語。",
  "飲料詞彙包含珍珠奶茶、烏龍奶茶、鐵觀音奶茶、布丁、椰果、半糖、微糖、無糖、少冰、微冰、去冰、中杯、大杯。",
  "不要改寫成簡體中文，也不要使用中國大陸用語。",
].join("\n");

const asrInstruction = [
  taiwanMandarinInstruction,
  "你正在接收玩家用台灣華語點手搖飲的語音。",
  "你的任務只有語音轉文字：輸出玩家剛剛說的繁體中文內容。",
  "可以整理口吃、停頓或輕微改口，但不要憑空新增飲料、甜度、冰塊、杯型或加料。",
  "只能輸出台灣華語繁體中文，或玩家明確說出的英文飲料詞。不要輸出其他語言或其他文字系統。",
  "如果音訊不清楚或像背景噪音，輸出空字串。",
  "不要扮演店員，不要回答玩家問題，不要教學，不要加入說明。",
].join("\n");

const speakInstruction = [
  taiwanMandarinInstruction,
  "你是親切的台灣手搖飲店店員，請用自然台灣華語回應。",
  "可以把提供的台詞說得更口語、更像真人店員，也可以加入非常短的承接語。",
  "不要改變訂單重點，不要加入拼音或英文。",
].join("\n");

export class GeminiLiveVoiceProvider implements VoiceProvider {
  name = "Gemini Live + Gemini TTS";
  private activeStop?: () => void;
  private speechCancel?: () => void;
  private listenUnavailableUntil = 0;
  private ttsUnavailableUntil = 0;
  private ttsCache = new Map<string, Promise<TtsResponse>>();

  constructor(private fallback: VoiceProvider) {}

  isListeningSupported(): boolean {
    return supportsLiveAudio() || this.fallback.isListeningSupported();
  }

  listenOnce(callbacks: ListenCallbacks): () => void {
    let cancelled = false;
    let fallbackStop: (() => void) | undefined;
    let session: Session | undefined;

    const stop = () => {
      cancelled = true;
      this.activeStop?.();
      this.activeStop = undefined;
      fallbackStop?.();
      session?.close();
    };

    void (async () => {
      if (!supportsLiveAudio() || Date.now() < this.listenUnavailableUntil) {
        fallbackStop = this.fallback.listenOnce(callbacks);
        return;
      }

      let settled = false;
      let stoppedSending = false;
      let finalTimer: number | undefined;
      let finalText = "";
      let partialText = "";
      let modelText = "";

      const cleanup = () => {
        if (finalTimer) window.clearTimeout(finalTimer);
        this.activeStop?.();
        this.activeStop = undefined;
        session?.close();
      };

      const finish = (text?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        const transcript = sanitizeTranscript(text || finalText || partialText || modelText);
        if (transcript) callbacks.onFinal(transcript);
        else callbacks.onError?.("不好意思，我沒有聽到清楚的中文。");
        callbacks.onEnd?.();
      };

      const fail = (message: string, error?: unknown) => {
        warnGemini("listen failed", message, error);
        if (settled) return;
        settled = true;
        cleanup();
        this.markListenUnavailable();
        callbacks.onError?.(message);
        callbacks.onEnd?.();
      };

      const armFinalTimer = () => {
        if (finalTimer) window.clearTimeout(finalTimer);
        finalTimer = window.setTimeout(() => finish(), listenConfig.finalWaitMs);
      };

      try {
        const queuedAudio: LiveAudioChunk[] = [];
        let captureEnded = false;

        const sendAudio = (audio: LiveAudioChunk) => {
          if (session) {
            session.sendRealtimeInput({ audio });
            return;
          }
          if (queuedAudio.length < listenConfig.maxQueuedAudioChunks) queuedAudio.push(audio);
        };

        this.activeStop = await streamMicrophoneToGemini(
          sendAudio,
          () => cancelled,
          () => {
            stoppedSending = true;
            captureEnded = true;
            if (session) {
              session.sendRealtimeInput({ audioStreamEnd: true });
              armFinalTimer();
            }
          },
          callbacks.onVoiceStart,
        );
        callbacks.onStart?.();

        const token = await fetchGeminiLiveToken("listen");
        if (cancelled) return;

        const gemini = await loadGeminiSdk();
        const ai = makeGeminiClient(gemini, token.token);
        const setupTimer = window.setTimeout(() => {
          if (!settled && !session) this.markListenUnavailable();
        }, listenConfig.openTimeoutMs);

        session = await ai.live.connect({
          model: token.model,
          config: {
            responseModalities: [gemini.Modality.TEXT],
            inputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                prefixPaddingMs: 220,
                silenceDurationMs: 520,
              },
            },
            systemInstruction: asrInstruction,
            temperature: 0,
            maxOutputTokens: 48,
          },
          callbacks: {
            onopen: () => debugGemini("listen socket open"),
            onmessage: (message) => {
              const serverContent = message.serverContent;
              if (serverContent?.interrupted) {
                debugGemini("listen interrupted");
                return;
              }

              const transcription = serverContent?.inputTranscription;
              if (transcription?.text) {
                partialText = mergeTranscript(partialText, transcription.text);
                const safePartial = sanitizeTranscript(partialText);
                if (safePartial) callbacks.onPartial?.(safePartial);
                if (transcription.finished) {
                  finalText = partialText;
                  finish(finalText);
                  return;
                }
              }

              const responseText = message.text;
              if (responseText) modelText = mergeTranscript(modelText, responseText);
              if (stoppedSending && serverContent?.turnComplete) finish();
            },
            onerror: (event) => fail("Gemini Live 收音連線失敗。", event),
            onclose: () => {
              if (!settled && !stoppedSending) fail("Gemini Live 收音已中斷。");
            },
          },
        });
        window.clearTimeout(setupTimer);

        if (cancelled) {
          session.close();
          return;
        }

        queuedAudio.splice(0).forEach((audio) => session?.sendRealtimeInput({ audio }));
        if (captureEnded) {
          session.sendRealtimeInput({ audioStreamEnd: true });
          armFinalTimer();
        }
      } catch (error) {
        warnGemini("Gemini Live unavailable; falling back to browser speech recognition.", error);
        this.markListenUnavailable();
        this.activeStop?.();
        this.activeStop = undefined;
        if (!cancelled) fallbackStop = this.fallback.listenOnce(callbacks);
      }
    })();

    return stop;
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!supportsTtsPlayback() || Date.now() < this.ttsUnavailableUntil) {
      await this.fallback.speak(text, options);
      return;
    }

    try {
      await this.speakWithGemini(text, options);
    } catch (error) {
      warnGemini("Gemini TTS unavailable; falling back to browser speech synthesis.", error);
      this.markTtsUnavailable(error);
      await this.fallback.speak(text, options);
    }
  }

  cancelSpeech(): void {
    this.speechCancel?.();
    this.speechCancel = undefined;
    this.fallback.cancelSpeech();
  }

  preload(lines: Array<string | { text: string; voiceRole?: SpeakOptions["voiceRole"] }>): void {
    if (!supportsTtsPlayback() || Date.now() < this.ttsUnavailableUntil) return;
    lines.forEach((line, index) => {
      const text = typeof line === "string" ? line : line.text;
      const voiceRole = typeof line === "string" ? undefined : line.voiceRole;
      window.setTimeout(() => {
        if (Date.now() < this.ttsUnavailableUntil) return;
        void this.getTts(text, voiceRole).catch((error) => {
          this.markTtsUnavailable(error);
          debugGemini("tts preload skipped", error);
        });
      }, index * 180);
    });
  }

  private async speakWithGemini(text: string, options: SpeakOptions) {
    await this.speakWithGeminiLive(text, options).catch(async (error) => {
      debugGemini("Live speech failed; trying Gemini TTS fallback.", error);
      const tts = await this.getTts(text, options.voiceRole);
      debugGemini("tts audio ready", { cached: Boolean(tts.cached), mimeType: tts.mimeType, chars: tts.audioBase64.length });
      await this.playPcmBase64(tts.audioBase64, parsePcmRate(tts.mimeType), options.volume ?? 1);
    });
  }

  private async speakWithGeminiLive(text: string, options: SpeakOptions) {
    const token = await fetchGeminiLiveToken("speak");
    const gemini = await loadGeminiSdk();
    const ai = makeGeminiClient(gemini, token.token);
    const player = new PcmStreamPlayer(geminiLivePlan.outputSampleRateHz, options.volume ?? 1);
    await player.start();

    return new Promise<void>(async (resolve, reject) => {
      let session: Session | undefined;
      let settled = false;
      let audioChunks = 0;
      const firstAudioTimer = window.setTimeout(() => fail(new Error("Gemini Live speech did not return audio quickly.")), ttsConfig.liveFirstAudioTimeoutMs);
      const totalTimer = window.setTimeout(() => fail(new Error("Gemini Live speech timed out.")), ttsConfig.synthesisTimeoutMs);

      const cleanup = () => {
        window.clearTimeout(firstAudioTimer);
        window.clearTimeout(totalTimer);
        this.speechCancel = undefined;
        session?.close();
      };

      const finish = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          await player.waitForEnd();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        player.cancel();
        resolve();
      };

      const fail = (error: Error) => {
        if (settled) return;
        if (audioChunks > 0) {
          debugGemini("speech stream ended after audio; suppressing fallback", error);
          void finish();
          return;
        }
        settled = true;
        cleanup();
        player.cancel();
        reject(error);
      };

      this.speechCancel = cancel;

      try {
        session = await ai.live.connect({
          model: token.model,
          config: {
            responseModalities: [gemini.Modality.AUDIO],
            outputAudioTranscription: {},
            thinkingConfig: { thinkingLevel: gemini.ThinkingLevel.MINIMAL },
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: pickVoice(options.voiceRole) },
              },
            },
            systemInstruction: speakInstruction,
          },
          callbacks: {
            onopen: () => debugGemini("speech socket open"),
            onmessage: (message) => {
              if (message.serverContent?.interrupted) {
                player.cancel();
                return;
              }

              const chunks = extractAudioChunks(message);
              chunks.forEach((chunk) => {
                audioChunks += 1;
                window.clearTimeout(firstAudioTimer);
                player.enqueuePcm16(chunk);
              });

              if ((message.serverContent?.turnComplete || message.serverContent?.generationComplete) && audioChunks > 0) {
                void finish();
              }
            },
            onerror: (event) => fail(new Error(event.message || "Gemini Live speech connection failed.")),
            onclose: () => {
              if (!settled && audioChunks === 0) fail(new Error("Gemini Live speech connection closed."));
            },
          },
        });

        session.sendRealtimeInput({ text: `請照念：${text}` });
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Gemini Live speech could not start."));
      }
    });
  }

  private async playPcmBase64(audioBase64: string, sampleRateHz: number, volume: number) {
    const player = new PcmStreamPlayer(sampleRateHz, volume);
    await player.start();
    const cancel = () => player.cancel();
    this.speechCancel = cancel;
    try {
      player.enqueuePcm16(audioBase64);
      await player.waitForEnd();
    } finally {
      if (this.speechCancel === cancel) this.speechCancel = undefined;
    }
  }

  private markListenUnavailable() {
    this.listenUnavailableUntil = Date.now() + listenConfig.retryAfterFailureMs;
  }

  private markTtsUnavailable(error?: unknown) {
    this.ttsUnavailableUntil = Date.now() + ttsCooldownMs(error);
  }

  private getTts(text: string, voiceRole?: SpeakOptions["voiceRole"]) {
    const key = `${voiceRole ?? "cashier"}:${text}`;
    let request = this.ttsCache.get(key);
    if (!request) {
      request = fetchGeminiTts(text, voiceRole).catch((error) => {
        this.ttsCache.delete(key);
        throw error;
      });
      this.ttsCache.set(key, request);
    }
    return request;
  }
}

function ttsCooldownMs(error?: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(text)) return 5 * 60_000;
  return ttsConfig.retryAfterFailureMs;
}

async function streamMicrophoneToGemini(
  sendAudio: (audio: LiveAudioChunk) => void,
  cancelled: () => boolean,
  onFinishedSending: () => void,
  onVoiceStart?: () => void,
) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioContextImpl = getAudioContextConstructor();
  if (!AudioContextImpl) throw new Error("AudioContext is unavailable.");

  const audioContext = new AudioContextImpl();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(1024, 1, 1);
  const silentOutput = audioContext.createGain();
  silentOutput.gain.value = 0;

  const startedAt = performance.now();
  let heardSpeech = false;
  let lastSpeechAt = startedAt;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    processor.disconnect();
    source.disconnect();
    silentOutput.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    if (cancelled()) {
      stop();
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const now = performance.now();
    const rms = rootMeanSquare(input);
    if (rms > listenConfig.speechThreshold) {
      if (!heardSpeech) onVoiceStart?.();
      heardSpeech = true;
      lastSpeechAt = now;
    } else if (!heardSpeech && rms > listenConfig.silenceThreshold) {
      lastSpeechAt = now;
    }

    sendAudio({
      data: floatToPcm16Base64(input, audioContext.sampleRate, geminiLivePlan.inputSampleRateHz),
      mimeType: `audio/pcm;rate=${geminiLivePlan.inputSampleRateHz}`,
    });

    const elapsed = now - startedAt;
    const silentFor = now - lastSpeechAt;
    if (
      elapsed >= listenConfig.maxListenMs ||
      (!heardSpeech && elapsed >= listenConfig.initialSilenceMs) ||
      (heardSpeech && elapsed >= listenConfig.minListenMs && silentFor >= listenConfig.silenceMs)
    ) {
      stop();
      onFinishedSending();
    }
  };

  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(audioContext.destination);
  window.setTimeout(() => {
    if (!stopped) {
      stop();
      onFinishedSending();
    }
  }, listenConfig.maxListenMs + 250);

  return stop;
}

class PcmStreamPlayer {
  private context?: AudioContext;
  private gain?: GainNode;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private cancelled = false;

  constructor(private sampleRateHz: number, private volume: number) {}

  async start() {
    this.context = new AudioContext({ sampleRate: this.sampleRateHz });
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    await this.context.resume();
    this.nextStart = this.context.currentTime + 0.03;
  }

  enqueuePcm16(base64Audio: string) {
    if (this.cancelled || !this.context || !this.gain) return;
    const bytes = base64ToBytes(base64Audio);
    if (bytes.length < 2) return;

    const frameCount = Math.floor(bytes.length / 2);
    const buffer = this.context.createBuffer(1, frameCount, this.sampleRateHz);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 0x8000;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => this.sources.delete(source);
    this.sources.add(source);
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
  }

  async waitForEnd() {
    if (!this.context) return;
    const delayMs = Math.max(0, (this.nextStart - this.context.currentTime) * 1000) + 80;
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    await this.close();
  }

  cancel() {
    this.cancelled = true;
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped by the time a user interrupts.
      }
    });
    this.sources.clear();
    void this.close();
  }

  private async close() {
    if (!this.context || this.context.state === "closed") return;
    await this.context.close();
  }
}

async function fetchGeminiLiveToken(purpose: "listen" | "speak") {
  const response = await fetch(geminiLivePlan.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose }),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<LiveTokenResponse> & { error?: string };
  if (!response.ok || !payload.token || !payload.model) {
    throw new Error(payload.error || "Gemini Live token endpoint is unavailable.");
  }
  return { token: payload.token, model: payload.model };
}

async function fetchGeminiTts(text: string, voiceRole?: SpeakOptions["voiceRole"]) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ttsConfig.synthesisTimeoutMs);
  try {
    const response = await fetch(geminiLivePlan.ttsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceRole: voiceRole ?? "cashier" }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<TtsResponse> & { error?: string };
    if (!response.ok || !payload.audioBase64) {
      throw new Error(payload.error || "Gemini TTS endpoint is unavailable.");
    }
    return {
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType ?? "audio/l16; rate=24000; channels=1",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

let geminiSdkPromise: Promise<GeminiSdk> | undefined;

function loadGeminiSdk() {
  geminiSdkPromise ??= import("@google/genai");
  return geminiSdkPromise;
}

function makeGeminiClient(gemini: GeminiSdk, token: string) {
  return new gemini.GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: "v1alpha" },
  });
}

function extractAudioChunks(message: LiveServerMessage) {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  return parts.flatMap((part) => {
    const data = part.inlineData?.data;
    return typeof data === "string" ? [data] : [];
  });
}

function pickVoice(role?: SpeakOptions["voiceRole"]) {
  if (role === "announcer") return geminiLivePlan.voices.announcer;
  if (role === "system") return geminiLivePlan.voices.system;
  return geminiLivePlan.voices.cashier;
}

function parsePcmRate(mimeType: string) {
  const match = /rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : geminiLivePlan.outputSampleRateHz;
}

function mergeTranscript(previous: string, next: string) {
  const clean = next.trim();
  if (!clean) return previous;
  if (!previous) return clean;
  if (clean.startsWith(previous)) return clean;
  if (previous.endsWith(clean)) return previous;
  return `${previous}${clean}`;
}

function sanitizeTranscript(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (!looksLikeMandarinOrEnglish(clean)) {
    debugGemini("discarding unexpected transcript language", clean);
    return "";
  }
  return clean;
}

function looksLikeMandarinOrEnglish(text: string) {
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return false;
  const allowedLetters = letters.filter((char) => /[\p{Script=Han}A-Za-z]/u.test(char));
  return allowedLetters.length / letters.length >= 0.88;
}

function supportsLiveAudio() {
  return Boolean(typeof navigator.mediaDevices?.getUserMedia === "function" && getAudioContextConstructor() && "WebSocket" in window);
}

function supportsTtsPlayback() {
  return Boolean(getAudioContextConstructor());
}

function floatToPcm16Base64(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  const output = downsample(input, inputSampleRate, outputSampleRate);
  const bytes = new Uint8Array(output.length * 2);
  const view = new DataView(bytes.buffer);
  output.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return bytesToBase64(bytes);
}

function downsample(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) return input;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(input.length - 1, lower + 1);
    const weight = sourceIndex - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function rootMeanSquare(samples: Float32Array) {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index];
  return Math.sqrt(total / samples.length);
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const win = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return win.AudioContext ?? win.webkitAudioContext;
}

function debugGemini(...args: unknown[]) {
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_GEMINI_LIVE === "1") {
    console.info("[Gemini Live]", ...args);
  }
}

function warnGemini(...args: unknown[]) {
  console.warn("[Gemini Live]", ...args);
}
