# 珍奶快打

珍奶快打 is a first-person Taiwan Mandarin boba-ordering trainer for desktop browsers and Quest WebXR. The project is both a language-learning prototype and a realtime voice demo: players stand at a Taiwanese drink shop counter, listen to a target order, speak the order in Traditional Chinese, respond to cashier follow-ups, and receive a scored receipt.

The package name, `boba-arcade-mandarin`, is only the internal English project code name. The user-facing product name is `珍奶快打`.

## Goals

- Support desktop and Quest WebXR as equal first-class targets.
- Keep live ordering UI available in the Three.js scene so it works in headset mode.
- Use strict Taiwan Mandarin UX: Traditional Chinese text, `zh-TW` recognition, and Taiwanese drink-shop ordering vocabulary.
- Demonstrate fast Live API speech while keeping a browser fallback for local iteration.
- Let scripted rounds define the target order, then move toward LLM-driven cashier interaction and pass/fail evaluation.

## Current Experience

The app starts at a small menu with two modes:

- `開始挑戰`: arcade rounds with a compact Traditional Chinese order ticket, pressure from the line, pass/fail scoring, and saved receipts.
- `自由練習`: an open ordering mode without a fixed objective, useful for testing the cashier flow.

During a round, the app listens by either gaze focus on the cashier or the manual `按一下說話` button. It parses the player's Mandarin order, asks for missing fields such as size, sweetness, and ice, confirms the final order, and creates a receipt. Receipts are stored in browser `localStorage` under `boba-receipts`.

## Tech Stack

- Vite 7, React 19, TypeScript
- Three.js for the first-person scene and WebXR entry
- `@sparkjsdev/spark` for Gaussian splat rendering
- Gemini Live API for low-latency listening and spoken cashier lines
- Browser speech APIs as a fallback for local testing
- NVIDIA streaming ASR and Nemotron Omni proxy hooks retained for experiments

## Project Structure

```text
.
├── DESIGN.md                 # UI and WebXR direction
├── README.md
├── VIVE_FOCUS_TESTING.md     # HTC VIVE Focus headset testing notes
├── index.html
├── package.json
├── public/assets/
│   ├── audio/                # Ambient cafe audio
│   ├── characters/           # Cashier and customer character assets
│   └── world/                # SPZ world and collider assets
└── src/
    ├── App.tsx               # Game state, round flow, voice wiring, HUD
    ├── game/                 # Menu data, rounds, parser, scoring, types
    ├── styles/app.css
    ├── three/BobaScene.tsx   # Spark/Three/WebXR scene and in-world panels
    └── voice/                # Gemini Live, browser, NVIDIA streaming, and Omni voice providers
```

## Assets

Vite serves files in `public` from the site root. The main scene expects these asset URLs:

- `/assets/world/cozy-boba-shop.spz`
- `/assets/world/cozy-anime-boba-shop-collider.glb`
- `/assets/characters/aki/aki-cashier.glb`
- `/assets/characters/universal-base/Superhero_Male_FullBody.gltf`
- `/assets/audio/midnight-jazz-cafe.mp3`

The current primary world splat is `public/assets/world/cozy-boba-shop.spz`.

## Run Locally

```sh
npm install
npm run dev
```

Open the URL Vite prints. It normally starts on:

```text
http://127.0.0.1:5173/
```

If port `5173` is already occupied, Vite will choose the next available port, such as `5174`.

## Scripts

```sh
npm run dev        # Start Vite on host 0.0.0.0
npm run build      # Typecheck and build
npm run preview    # Preview the production build
npm run typecheck  # Run TypeScript without emitting files
```

## Voice Path

`src/App.tsx` currently creates a `GeminiLiveVoiceProvider` with `BrowserMandarinVoiceProvider` as the fallback. The current active direction is Gemini Live first, browser fallback second. The in-game requirement remains strict Taiwan Mandarin: Traditional Chinese, `zh-TW`, and Taiwanese drink-shop ordering vocabulary.

Set a local Gemini key before starting Vite:

