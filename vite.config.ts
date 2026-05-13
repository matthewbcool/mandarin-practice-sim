import { GoogleGenAI } from "@google/genai";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const geminiTtsCache = new Map();
const geminiTtsCacheLimit = 80;
const geminiVoiceRoles = new Set(["cashier", "announcer", "system"]);
const geminiRateBuckets = new Map();
const geminiRequestLimits = {
  bodyBytes: 256 * 1024,
  transcriptChars: 1200,
  ttsChars: 600,
  rateWindowMs: 60_000,
  requestsPerWindow: {
    "live-token": 20,
    "order-intent": 40,
    tts: 25,
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const nvidiaSettings = {
    model: env.NVIDIA_OMNI_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    endpoint: env.NVIDIA_OMNI_ENDPOINT ?? "https://integrate.api.nvidia.com/v1/chat/completions",
    apiKey: env.NVIDIA_API_KEY ?? env.NVIDIA_NIM_API_KEY ?? "",
  };
  const geminiSettings = {
    model: env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
    intentModel: env.GEMINI_INTENT_MODEL ?? "gemini-3.1-flash-lite",
    ttsModel: env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts",
    apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "",
    publicEnabled: env.GEMINI_PUBLIC_ENABLED === "1",
    voices: {
      cashier: env.VITE_GEMINI_CASHIER_VOICE ?? "Aoede",
      announcer: env.VITE_GEMINI_ANNOUNCER_VOICE ?? "Zephyr",
      system: env.VITE_GEMINI_SYSTEM_VOICE ?? "Kore",
    },
  };

  return {
    plugins: [react(), nvidiaOmniProxy(nvidiaSettings), geminiLiveProxy(geminiSettings)],
    server: {
      port: 5173,
      strictPort: false,
    },
  };
});

function nvidiaOmniProxy(settings) {
  return {
    name: "nvidia-omni-proxy",
    configureServer(server) {
      installNvidiaOmniRoutes(server.middlewares, settings);
    },
    configurePreviewServer(server) {
      installNvidiaOmniRoutes(server.middlewares, settings);
    },
  };
}

function geminiLiveProxy(settings) {
  return {
    name: "gemini-live-token-proxy",
    configureServer(server) {
      installGeminiLiveRoutes(server.middlewares, settings);
    },
    configurePreviewServer(server) {
      installGeminiLiveRoutes(server.middlewares, settings);
    },
  };
}

function installNvidiaOmniRoutes(middlewares, settings) {
  middlewares.use("/api/nvidia/omni/status", (_request, response) => {
    sendJson(response, 200, {
      enabled: Boolean(settings.apiKey),
      model: settings.model,
      endpoint: settings.endpoint,
      reason: settings.apiKey ? undefined : "Set NVIDIA_API_KEY or NVIDIA_NIM_API_KEY before starting Vite.",
    });
  });

  middlewares.use("/api/nvidia/omni/transcribe", async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const apiKey = settings.apiKey;
    if (!apiKey) {
      sendJson(response, 501, { error: "NVIDIA_API_KEY or NVIDIA_NIM_API_KEY is not set on the local dev server." });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/wav";
      if (!audioBase64) {
        sendJson(response, 400, { error: "Missing audioBase64." });
        return;
      }

      const upstream = await fetch(settings.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "audio_url",
                  audio_url: { url: `data:${mimeType};base64,${audioBase64}` },
                },
                {
                  type: "text",
                  text: [
                    "Transcribe the user's speech.",
                    "The audio may contain Taiwanese Mandarin used while ordering bubble tea.",
                    "Return only the best transcript in Traditional Chinese. Do not translate. Do not explain.",
                    "If there is no speech, return an empty string.",
                  ].join(" "),
                },
              ],
            },
          ],
          max_tokens: 256,
          temperature: 0.2,
          top_k: 1,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });

      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        sendJson(response, upstream.status, {
          error: payload?.error?.message ?? payload?.detail ?? "NVIDIA Omni request failed.",
        });
        return;
      }

      sendJson(response, 200, {
        transcript: extractAssistantText(payload),
        model: payload?.model ?? settings.model,
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "NVIDIA Omni proxy failed.",
      });
    }
  });
}

