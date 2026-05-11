export interface ListenCallbacks {
  onPartial?: (text: string) => void;
  onVoiceStart?: () => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceRole?: "cashier" | "announcer" | "system";
}

export interface VoiceProvider {
  name: string;
  isListeningSupported(): boolean;
  listenOnce(callbacks: ListenCallbacks): () => void;
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancelSpeech(): void;
}
