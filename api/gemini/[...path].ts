import { GoogleGenAI } from "@google/genai";

const ttsCache = new Map<string, Record<string, unknown>>();
const ttsCacheLimit = 60;

export default async function handler(request: any, response: any) {
  const path = normalizePath(request.query?.path);
  const settings = getGeminiSettings();

  if (path === "live/status") {
    sendJson(response, 200, {
      enabled: isGeminiEnabled(settings),
      publicEnabled: settings.publicEnabled,
      model: settings.model,
      intentModel: settings.intentModel,
      ttsModel: settings.ttsModel,
      reason: isGeminiEnabled(settings) ? undefined : geminiDisabledReason(settings),
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!isGeminiEnabled(settings)) {
    sendJson(response, 403, { error: geminiDisabledReason(settings) });
    return;
  }

  try {
    if (path === "live-token") {
      await createLiveToken(request, response, settings);
      return;
    }
    if (path === "order-intent") {
      await createOrderIntent(request, response, settings);
      return;
    }
    if (path === "tts") {
      await createTts(request, response, settings);
      return;
    }
    sendJson(response, 404, { error: "Gemini route not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Gemini API route failed.",
    });
  }
}

async function createLiveToken(request: any, response: any, settings: ReturnType<typeof getGeminiSettings>) {
  const body = await readJsonBody(request);
  const purpose = body.purpose === "speak" ? "speak" : "listen";
  const newSessionExpireTime = new Date(Date.now() + 60_000).toISOString();
  const expireTime = new Date(Date.now() + 10 * 60_000).toISOString();
  const ai = new GoogleGenAI({
    apiKey: settings.apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime,
      expireTime,
      liveConnectConstraints: {
        model: settings.model,
        config: liveConfigForPurpose(purpose, settings),
      },
      lockAdditionalFields: [],
    },
  });

  if (!token.name) {
    sendJson(response, 502, { error: "Gemini returned an empty Live token." });
    return;
  }

  sendJson(response, 200, {
    token: token.name,
    model: settings.model,
    newSessionExpireTime,
    expireTime,
  });
}

async function createOrderIntent(request: any, response: any, settings: ReturnType<typeof getGeminiSettings>) {
  const body = await readJsonBody(request);
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    sendJson(response, 400, { error: "Missing transcript." });
    return;
  }

  const ai = new GoogleGenAI({ apiKey: settings.apiKey });
  const upstream = await ai.models.generateContent({
    model: settings.intentModel,
    contents: [{ parts: [{ text: formatIntentPrompt(body, transcript) }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });
  const parsed = parseJsonObject(extractGeminiResponseText(upstream));
  sendJson(response, 200, { ...parsed, model: settings.intentModel });
}

async function createTts(request: any, response: any, settings: ReturnType<typeof getGeminiSettings>) {
  const body = await readJsonBody(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const role = typeof body.voiceRole === "string" ? body.voiceRole : "cashier";
  if (!text) {
    sendJson(response, 400, { error: "Missing text." });
    return;
  }

  const voiceName = settings.voices[role] ?? settings.voices.cashier;
  const cacheKey = JSON.stringify([settings.ttsModel, voiceName, text]);
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    sendJson(response, 200, { ...cached, cached: true });
    return;
  }

  const ai = new GoogleGenAI({ apiKey: settings.apiKey });
  const upstream = await ai.models.generateContent({
    model: settings.ttsModel,
    contents: [
      {
        parts: [
          {
            text: [
              "請用自然親切的台灣華語語氣朗讀以下文字。",
              "可以把引號內文字說得更口語、更像真人店員，也可以加入非常短的承接語。",
              "不要改變訂單重點，不要加入說明、翻譯、英文或拼音。",
              `「${text.slice(0, 1000)}」`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: "zh-TW",
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const part = upstream.candidates?.[0]?.content?.parts?.find((item: any) => item.inlineData?.data);
  const audioBase64 = part?.inlineData?.data;
  if (!audioBase64) {
    sendJson(response, 502, { error: "Gemini TTS returned no audio." });
    return;
  }

  const payload = {
    audioBase64,
    mimeType: part.inlineData?.mimeType ?? "audio/l16; rate=24000; channels=1",
    model: settings.ttsModel,
    voiceName,
    cached: false,
  };
  ttsCache.set(cacheKey, payload);
  while (ttsCache.size > ttsCacheLimit) {
    const oldest = ttsCache.keys().next().value;
    if (!oldest) break;
    ttsCache.delete(oldest);
  }
  sendJson(response, 200, payload);
}

function getGeminiSettings() {
  return {
    model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
    intentModel: process.env.GEMINI_INTENT_MODEL ?? "gemini-3.1-flash-lite",
    ttsModel: process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts",
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
    publicEnabled: process.env.GEMINI_PUBLIC_ENABLED === "1",
    voices: {
      cashier: process.env.VITE_GEMINI_CASHIER_VOICE ?? "Aoede",
      announcer: process.env.VITE_GEMINI_ANNOUNCER_VOICE ?? "Zephyr",
      system: process.env.VITE_GEMINI_SYSTEM_VOICE ?? "Kore",
    } as Record<string, string>,
  };
}

function isGeminiEnabled(settings: ReturnType<typeof getGeminiSettings>) {
  return Boolean(settings.publicEnabled && settings.apiKey);
}

function geminiDisabledReason(settings: ReturnType<typeof getGeminiSettings>) {
  if (!settings.publicEnabled) return "Gemini is disabled for this deployment. Set GEMINI_PUBLIC_ENABLED=1 to enable cashier voice mode.";
  return "GEMINI_API_KEY or GOOGLE_API_KEY is not set on the server.";
}

function liveConfigForPurpose(purpose: "listen" | "speak", settings: ReturnType<typeof getGeminiSettings>) {
  if (purpose === "speak") {
    return {
      responseModalities: ["AUDIO"],
      outputAudioTranscription: {},
      thinkingConfig: { thinkingLevel: "MINIMAL" },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: settings.voices.cashier },
        },
      },
      systemInstruction: [
        "你在台灣手搖飲店的點餐情境中工作。",
        "所有輸出都使用繁體中文與自然台灣華語。",
        "你是親切的店員，可以把提供的台詞說得更自然，也可以加入非常短的承接語。",
        "不要改變訂單重點，不要新增英文、拼音或不相關內容。",
      ].join("\n"),
    };
  }

  return {
    responseModalities: ["TEXT"],
    inputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        prefixPaddingMs: 220,
        silenceDurationMs: 520,
      },
    },
    systemInstruction: [
      "你在台灣手搖飲店的點餐情境中工作。",
      "所有輸入與輸出都以繁體中文處理，使用自然的台灣華語。",
      "你的任務只有語音轉文字：輸出玩家剛剛說的繁體中文內容。",
      "可以整理口吃、停頓或輕微改口，但不要憑空新增飲料、甜度、冰塊、杯型或加料。",
      "只能輸出台灣華語繁體中文，或玩家明確說出的英文飲料詞。",
      "如果音訊不清楚或像背景噪音，輸出空字串。",
      "不要扮演店員，不要回答玩家問題，不要教學，不要加入說明。",
    ].join("\n"),
  };
}

function formatIntentPrompt(body: Record<string, unknown>, transcript: string) {
  return [
    "You are a Taiwan Mandarin boba shop cashier intent parser.",
    "Return JSON only. Parse the player's drink order and provide one short Traditional Chinese cashierLine.",
    "Use ids from the provided menu payload when available. Leave uncertain fields null or empty.",
    "Schema: { orderPatch: { quantity, drinkId, sizeId, sweetnessId, iceId, toppingIds }, sideIntent, confirms, denies, cashierLine, confidence }.",
    "Input payload:",
    JSON.stringify({ ...body, transcript }),
  ].join("\n");
}

function extractGeminiResponseText(payload: any) {
  if (typeof payload?.text === "string") return payload.text.trim();
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("").trim();
  }
  return "";
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Gemini returned an empty intent response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini intent response was not JSON.");
    return JSON.parse(match[0]);
  }
}

async function readJsonBody(request: any) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

function normalizePath(path: unknown) {
  if (Array.isArray(path)) return path.join("/");
  return typeof path === "string" ? path : "";
}

function sendJson(response: any, status: number, body: Record<string, unknown>) {
  response.status(status).json(body);
}
