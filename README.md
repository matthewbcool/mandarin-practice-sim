# 珍奶快打

珍奶快打 is a first-person Taiwan Mandarin boba-ordering trainer for desktop browsers and Quest WebXR. The project is both a language-learning prototype and a WebXR/NVIDIA voice demo: players stand at a Taiwanese drink shop counter, listen to a target order, speak the order in Traditional Chinese, respond to cashier follow-ups, and receive a scored receipt.

The package name, `boba-arcade-mandarin`, is only the internal English project code name. The user-facing product name is `珍奶快打`.

## Goals

- Support desktop and Quest WebXR as equal first-class targets.
- Keep live ordering UI available in the Three.js scene so it works in headset mode.
- Use strict Taiwan Mandarin UX: Traditional Chinese text, `zh-TW` recognition, and Taiwanese drink-shop ordering vocabulary.
- Demonstrate NVIDIA-powered speech and reasoning while keeping a browser fallback for local iteration.
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
- Browser speech APIs as a fallback for local testing
- NVIDIA streaming ASR and Nemotron Omni proxy hooks for the target voice path

## Project Structure

```text
.
├── DESIGN.md                 # UI and WebXR direction
├── README.md
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
    └── voice/                # Browser, NVIDIA streaming, and Omni voice providers
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

`src/App.tsx` currently creates a `NvidiaStreamingSpeechVoiceProvider` with `BrowserMandarinVoiceProvider` as the fallback. The intended direction is NVIDIA-first speech, not browser speech long term.

The active streaming ASR target is:

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
  -> NVIDIA streaming ASR
  -> local Taiwan boba parser
  -> deterministic order state update
  -> cashier response
  -> streaming TTS
```

The local parser in `src/game/parser.ts` is the first-pass intent engine. It should remain fast and deterministic for common order language: drink, quantity, size, sweetness, ice, toppings, corrections, confirmations, and politeness. If the parser can confidently update the order, the cashier should respond immediately without waiting for a cloud LLM.

Use an LLM only as a fallback or enrichment layer:

- Ambiguous utterances: ask Nemotron to classify intent or extract a structured order patch.
- Natural cashier variation: generate more lifelike Taiwan Mandarin follow-up wording.
- Evaluation: judge whether the interaction was fluent, polite, or required too many corrections.
- Future multimodal use: Nemotron 3 Nano Omni can inspect audio/video/context for demo storytelling, but it should not be the main realtime ASR path.

Target NVIDIA stack:

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

If none of the Magpie voices feel Taiwan-appropriate, keep browser TTS or another voice service as a temporary fallback, but preserve the NVIDIA-first architecture in code.

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

## Known Gaps

- Browser speech is a fallback, not the final voice system.
- TTS is not yet fully NVIDIA-backed.
- LLM fallback for ambiguous utterances and richer cashier behavior is planned but not the active gameplay path yet.
- Automated smoke tests are not wired into the project yet.
- The project prioritizes demo clarity and learning value over production-level polish.
