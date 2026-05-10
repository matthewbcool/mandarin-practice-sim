import { nvidiaVoicePlan } from "./nvidiaVoicePlan";
import type { ListenCallbacks, SpeakOptions, VoiceProvider } from "./voiceProvider";

type NvidiaOmniStatus = {
  enabled: boolean;
  model: string;
  endpoint: string;
  reason?: string;
};

type NvidiaOmniTranscription = {
  transcript?: string;
  error?: string;
};

type AudioContextConstructor = typeof AudioContext;

const recordingConfig = {
  minMs: 700,
  maxMs: 6500,
  silenceMs: 900,
  speechThreshold: 0.018,
  silenceThreshold: 0.012,
};

export class NvidiaOmniVoiceProvider implements VoiceProvider {
  name = "NVIDIA Nemotron 3 Nano Omni";
  private activeStop?: () => void;
  private status?: NvidiaOmniStatus;

  constructor(private fallback: VoiceProvider) {}

  isListeningSupported(): boolean {
    return (typeof navigator.mediaDevices?.getUserMedia === "function" && Boolean(getAudioContextConstructor())) || this.fallback.isListeningSupported();
  }

  listenOnce(callbacks: ListenCallbacks): () => void {
    let cancelled = false;
    let delegatedStop: (() => void) | undefined;

    const stop = () => {
      cancelled = true;
      delegatedStop?.();
      this.activeStop?.();
      this.activeStop = undefined;
    };

    void (async () => {
      const status = await this.getStatus();
      if (cancelled) return;

      if (!status.enabled || !navigator.mediaDevices?.getUserMedia || !getAudioContextConstructor()) {
        delegatedStop = this.fallback.listenOnce(callbacks);
        return;
      }

      try {
        callbacks.onStart?.();
        const recording = await recordUtterance(() => cancelled);
        if (cancelled) return;
        callbacks.onPartial?.("辨識中...");

        const response = await fetch(nvidiaVoicePlan.omni.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: recording.audioBase64,
            mimeType: recording.mimeType,
            durationMs: recording.durationMs,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as NvidiaOmniTranscription;
        if (!response.ok || payload.error) throw new Error(payload.error || `NVIDIA Omni request failed (${response.status})`);

        const transcript = payload.transcript?.trim();
        if (!transcript) {
          callbacks.onError?.("不好意思，我沒有聽到內容。");
          return;
        }
        callbacks.onFinal(transcript);
      } catch (error) {
        if (!cancelled) callbacks.onError?.(error instanceof Error ? error.message : "NVIDIA Omni 語音辨識暫時不能使用。");
      } finally {
        if (!cancelled) callbacks.onEnd?.();
      }
    })();

    return stop;
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return this.fallback.speak(text, options);
  }

  cancelSpeech(): void {
    this.fallback.cancelSpeech();
  }

  private async getStatus(): Promise<NvidiaOmniStatus> {
    if (this.status) return this.status;
    try {
      const response = await fetch(nvidiaVoicePlan.omni.statusEndpoint);
      this.status = (await response.json()) as NvidiaOmniStatus;
    } catch {
      this.status = {
        enabled: false,
        model: nvidiaVoicePlan.omni.provider,
        endpoint: nvidiaVoicePlan.omni.endpoint,
        reason: "Local NVIDIA Omni proxy is unavailable.",
      };
    }
    return this.status;
  }
}

async function recordUtterance(cancelled: () => boolean) {
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

  const chunks: Float32Array[] = [];
  const startedAt = performance.now();
  let heardSpeech = false;
  let lastSpeechAt = startedAt;
  let stopped = false;

  return await new Promise<{ audioBase64: string; mimeType: string; durationMs: number }>((resolve, reject) => {
    const cleanup = () => {
      processor.disconnect();
      source.disconnect();
      silentOutput.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    };

    const finish = () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      try {
        const wav = encodeWav(chunks, audioContext.sampleRate);
        resolve({
          audioBase64: arrayBufferToBase64(wav.buffer),
          mimeType: "audio/wav",
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        reject(error);
      }
    };

    processor.onaudioprocess = (event) => {
      if (cancelled()) {
        cleanup();
        reject(new Error("Recording cancelled."));
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));

      const now = performance.now();
      const rms = rootMeanSquare(input);
      if (rms > recordingConfig.speechThreshold) {
        heardSpeech = true;
        lastSpeechAt = now;
      } else if (!heardSpeech && rms > recordingConfig.silenceThreshold) {
        lastSpeechAt = now;
      }

      const elapsed = now - startedAt;
      const silentFor = now - lastSpeechAt;
      if (elapsed >= recordingConfig.maxMs || (heardSpeech && elapsed >= recordingConfig.minMs && silentFor >= recordingConfig.silenceMs)) {
        finish();
      }
    };

    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    window.setTimeout(finish, recordingConfig.maxMs + 250);
  });
}

function rootMeanSquare(samples: Float32Array) {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index];
  return Math.sqrt(total / samples.length);
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  chunks.forEach((chunk) => {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  });

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function arrayBufferToBase64(buffer: ArrayBufferLike) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const win = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return win.AudioContext ?? win.webkitAudioContext;
}