```sh
GEMINI_API_KEY=... npm run dev
# or put GEMINI_API_KEY in .env.local
```

The local Vite server exposes:

- `GET /api/gemini/live/status`
- `POST /api/gemini/live-token`
- `POST /api/gemini/tts`

The token route creates short-lived Gemini Live ephemeral tokens so the browser can connect to Gemini without exposing the real API key. Cashier/objective speech tries Gemini Live audio first, then uses the dedicated Gemini TTS route as a fallback or pre-render path for exact scripted lines. The default Live model is:

```text
gemini-3.1-flash-live-preview
```

Optional voice/model overrides:

```sh
GEMINI_LIVE_MODEL='gemini-3.1-flash-live-preview'
GEMINI_TTS_MODEL='gemini-2.5-flash-preview-tts'
VITE_GEMINI_CASHIER_VOICE='Aoede'
VITE_GEMINI_ANNOUNCER_VOICE='Zephyr'
VITE_GEMINI_SYSTEM_VOICE='Kore'
```

### Gemini API Notes

Checked against the official Google AI Gemini docs in May 2026:

- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api): Gemini Live is the realtime path for this demo. It uses a stateful WebSocket and is designed for low-latency voice interactions, including game/NPC-style use cases. Keep the direct browser connection protected with ephemeral tokens, not a long-lived API key.
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens): tokens are Live-only, short-lived credentials. The local `/api/gemini/live-token` route mints constrained tokens with `uses: 1`, a 1-minute new-session window, a 10-minute token lifetime, and model/config constraints so the browser never sees the real `GEMINI_API_KEY`.
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): Live audio is raw little-endian 16-bit PCM. Send microphone chunks as `audio/pcm;rate=16000`; expect 24 kHz PCM output. `inputAudioTranscription` powers the player transcript, and `outputAudioTranscription` can power cashier subtitles.
- Gemini 3.1 Flash Live can send multiple parts in one server event, so client code must iterate every `serverContent.modelTurn.parts` item when extracting audio. For text sent during a 3.1 Live session, use `sendRealtimeInput` after initial setup/history.
- [Live session management](https://ai.google.dev/gemini-api/docs/live-api/session-management): without context compression, audio-only sessions are limited to 15 minutes, and individual WebSocket connections last around 10 minutes. The current demo opens short-lived listen/speak sessions per turn; longer freeplay should add session resumption and/or context window compression.
- [Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation): Gemini TTS is separate from Live. It is best for exact scripted line reads, accepts text-only input, returns audio-only output, uses 24 kHz PCM examples, and does not support streaming. Keep Live as the realtime cashier path and use TTS as a fallback or pre-render path.
- Current Google docs list `gemini-3.1-flash-tts-preview` plus Gemini 2.5 preview TTS models. The project default remains `gemini-2.5-flash-preview-tts` until the newer 3.1 TTS voice quality is tested in the boba scene; use `GEMINI_TTS_MODEL` to audition it without changing code.
- For future scenario swaps, keep language, locale, vocabulary, cashier persona, and TTS voice choice data-driven. Mandarin uses Traditional Chinese and `zh-TW`; a French bakery should swap to `fr-FR` and bakery-specific prompts without changing the voice architecture.

For now, the app uses Gemini Live for:

- player Mandarin speech transcription through `inputAudioTranscription`
- strict prompt instructions for Traditional Chinese and Taiwan Mandarin
- cashier/objective/system speech through Live API audio output

And Gemini TTS only as a fallback/pre-render path:

- exact scripted lines if Live audio output is unavailable

Legacy NVIDIA streaming ASR target retained for experiments:

- Model: `parakeet-ctc-0.6b-zh-tw`
- Language: `zh-TW`
- Audio: realtime `pcm16`, 16 kHz, mono
- Default local websocket endpoint: `ws://localhost:9000/v1/realtime?intent=transcription`

To point the browser at a local or remote NVIDIA ASR endpoint:

```sh
VITE_NVIDIA_ASR_WS_URL='ws://localhost:9000/v1/realtime?intent=transcription' npm run dev
```

Use `wss://...` for a remote tunnel or HTTPS page.

Cashier speech synthesis now tries NVIDIA Magpie TTS first, then falls back to browser TTS if the local TTS NIM is unavailable. Taiwan Mandarin output remains the UX requirement, but the current Magpie multilingual Mandarin voices are exposed as `zh-CN`, so audition voices by ear.

## LLM And Speech Architecture Plan

This project should optimize for the feeling of a live conversation at the counter. Do not route every player utterance through a large LLM before the game reacts. The intended loop is:

```text
player mic
  -> Gemini Live transcription
  -> local Taiwan boba parser
  -> deterministic order state update
  -> cashier response
  -> Gemini Live audio output
```

The local parser in `src/game/parser.ts` is the first-pass intent engine. It should remain fast and deterministic for common order language: drink, quantity, size, sweetness, ice, toppings, corrections, confirmations, and politeness. If the parser can confidently update the order, the cashier should respond immediately without waiting for a cloud LLM.

Use an LLM only as a fallback or enrichment layer:

- Ambiguous utterances: ask Nemotron to classify intent or extract a structured order patch.
- Natural cashier variation: generate more lifelike Taiwan Mandarin follow-up wording.
- Evaluation: judge whether the interaction was fluent, polite, or required too many corrections.
- Future multimodal use: Nemotron 3 Nano Omni can inspect audio/video/context for demo storytelling, but it should not be the main realtime ASR path.

Current Gemini target:

- Live model: `gemini-3.1-flash-live-preview`.
- TTS fallback model: `gemini-2.5-flash-preview-tts`.
- Auth: local Vite ephemeral-token route, backed by `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
- Input audio: realtime Mandarin speech, 16 kHz PCM.
- Player feedback: `inputAudioTranscription` feeds the bottom transcript and in-world VR transcript panel.
- Output audio: Gemini Live audio, with `outputAudioTranscription` available for cashier subtitles.
- Prompting: force Traditional Chinese, Taiwan Mandarin, and Taiwanese drink-shop phrasing.

Legacy NVIDIA stack retained for experiments:

- Streaming ASR: `parakeet-ctc-0.6b-zh-tw` through NVIDIA Speech/Riva NIM.
- Fast order logic: local parser first.
- LLM fallback/reasoning: Nemotron family, with `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` available through the local Vite proxy for experiments.
- Streaming TTS: `magpie-tts-multilingual`.

For TTS, the requirement is “most Taiwanese-sounding,” not merely Mandarin. Current candidates to test by ear:

- `Magpie-Multilingual.ZH-CN.Siwei`
- `Magpie-Multilingual.ZH-CN.HouZhen`
- `Magpie-Multilingual.ZH-CN.Mia.Calm`
- `Magpie-Multilingual.ZH-CN.Mia.Neutral`
- `Magpie-Multilingual.ZH-CN.Aria.Calm`
- `Magpie-Multilingual.ZH-CN.Aria.Neutral`

If none of the Gemini voices feel Taiwan-appropriate, keep browser TTS or another voice service as a temporary fallback while preserving the Gemini Live abstraction in code.

### Brev/NIM Deployment Direction

For the hackathon demo, the likely deployment is a Brev GPU instance running NVIDIA Speech/Riva NIM services:

- ASR NIM exposed from the Brev instance as `wss://.../v1/realtime?intent=transcription` for the browser websocket. The NIM may also expose `/v1/realtime/transcription_sessions` as a POST session endpoint, but the app does not connect to that URL directly.
- Optional TTS NIM exposed as `wss://.../v1/realtime?intent=synthesize`.
- The browser app uses `VITE_NVIDIA_ASR_WS_URL` and later `VITE_NVIDIA_TTS_WS_URL`.

Local Brev helper scripts live in `scripts/brev`:

```sh
brev copy scripts/brev/start-asr-nim.sh boba-speech-nim:~/boba-speech/start-asr-nim.sh
brev copy scripts/brev/start-tts-nim.sh boba-speech-nim:~/boba-speech/start-tts-nim.sh
brev exec boba-speech-nim "chmod +x ~/boba-speech/start-*.sh && ~/boba-speech/start-asr-nim.sh && ~/boba-speech/start-tts-nim.sh"
brev port-forward boba-speech-nim -p 9000:9000
brev port-forward boba-speech-nim -p 9001:9001
```

Prefer a setup that keeps latency low over one that proves every model is omni-modal. A responsive ASR -> parser -> TTS loop is more important for the demo than a single-model story.

## NVIDIA Omni Proxy

`vite.config.ts` installs local proxy routes for optional Nemotron Omni transcription experiments:

- `GET /api/nvidia/omni/status`
- `POST /api/nvidia/omni/transcribe`

Set one of these before starting Vite:

```sh
NVIDIA_API_KEY=... npm run dev
# or
NVIDIA_NIM_API_KEY=... npm run dev
```

Optional overrides:

```sh
NVIDIA_OMNI_MODEL='nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
NVIDIA_OMNI_ENDPOINT='https://integrate.api.nvidia.com/v1/chat/completions'
```

The proxy keeps NVIDIA API keys out of the browser. Mandarin transcription through Omni is experimental; the main ASR target remains the Taiwan Mandarin Parakeet path.

## Gameplay Model

Rounds live in `src/game/rounds.ts`. Each round specifies a target order with some combination of drink, quantity, size, sweetness, ice, and toppings.

Menu vocabulary lives in `src/game/menu.ts`, and local utterance parsing lives in `src/game/parser.ts`. That parser is intentionally lightweight: it recognizes known aliases and merges each transcript into the current order. Keep this parser as the fast path. LLM calls should augment the interaction only when the parser cannot confidently extract intent or when the cashier needs richer variation.

Scoring lives in `src/game/scoring.ts` and currently considers:

- correctness against the target order
- politeness phrases
- elapsed time and corrections
- repeats and technical misses

## Debug URLs

Useful query parameters implemented by `BobaScene.tsx`:

- `/?noXr=1`: disables the WebXR button for desktop screenshots.
- `/?avatar=glb`: uses GLTF customer avatars instead of procedural placeholders.
- `/?bare=1`: hides added signs, cashier flow, and NPC props for splat calibration.
- `/?simpleSplat=1`: renders a generated debug splat instead of the world SPZ.
- `/?flip=1`: flips the splat orientation for calibration.
- `/?cam=x,y,z`: overrides the camera position.
- `/?target=x,y,z`: overrides the initial look target.
- `/?splat=x,y,z`: offsets the splat world.
- `/?splatScale=n`: changes splat scale.
- `/?fov=n`: changes camera field of view.

## Design Notes

`DESIGN.md` is the source of truth for UI direction. The intended feel is an in-world arcade roleplay simulator, not a dashboard. Live ordering information should appear as small Three.js surfaces near the counter, while DOM overlays should stay limited to menus, settings, debug tools, technical recovery, and receipts.

The visible menu boards in the scene are mainly aesthetic today and should be improved over time. The old pose debug sliders have been removed; the cashier now uses the baked `COUNTER_CASHIER_POSE`.

## Future Scenario Abstraction

The current priority is polishing the Taiwan boba ordering demo. When making new changes, keep the architecture friendly to future scenario swaps such as a French bakery or Spanish-language ordering environment. Prefer code that separates scenario-specific content from reusable interaction mechanics: vocabulary, menu items, rounds, cashier copy, locale, voice prompts, in-world menu board text, scoring labels, and asset URLs should gradually move toward configurable scenario data.

Do not start a broad abstraction pass until the current demo is polished. Small opportunistic cleanup is welcome when it reduces hardcoded boba/Mandarin assumptions without adding complexity or risking the demo.

## Known Gaps

- Browser speech is a fallback, not the final voice system.
- TTS is not yet fully NVIDIA-backed.
- LLM fallback for ambiguous utterances and richer cashier behavior is planned but not the active gameplay path yet.
- Automated smoke tests are not wired into the project yet.
- The project prioritizes demo clarity and learning value over production-level polish.
