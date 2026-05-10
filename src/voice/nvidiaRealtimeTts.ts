import { nvidiaVoicePlan } from "./nvidiaVoicePlan";
import type { SpeakOptions } from "./voiceProvider";

type TtsMessage = {
  type?: string;
  audio?: unknown;
  data?: unknown;
  delta?: unknown;
  item?: unknown;
  response?: unknown;
  error?: { message?: string } | string;
  message?: string;
};

const ttsConfig = {
  openTimeoutMs: 2500,
  synthesisTimeoutMs: 14000,
  retryAfterFailureMs: 30000,
};

export class NvidiaRealtimeTtsClient {
  private stopActive?: () => void;
  private unavailableUntil = 0;

  cancel(): void {
    this.stopActive?.();
    this.stopActive = undefined;
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (Date.now() < this.unavailableUntil) throw new Error("NVIDIA Magpie TTS is cooling down after a failed connection.");

    const socket = await openRealtimeSocket(nvidiaVoicePlan.tts.localRealtimeEndpoint, ttsConfig.openTimeoutMs).catch((error) => {
      this.markUnavailable();
      throw error;
    });
    const player = new PcmStreamPlayer(nvidiaVoicePlan.tts.sampleRateHz, options.volume ?? 1);
    await player.start();

    return new Promise((resolve, reject) => {
      let settled = false;
      let audioChunkCount = 0;
      const timeout = window.setTimeout(() => fail(new Error("NVIDIA Magpie TTS timed out.")), ttsConfig.synthesisTimeoutMs);

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.stopActive = undefined;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
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
        settled = true;
        cleanup();
        player.cancel();
        this.markUnavailable();
        reject(error);
      };

      this.stopActive = cancel;
      socket.onerror = () => fail(new Error("NVIDIA Magpie TTS connection failed."));
      socket.onclose = (event) => {
        debugTts("closed", event.code, event.reason || "(no reason)");
        if (!settled && audioChunkCount === 0) fail(new Error("NVIDIA Magpie TTS connection closed."));
      };
      socket.onmessage = (event) => {
        const message = parseTtsMessage(event.data);
        if (!message) return;
        debugTts("message", message.type, message);
        if (message.error || message.type?.includes("error")) {
          const text = typeof message.error === "string" ? message.error : message.error?.message;
          fail(new Error(text || message.message || "NVIDIA Magpie TTS failed."));
          return;
        }

        const audio = extractAudioBase64(message);
        if (audio) {
          audioChunkCount += 1;
          player.enqueuePcm16(audio);
        }

        if (message.type?.includes("completed") || message.type?.includes("done") || message.type?.includes("finished")) {
          void finish();
        }
      };

      sendJson(socket, {
        type: "synthesize_session.update",
        session: {
          voice: pickVoice(options.voiceRole),
          language_code: nvidiaVoicePlan.tts.languageCode,
          output_audio_format: "pcm16",
          output_audio_params: {
            sample_rate_hz: nvidiaVoicePlan.tts.sampleRateHz,
            num_channels: 1,
          },
        },
      });
      sendJson(socket, {
        type: "input_text.append",
        text,
      });
      sendJson(socket, {
        type: "input_text.commit",
      });
      sendJson(socket, {
        type: "input_text.done",
      });
    });
  }

  private markUnavailable() {
    this.unavailableUntil = Date.now() + ttsConfig.retryAfterFailureMs;
  }
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
    this.sources.forEach((source) => source.stop());
    this.sources.clear();
    void this.close();
  }

  private async close() {
    if (!this.context || this.context.state === "closed") return;
    await this.context.close();
  }
}

function pickVoice(role?: SpeakOptions["voiceRole"]) {
  if (role && role in nvidiaVoicePlan.tts.roleVoices) return nvidiaVoicePlan.tts.roleVoices[role];
  return nvidiaVoicePlan.tts.preferredVoice;
}

function openRealtimeSocket(url: string, timeoutMs: number) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("NVIDIA Magpie TTS endpoint is unavailable."));
    }, timeoutMs);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      debugTts("connected", url);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("NVIDIA Magpie TTS endpoint is unavailable."));
    };
  });
}

function sendJson(socket: WebSocket, value: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function parseTtsMessage(data: unknown): TtsMessage | undefined {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data) as TtsMessage;
  } catch {
    return undefined;
  }
}

function extractAudioBase64(message: TtsMessage) {
  return firstString(message.audio, message.data, message.delta, message.item, message.response);
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
    record.audio,
    record.data,
    record.delta,
    record.audio_data,
    record.audioData,
    record.content,
    record.output,
  );
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function debugTts(...args: unknown[]) {
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_NVIDIA_SPEECH === "1") {
    console.info("[NVIDIA TTS]", ...args);
  }
}
