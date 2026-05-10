import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const nvidiaOmniModel = process.env.NVIDIA_OMNI_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
const nvidiaOmniEndpoint = process.env.NVIDIA_OMNI_ENDPOINT ?? "https://integrate.api.nvidia.com/v1/chat/completions";

export default defineConfig({
  plugins: [react(), nvidiaOmniProxy()],
  server: {
    port: 5173,
    strictPort: false,
  },
});

function nvidiaOmniProxy() {
  return {
    name: "nvidia-omni-proxy",
    configureServer(server) {
      installNvidiaOmniRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      installNvidiaOmniRoutes(server.middlewares);
    },
  };
}

function installNvidiaOmniRoutes(middlewares) {
  middlewares.use("/api/nvidia/omni/status", (_request, response) => {
    sendJson(response, 200, {
      enabled: Boolean(getNvidiaApiKey()),
      model: nvidiaOmniModel,
      endpoint: nvidiaOmniEndpoint,
      reason: getNvidiaApiKey() ? undefined : "Set NVIDIA_API_KEY or NVIDIA_NIM_API_KEY before starting Vite.",
    });
  });

  middlewares.use("/api/nvidia/omni/transcribe", async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const apiKey = getNvidiaApiKey();
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

      const upstream = await fetch(nvidiaOmniEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: nvidiaOmniModel,
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
        model: payload?.model ?? nvidiaOmniModel,
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "NVIDIA Omni proxy failed.",
      });
    }
  });
}

function getNvidiaApiKey() {
  return process.env.NVIDIA_API_KEY ?? process.env.NVIDIA_NIM_API_KEY ?? "";
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
