export const geminiLivePlan = {
  model: import.meta.env.VITE_GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
  intentModel: import.meta.env.VITE_GEMINI_INTENT_MODEL ?? "gemini-3.1-flash-lite",
  ttsModel: import.meta.env.VITE_GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts",
  tokenEndpoint: "/api/gemini/live-token",
  intentEndpoint: "/api/gemini/order-intent",
  ttsEndpoint: "/api/gemini/tts",
  statusEndpoint: "/api/gemini/live/status",
  intentTimeoutMs: 3200,
  languageCode: "zh-TW",
  inputSampleRateHz: 16000,
  outputSampleRateHz: 24000,
  voices: {
    cashier: import.meta.env.VITE_GEMINI_CASHIER_VOICE ?? "Aoede",
    announcer: import.meta.env.VITE_GEMINI_ANNOUNCER_VOICE ?? "Zephyr",
    system: import.meta.env.VITE_GEMINI_SYSTEM_VOICE ?? "Kore",
  },
} as const;
