import { nvidiaVoicePlan } from "./nvidiaVoicePlan";
import { NvidiaRealtimeTtsClient } from "./nvidiaRealtimeTts";
import type { ListenCallbacks, SpeakOptions, VoiceProvider } from "./voiceProvider";

type AudioContextConstructor = typeof AudioContext;

type RealtimeTranscriptEvent = {
  type?: string;
  transcript?: unknown;
  text?: unknown;
  delta?: unknown;
  result?: unknown;
  item?: unknown;
  response?: unknown;
  is_final?: boolean;
  is_last_result?: boolean;
  error?: { message?: string } | string;
  message?: string;
};

const streamingConfig = {
  openTimeoutMs: 3000,
  minListenMs: 650,
  maxListenMs: 10000,
  silenceMs: 850,
  speechThreshold: 0.018,
  silenceThreshold: 0.012,
  finalWaitMs: 1500,
};

export class NvidiaStreamingSpeechVoiceProvider implements VoiceProvider {
  name = "NVIDIA Streaming ASR + Magpie TTS";
  private activeStop?: () => void;
  private tts = new NvidiaRealtimeTtsClient();

  constructor(private fallback: VoiceProvider) {}

  isListeningSupported(): boolean {
    return (typeof navigator.mediaDevices?.getUserMedia === "function" && Boolean(getAudioContextConstructor()) && "WebSocket" in window) ||
      this.fallback.isListeningSupported();
  }

  listenOnce(callbacks: ListenCallbacks): () => void {
    let cancelled = false;
    let fallbackStop: (() => void) | undefined;

    const stop = () => {
      cancelled = true;
      this.activeStop?.();
      this.activeStop = undefined;
      fallbackStop?.();
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !getAudioContextConstructor() || !("WebSocket" in window)) {
        fallbackStop = this.fallback.listenOnce(callbacks);
        return;
      }

      let socket: WebSocket | undefined;
      try {
        socket = await openRealtimeSocket(nvidiaVoicePlan.asr.localRealtimeEndpoint, streamingConfig.openTimeoutMs);
      } catch (error) {
        warnAsr("websocket unavailable; falling back to browser speech recognition.", error);
        if (!cancelled) fallbackStop = this.fallback.listenOnce(callbacks);
        return;
      }

      if (cancelled) {
        socket.close();
        return;
      }

      debugAsr("connected", nvidiaVoicePlan.asr.localRealtimeEndpoint);

      let finalText = "";
      let partialText = "";
      let stoppedSending = false;
      let settled = false;
      let finalTimer: number | undefined;

      const finish = (text?: string) => {
        if (settled) return;
        settled = true;
        if (finalTimer) window.clearTimeout(finalTimer);
        cleanup();
        const transcript = (text || finalText || partialText).trim();
        if (transcript) callbacks.onFinal(transcript);
        else callbacks.onError?.("不好意思，我沒有聽到內容。");
        callbacks.onEnd?.();
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        if (finalTimer) window.clearTimeout(finalTimer);
        cleanup();
        callbacks.onError?.(message);
        callbacks.onEnd?.();
      };

      const cleanup = () => {
        this.activeStop?.();
        this.activeStop = undefined;
        if (socket && socket.readyState === WebSocket.OPEN) socket.close();
      };

      const armFinalTimer = () => {
        if (finalTimer) window.clearTimeout(finalTimer);
        finalTimer = window.setTimeout(() => finish(), streamingConfig.finalWaitMs);
      };

      socket.onmessage = (event) => {
        const message = parseRealtimeMessage(event.data);
        if (!message) return;
        debugAsr("message", message.type, message);
        if (message.error || message.type?.includes("error")) {
          const errorText = typeof message.error === "string" ? message.error : message.error?.message;
          fail(errorText || message.message || "NVIDIA streaming ASR failed.");
          return;
        }

        const text = extractTranscriptText(message).trim();
        if (!text) return;
        if (message.type?.includes("delta") || message.delta) {
          partialText = `${partialText}${text}`.trim();
        } else {
          partialText = text;
          if (message.is_final || message.type?.includes("completed")) finalText = text;
        }
        callbacks.onPartial?.(partialText);

        if (message.is_last_result || (stoppedSending && (message.is_final || message.type?.includes("completed")))) {
          finish(text);
        }
      };

      socket.onerror = (error) => {
        warnAsr("connection failed after open.", error);
        fail("NVIDIA streaming ASR connection failed.");
      };
      socket.onclose = (event) => {
        debugAsr("closed", event.code, event.reason || "(no reason)");
        if (!settled && !stoppedSending) fail("NVIDIA streaming ASR connection closed.");
      };

      try {
        sendJson(socket, {
          event_id: makeEventId(),
          type: "transcription_session.update",
          session: {
            modalities: ["text"],
            input_audio_format: "pcm16",
            input_audio_transcription: {
              language: nvidiaVoicePlan.asr.languageCode,
              model: nvidiaVoicePlan.asr.provider,
              prompt: "台灣手搖飲點餐，包含珍珠奶茶、烏龍奶茶、鐵觀音奶茶、布丁、椰果、半糖、微糖、無糖、少冰、微冰、去冰、中杯、大杯。玩家也可能請店員換音樂、換一首、下一首。",
            },
            input_audio_params: {
              sample_rate_hz: nvidiaVoicePlan.asr.sampleRateHz,
              num_channels: 1,
            },
            recognition_config: {
              max_alternatives: 1,
              enable_automatic_punctuation: true,
              enable_word_time_offsets: false,
              enable_profanity_filter: false,
              enable_verbatim_transcripts: false,
            },
            speaker_diarization: {
              enable_speaker_diarization: false,
              max_speaker_count: 1,
            },
            word_boosting: {
              enable_word_boosting: true,
              word_boosting_list: [
                "珍珠奶茶",
                "烏龍奶茶",
                "鐵觀音奶茶",
                "布丁奶茶",
                "冬瓜檸檬",
                "百香綠茶",
                "柳橙綠茶",
                "珍珠",
                "椰果",
                "布丁",
                "半糖",
                "微糖",
                "無糖",
                "少冰",
                "微冰",
                "去冰",
                "換音樂",
                "換一首",
                "下一首",
                "幫我換一首",
              ],
            },
          },
        });
        this.activeStop = await streamMicrophoneToAsr(socket, () => cancelled, () => {
          stoppedSending = true;
          sendJson(socket, { type: "input_audio_buffer.commit" });
          sendJson(socket, { type: "input_audio_buffer.done" });
          armFinalTimer();
        });
        callbacks.onStart?.();
      } catch (error) {
        fail(error instanceof Error ? error.message : "NVIDIA streaming ASR could not start.");
      }
    })();

    return stop;
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    try {
      await this.tts.speak(text, options);
    } catch (error) {
      warnAsr("Magpie TTS unavailable; falling back to browser speech synthesis.", error);
      await this.fallback.speak(text, options);
    }
  }

  cancelSpeech(): void {
    this.tts.cancel();
    this.fallback.cancelSpeech();
  }
}

