export const nvidiaVoicePlan = {
  omni: {
    provider: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    endpoint: "/api/nvidia/omni/transcribe",
    statusEndpoint: "/api/nvidia/omni/status",
    languageNote: "Official model card lists English-only language support; Mandarin is experimental for this prototype.",
  },
  asr: {
    provider: "parakeet-ctc-0.6b-zh-tw",
    languageCode: "zh-TW",
    buildFunctionId: "8473f56d-51ef-473c-bb26-efd4f5def2bf",
    localRealtimeEndpoint: import.meta.env.VITE_NVIDIA_ASR_WS_URL ?? "ws://localhost:9000/v1/realtime?intent=transcription",
    sampleRateHz: 16000,
  },
  tts: {
    provider: "magpie-tts-multilingual",
    languageCode: "zh-CN",
    preferredVoice: "Magpie-Multilingual.ZH-CN.Siwei",
    roleVoices: {
      cashier: "Magpie-Multilingual.ZH-CN.Siwei",
      announcer: "Magpie-Multilingual.ZH-CN.Mia.Calm",
      system: "Magpie-Multilingual.ZH-CN.HouZhen",
    },
    voiceCandidates: [
      "Magpie-Multilingual.ZH-CN.Siwei",
      "Magpie-Multilingual.ZH-CN.HouZhen",
      "Magpie-Multilingual.ZH-CN.Mia.Calm",
      "Magpie-Multilingual.ZH-CN.Mia.Neutral",
      "Magpie-Multilingual.ZH-CN.Aria.Calm",
      "Magpie-Multilingual.ZH-CN.Aria.Neutral",
    ],
    localRealtimeEndpoint: import.meta.env.VITE_NVIDIA_TTS_WS_URL ?? "ws://localhost:9001/v1/realtime?intent=synthesize",
    sampleRateHz: 22050,
  },
  llm: {
    provider: "nvidia/nemotron-3-nano-30b-a3b",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  },
} as const;
