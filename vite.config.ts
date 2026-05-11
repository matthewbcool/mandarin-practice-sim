import { GoogleGenAI } from "@google/genai";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const geminiTtsCache = new Map();
const geminiTtsCacheLimit = 80;

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
    sendJson(response, 200, {
      enabled: Boolean(settings.apiKey),
      model: settings.model,
      intentModel: settings.intentModel,
      ttsModel: settings.ttsModel,
      reason: settings.apiKey ? undefined : "Set GEMINI_API_KEY or GOOGLE_API_KEY before starting Vite.",
    });
  });

  middlewares.use("/api/gemini/live-token", async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (!settings.apiKey) {
      sendJson(response, 501, { error: "GEMINI_API_KEY or GOOGLE_API_KEY is not set on the local dev server." });
      return;
    }

    try {
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
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (!settings.apiKey) {
      sendJson(response, 501, { error: "GEMINI_API_KEY or GOOGLE_API_KEY is not set on the local dev server." });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
      if (!transcript) {
        sendJson(response, 400, { error: "Missing transcript." });
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
          temperature: 0.45,
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
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (!settings.apiKey) {
      sendJson(response, 501, { error: "GEMINI_API_KEY or GOOGLE_API_KEY is not set on the local dev server." });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const role = typeof body.voiceRole === "string" ? body.voiceRole : "cashier";
      if (!text) {
        sendJson(response, 400, { error: "Missing text." });
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

function formatGeminiIntentPrompt(body, transcript) {
  const payload = {
    transcript,
    mode: body.mode ?? "open",
    phase: body.phase ?? "ordering",
    pendingPrompt: body.pendingPrompt ?? "none",
    currentOrder: body.currentOrder ?? {},
    pendingSuggestion: body.pendingSuggestion ?? {},
    localParsed: body.localParsed ?? {},
    menu: body.menu ?? {},
  };

  return [
    "你是台灣手搖飲點餐遊戲的店員大腦：同時解析玩家意圖，並替店員寫下一句自然回覆。",
    "情境：玩家正在用繁體中文和台灣飲料店店員點餐。自由模式要像真人點餐，不要像教學流程或表單。",
    "請根據 transcript、目前訂單、店員剛問的欄位、以及可用菜單，推斷玩家這一句話的意思，並產生 cashierLine。",
    "只輸出 JSON，不要 Markdown，不要額外文字。",
    "規則：",
    "- 使用繁體中文與台灣用語理解玩家。",
    "- 如果玩家自然說出飲料、杯型、甜度、冰塊、加料，請填入 orderPatch 的 id。",
    "- 如果玩家用不同說法表達同一件事，可以對應到最接近的菜單 id。",
    "- 幾乎每次都要給 cashierLine：像真人店員一樣接話、確認你聽到的內容，然後問下一個必要問題。",
    "- cashierLine 可以有一點個性、口語停頓或輕鬆語氣，但要像台灣服務業店員，不要像老師。",
    "- 如果玩家只是在問建議，設定 sideIntent，cashierLine 要直接自然地給建議。",
    "- 如果玩家確認店員剛剛的建議，例如「好」「可以」「對」，設定 confirms: true。不要硬塞沒有依據的品項。",
    "- 如果玩家否認或想修改，例如「不是」「等一下」「改成」，設定 denies: true。",
    "- 不要重複完整訂單很多次；資料夠了時，確認要簡短，例如「好，這樣可以嗎？」",
    "- 不要每句都教學。只有玩家問、卡住、或沉默很久才提示怎麼說。",
    "- cashierLine 最多兩短句，全部繁體中文，不要英文或拼音。",
    "- 不確定就留空欄位，不要猜飲料或配料。",
    "JSON 格式：",
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
    "輸入：",
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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
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
  response.end(JSON.stringify(body));
}