function installGeminiLiveRoutes(middlewares, settings) {
  middlewares.use("/api/gemini/live/status", (_request, response) => {
    const enabled = isGeminiEnabled(settings);
    sendJson(response, 200, {
      enabled,
      publicEnabled: settings.publicEnabled,
      model: settings.model,
      intentModel: settings.intentModel,
      ttsModel: settings.ttsModel,
      reason: enabled
        ? undefined
        : settings.publicEnabled
          ? "Set GEMINI_API_KEY or GOOGLE_API_KEY before starting Vite."
          : "Set GEMINI_PUBLIC_ENABLED=1 to enable Gemini-backed cashier mode.",
    });
  });

  middlewares.use("/api/gemini/live-token", async (request, response) => {
    if (!guardGeminiRequest(request, response, settings, "live-token")) return;

    try {
      const body = await readJsonBody(request, geminiRequestLimits.bodyBytes);
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
            config: geminiLiveConfigForPurpose(purpose, settings),
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
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Gemini Live token request failed.",
      });
    }
  });

  middlewares.use("/api/gemini/order-intent", async (request, response) => {
    if (!guardGeminiRequest(request, response, settings, "order-intent")) return;

    try {
      const body = await readJsonBody(request, geminiRequestLimits.bodyBytes);
      const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
      if (!transcript) {
        sendJson(response, 400, { error: "Missing transcript." });
        return;
      }
      if (transcript.length > geminiRequestLimits.transcriptChars) {
        sendJson(response, 413, { error: "Transcript is too long." });
        return;
      }

      const ai = new GoogleGenAI({ apiKey: settings.apiKey });
      const upstream = await ai.models.generateContent({
        model: settings.intentModel,
        contents: [
          {
            parts: [
              {
                text: formatGeminiIntentPrompt(body, transcript),
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      });

      const text = extractGeminiResponseText(upstream);
      const parsed = parseJsonObject(text);
      sendJson(response, 200, {
        ...parsed,
        model: settings.intentModel,
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Gemini order intent request failed.",
      });
    }
  });

  middlewares.use("/api/gemini/tts", async (request, response) => {
    if (!guardGeminiRequest(request, response, settings, "tts")) return;

    try {
      const body = await readJsonBody(request, geminiRequestLimits.bodyBytes);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const requestedRole = typeof body.voiceRole === "string" ? body.voiceRole : "cashier";
      const role = geminiVoiceRoles.has(requestedRole) ? requestedRole : "cashier";
      if (!text) {
        sendJson(response, 400, { error: "Missing text." });
        return;
      }
      if (text.length > geminiRequestLimits.ttsChars) {
        sendJson(response, 413, { error: "Text is too long." });
        return;
      }

      const ai = new GoogleGenAI({ apiKey: settings.apiKey });
      const voiceName = settings.voices[role] ?? settings.voices.cashier;
      const cacheKey = JSON.stringify([settings.ttsModel, voiceName, text]);
      const cached = geminiTtsCache.get(cacheKey);
      if (cached) {
        sendJson(response, 200, { ...cached, cached: true });
        return;
      }

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

      const part = upstream.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
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
      geminiTtsCache.set(cacheKey, payload);
      while (geminiTtsCache.size > geminiTtsCacheLimit) {
        const oldest = geminiTtsCache.keys().next().value;
        if (!oldest) break;
        geminiTtsCache.delete(oldest);
      }
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Gemini TTS request failed.",
      });
    }
  });
}

function isGeminiEnabled(settings) {
  return Boolean(settings.publicEnabled && settings.apiKey);
}

function geminiDisabledReason(settings) {
  if (!settings.publicEnabled) return "Gemini is disabled for this deployment. Set GEMINI_PUBLIC_ENABLED=1 to enable cashier voice mode.";
  return "GEMINI_API_KEY or GOOGLE_API_KEY is not set on the server.";
}

function guardGeminiRequest(request, response, settings, routeName) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return false;
  }

  if (!isGeminiEnabled(settings)) {
    sendJson(response, 403, { error: geminiDisabledReason(settings) });
    return false;
  }

  if (!isTrustedOrigin(request)) {
    sendJson(response, 403, { error: "Blocked cross-origin Gemini request." });
    return false;
  }

  const rateLimit = consumeGeminiRateLimit(request, routeName);
  if (!rateLimit.allowed) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))));
    sendJson(response, 429, { error: "Too many Gemini requests. Please try again shortly." });
    return false;
  }

  return true;
}

function isTrustedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  const host = request.headers.host;
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function consumeGeminiRateLimit(request, routeName) {
  const now = Date.now();
  const limit = geminiRequestLimits.requestsPerWindow[routeName] ?? 30;
  const key = `${getGeminiClientId(request)}:${routeName}`;
  const current = geminiRateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    geminiRateBuckets.set(key, { count: 1, resetAt: now + geminiRequestLimits.rateWindowMs });
    pruneGeminiRateBuckets(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  if (current.count >= limit) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }

  current.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

function getGeminiClientId(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return request.socket?.remoteAddress ?? "local";
}

function pruneGeminiRateBuckets(now) {
  if (geminiRateBuckets.size < 1000) return;

  for (const [key, bucket] of geminiRateBuckets) {
    if (bucket.resetAt <= now) geminiRateBuckets.delete(key);
  }
}

function formatGeminiIntentPrompt(body, transcript) {
  const payload = {
    transcript,
    mode: body.mode ?? "open",
    phase: body.phase ?? "ordering",
    pendingPrompt: body.pendingPrompt ?? "none",
    currentOrder: body.currentOrder ?? {},
    targetOrder: body.targetOrder ?? null,
    pendingSuggestion: body.pendingSuggestion ?? {},
    localParsed: body.localParsed ?? {},
    orderAfterLocalParse: body.orderAfterLocalParse ?? {},
    missingFieldsBefore: body.missingFieldsBefore ?? [],
    missingFieldsAfterLocalParse: body.missingFieldsAfterLocalParse ?? [],
    totalAfterLocalParse: body.totalAfterLocalParse ?? 0,
    recentTurns: body.recentTurns ?? [],
    menu: body.menu ?? {},
  };

  return [
    "Persona:",
    "你是台灣手搖飲店的真人店員，不是老師、表單、客服機器人或教學旁白。",
    "你親切、有效率、台灣口語自然。你只使用繁體中文與台灣華語。",
    "",
    "Goal:",
    "根據玩家剛說的話解析訂單，並替店員產生下一句自然回覆。店員的目標是把訂單補齊：飲料、杯型、甜度、冰塊、可選加料，最後告知金額並送單。",
    "自由模式不是固定流程。玩家可以一次講很多項、改單、問推薦、跳順序、只回答一個詞。你要自然接住，不要硬照同一套問題重複問。",
    "挑戰模式可以自然問問題，但不要透露 targetOrder；遊戲會另外判定玩家有沒有點對。",
    "",
    "Conversation rules:",
    "- cashierLine 必須依照「玩家這句話 + 目前訂單 + recentTurns」推進對話，而不是重複上一句。",
    "- 先更新 orderPatch，再決定還缺什麼；如果某欄位已經被 currentOrder、localParsed 或你的 orderPatch 捕捉到，絕對不要再問同一欄位。",
    "- 如果還缺多個欄位，可以像真人一樣合併問，例如「中杯大杯？甜度冰塊怎麼做？」但不要每次都同一句。",
    "- 如果玩家問推薦，直接以店員口吻給一個短建議，然後問玩家要不要照做。",
    "- 如果玩家確認建議或訂單，例如「好」「可以」「對」「是的」「OK」，設定 confirms: true。不要因此猜沒有根據的品項。",
    "- 如果玩家否認、改單或打斷，例如「不是」「改成」「等一下」，設定 denies: true，並解析他要改的欄位。",
    "- 如果訂單資料已足夠，cashierLine 要很短，可以確認或結帳，不要長篇複誦整張單。",
    "- 如果聽不懂，就用真人店員的方式換一種問法，不要一直重複同一句。",
    "- 不要預設教學；只有玩家問建議、看起來卡住、或 recentTurns 顯示沉默/不懂時才給提示。",
    "- cashierLine 最多一句，20 到 45 個中文字左右。不要英文、拼音、Markdown 或解釋。",
    "",
    "Parsing rules:",
    "- 使用 menu 裡的 id。玩家說法不完全相同時，選最接近的台灣手搖飲品項。",
    "- 常見口語：無甜/wu tian/wu tien 等於無糖；少甜約等於少糖；不加冰/不要冰等於去冰。",
    "- 珍珠奶茶、波霸奶茶、布丁奶茶等飲料名稱裡的內容不算額外加料；只有玩家明確說「加、加料、多加、配、放」時才填 toppingIds。",
    "- 不確定就留空，不要亂猜飲料或配料。",
    "",
    "Output:",
    "只輸出 JSON，不要 Markdown，不要額外文字。",
    "JSON schema example:",
    JSON.stringify({
      orderPatch: {
        quantity: 1,
        drinkId: "menu drink id or null",
        sizeId: "menu size id or null",
        sweetnessId: "menu sweetness id or null",
        iceId: "menu ice id or null",
        toppingIds: ["menu topping id"],
      },
      sideIntent: { type: "cashier.advice", topic: "sweetness|ice|size|topping|drink|general" },
      confirms: false,
      denies: false,
      cashierLine: "",
      confidence: 0.8,
    }),
    "",
    "Input payload:",
    JSON.stringify(payload),
  ].join("\n");
}

function geminiLiveConfigForPurpose(purpose, settings) {
  if (purpose === "speak") {
    return {
      responseModalities: ["AUDIO"],
      outputAudioTranscription: {},
      thinkingConfig: { thinkingLevel: "MINIMAL" },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: settings.voices.cashier,
          },
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
      "只能輸出台灣華語繁體中文，或玩家明確說出的英文飲料詞。不要輸出其他語言或其他文字系統。",
      "如果音訊不清楚或像背景噪音，輸出空字串。",
      "不要扮演店員，不要回答玩家問題，不要教學，不要加入說明。",
    ].join("\n"),
  };
}

function extractGeminiResponseText(payload) {
  if (typeof payload?.text === "string") return payload.text.trim();
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function parseJsonObject(text) {
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

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function readJsonBody(request, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}