async function streamMicrophoneToAsr(socket: WebSocket, cancelled: () => boolean, onFinishedSending: () => void) {
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
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
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
    if (rms > streamingConfig.speechThreshold) {
      heardSpeech = true;
      lastSpeechAt = now;
    } else if (!heardSpeech && rms > streamingConfig.silenceThreshold) {
      lastSpeechAt = now;
    }

    if (socket.readyState === WebSocket.OPEN) {
      sendJson(socket, {
        type: "input_audio_buffer.append",
        audio: floatToPcm16Base64(input, audioContext.sampleRate, nvidiaVoicePlan.asr.sampleRateHz),
      });
    }

    const elapsed = now - startedAt;
    const silentFor = now - lastSpeechAt;
    if (elapsed >= streamingConfig.maxListenMs || (heardSpeech && elapsed >= streamingConfig.minListenMs && silentFor >= streamingConfig.silenceMs)) {
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
  }, streamingConfig.maxListenMs + 250);

  return stop;
}

function openRealtimeSocket(url: string, timeoutMs: number) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("NVIDIA streaming ASR endpoint is unavailable."));
    }, timeoutMs);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("NVIDIA streaming ASR endpoint is unavailable."));
    };
  });
}

function sendJson(socket: WebSocket, value: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function makeEventId() {
  return `event_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function parseRealtimeMessage(data: unknown): RealtimeTranscriptEvent | undefined {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data) as RealtimeTranscriptEvent;
  } catch {
    return undefined;
  }
}

function extractTranscriptText(message: RealtimeTranscriptEvent) {
  return firstString(
    message.delta,
    message.transcript,
    message.text,
    message.result,
    message.item,
    message.response,
  ) ?? "";
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = stringFromUnknown(value);
    if (found) return found;
  }
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return firstString(...value);

  const record = value as Record<string, unknown>;
  return firstString(
    record.delta,
    record.transcript,
    record.text,
    record.output_text,
    record.content,
    record.alternatives,
    record.results,
  );
}

function debugAsr(...args: unknown[]) {
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_NVIDIA_SPEECH === "1") {
    console.info("[NVIDIA ASR]", ...args);
  }
}

function warnAsr(...args: unknown[]) {
  console.warn("[NVIDIA ASR]", ...args);
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

function rootMeanSquare(samples: Float32Array) {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index];
  return Math.sqrt(total / samples.length);
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const win = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return win.AudioContext ?? win.webkitAudioContext;
}
