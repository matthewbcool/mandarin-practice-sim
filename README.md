# World Labs Language Simulator

A web-based language simulator for practicing real conversations inside immersive 3D places.

The current scenario is `珍奶快打`, a first-person Taiwan Mandarin boba-shop trainer. The player stands at a drink-shop counter, speaks an order, answers cashier follow-ups, and receives a scored receipt. The broader goal is a scenario system where the same interaction loop can move from a Taiwanese boba shop to a French bakery, a Spanish market, a Japanese train station, or any other language-learning environment built with World Labs-style scenes.

`boba-arcade-mandarin` is the package name for this first scenario, not the long-term product name.

## Elevator Pitch

Language practice works best when it has a place, a task, and a little social pressure. A specific scenario like ordering boba turns vocabulary into action: the learner sees the counter, reads the menu, hears the cashier, asks for exactly what they want, repairs mistakes, and gets feedback in the same context where the language would be used in real life. The value is not just speech recognition or a pretty 3D scene; it is rehearsing a real interaction until the learner can walk into that situation with confidence.

## Current Experience

- `開始挑戰`: scripted arcade rounds with a target drink order, line-pressure feedback, pass/fail scoring, and saved receipts.
- `自由練習`: open-ended ordering practice where the cashier asks natural follow-up questions.
- Public web mode: when Gemini is disabled or unavailable, the cashier moves aside and the player orders from an in-scene kiosk with no microphone permission and no Gemini API calls.
- Speech input works through gaze focus on the cashier or a manual talk button.
- The app transcribes speech, extracts order details, asks for missing fields, confirms the order, and saves receipts in `localStorage` under `boba-receipts`.
- The live ordering UI is rendered inside the Three.js scene so it remains visible in WebXR/headset mode.

## Product Direction

This repo is now organized around a scenario registry. The boba shop is still the proving ground, but its metadata, copy, task hooks, kiosk labels, scene assets, menu boards, parser hooks, objectives, and scoring hooks live under `src/scenarios/bobaTeaShop/` instead of being owned by the top-level app.

Scenario-specific data should become swappable over time:

- language and locale, such as `zh-TW` or `fr-FR`
- vocabulary, parser aliases, and task objectives
- NPC persona, prompt instructions, and voice choices
- menu boards, signs, receipt labels, and UI copy
- scoring rules and learning feedback
- world splats, colliders, characters, and ambient audio

The boba shop remains the proving ground. Avoid broad abstraction for its own sake; extract scenario data when it helps ship the next environment or removes an obvious hardcoded assumption.

## Scenario System

Scenarios are registered in `src/scenarios/registry.ts`. Each scenario exports a `ScenarioDefinition` from `src/scenarios/<scenarioId>/index.ts`.

A scenario definition owns:

- main-menu card metadata
- locale and intro copy
- app branding and runtime dialogue lines
- world, collider, character, receipt, and menu-board scene config
- task helpers for describing orders, totals, missing fields, objective matching, and defaults
- parser hooks for deterministic speech parsing and order merging
- free-flow prompt/advice hooks
- arcade objectives
- kiosk labels, option translations, pronunciation hints, storage keys, and receipt building
- scoring/share-text hooks

To add a scenario:

1. Create `src/scenarios/newScenario/`.
2. Export a complete `ScenarioDefinition`.
3. Add it to `scenarios` in `src/scenarios/registry.ts`.
4. Add any assets under `public/assets/`.
5. Run `npm run build`.

The top-level app consumes the active scenario from the registry. Avoid adding new scenario-specific branches in `src/App.tsx` or `src/three/BobaScene.tsx` unless the runtime needs a new extension point.

## Runtime Loop

```text
scenario data
  -> world, locale, vocabulary, objectives, NPC persona
player mic
  -> realtime transcription
  -> local parser / intent extraction
  -> scenario state update
  -> NPC response
  -> spoken audio + in-world UI
```

For the current Mandarin boba scenario:

```text
player mic
  -> Gemini Live transcription
  -> local Taiwan boba parser
  -> order state update
  -> cashier response
  -> Gemini Live audio output
```

Gemini intent calls enrich free-flow or ambiguous turns. The local parser should stay the fast path whenever it can confidently update the scenario.

## Tech Stack

- Vite 7, React 19, TypeScript
- Three.js and WebXR
- `@sparkjsdev/spark` for Gaussian splat rendering
- Gemini Live for realtime speech transcription and NPC speech
- Gemini TTS and browser speech APIs as fallbacks
- Optional NVIDIA ASR/TTS/Omni experiment hooks

## Run Locally

```sh
npm install
npm run dev
```

Open the URL Vite prints, usually:

```text
http://127.0.0.1:5173/
```

Useful scripts:

```sh
npm run dev        # Start Vite
npm run build      # Typecheck and build
npm run preview    # Preview the production build
npm run typecheck  # Run TypeScript without emitting files
```

## Gemini Setup

Gemini cashier mode is deliberately off unless both a key and the manual public switch are present. This keeps a public deployment from spending API quota by default.

```sh
GEMINI_PUBLIC_ENABLED=1 GEMINI_API_KEY=... npm run dev
# or put both values in .env.local
```

If `GEMINI_PUBLIC_ENABLED` is missing or not `1`, the app starts in kiosk mode. If the flag is `1` but the key is missing, it also falls back to kiosk mode. In kiosk mode the client does not request mic access and should not call Gemini endpoints.

Local routes installed by `vite.config.ts`:

- `GET /api/gemini/live/status`
- `POST /api/gemini/live-token`
- `POST /api/gemini/order-intent`
- `POST /api/gemini/tts`

For Vercel, the same paths are handled by `api/gemini/[...path].ts`. To let people try cashier voice mode for a short window, set `GEMINI_PUBLIC_ENABLED=1` and `GEMINI_API_KEY` in the deployment environment, redeploy, then turn the flag off and redeploy when the demo window is over.

The raw Gemini key stays server-side. Public POST routes reject cross-origin browser requests, enforce small JSON body limits and simple per-IP rate limits, and issue short-lived one-use Live tokens.

Default model and voice overrides:

```sh
GEMINI_LIVE_MODEL='gemini-3.1-flash-live-preview'
GEMINI_INTENT_MODEL='gemini-3.1-flash-lite'
GEMINI_TTS_MODEL='gemini-2.5-flash-preview-tts'
VITE_GEMINI_CASHIER_VOICE='Aoede'
VITE_GEMINI_ANNOUNCER_VOICE='Zephyr'
VITE_GEMINI_SYSTEM_VOICE='Kore'
```

## Project Map

```text
.
├── DESIGN.md                 # Product feel, UI, and WebXR notes
├── VIVE_FOCUS_TESTING.md     # HTC VIVE Focus testing guide
├── api/gemini/               # Vercel Gemini API routes, gated by GEMINI_PUBLIC_ENABLED
├── public/assets/            # World, character, and audio assets
├── scripts/brev/             # Optional NVIDIA NIM startup helpers
└── src/
    ├── App.tsx               # Main simulator state and conversation flow
    ├── game/                 # Current boba scenario data, parser, rounds, scoring
    ├── scenarios/            # Scenario registry and scenario definitions
    ├── three/BobaScene.tsx   # Three.js scene, gaze focus, panels, receipt display
    ├── voice/                # Gemini, browser, NVIDIA, radio, and success cue code
    └── styles/app.css
```

Important files:

- `src/scenarios/types.ts`: scenario contract used by the app and scene.
- `src/scenarios/registry.ts`: list of available scenarios and the default scenario.
- `src/scenarios/bobaTeaShop/`: current boba scenario definition.
- `src/game/menu.ts`: boba vocabulary, menu options, order formatting.
- `src/game/kiosk.ts`: offline kiosk cart, receipt, and public-mode state helpers.
- `src/game/parser.ts`: deterministic Mandarin order parser.
- `src/game/geminiIntent.ts`: Gemini enrichment for free-flow intent.
- `src/game/rounds.ts`: scripted challenge objectives.
- `src/game/scoring.ts`: receipt scoring and persistence.
- `src/voice/geminiLiveVoice.ts`: primary voice provider.
- `vite.config.ts`: Vite config and local API proxy routes.

## Assets

The current boba scenario uses:

- `/assets/world/cozy-boba-shop.spz`
- `/assets/world/cozy-anime-boba-shop-collider.glb`
- `/assets/characters/aki/aki-cashier.glb`
- `/assets/characters/universal-base/Superhero_Male_FullBody.gltf`
- `/assets/audio/radio/*.mp3`
- `/assets/audio/sfx/victory-mandarin-applause.mp3`

Future scenarios should provide their own world, collider, characters, ambient audio, signs/menu text, locale, and task data.

## Debug URLs

- `/?noXr=1`: disables the WebXR button.
- `/?avatar=glb`: uses GLTF customer avatars.
- `/?bare=1`: hides added signs, cashier flow, and NPC props for calibration.
- `/?simpleSplat=1`: renders a generated debug splat.
- `/?flip=1`: flips the splat orientation.
- `/?cam=x,y,z`: overrides camera position.
- `/?target=x,y,z`: overrides the initial look target.
- `/?splat=x,y,z`: offsets the world splat.
- `/?splatScale=n`: changes splat scale.
- `/?fov=n`: changes camera field of view.

## Optional NVIDIA Hooks

Legacy NVIDIA paths remain for experiments, but they are not the main product path:

- `parakeet-ctc-0.6b-zh-tw` streaming ASR
- `magpie-tts-multilingual` streaming TTS
- `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` proxy experiments

Helper scripts live in `scripts/brev`.

## Known Gaps

- The scenario contract still uses the current boba-shaped `Order` model; the next non-boba scenario should drive a more generic task-state model if needed.
- Some reusable boba helpers still live in `src/game/` as compatibility modules for the extracted boba scenario.
- Automated smoke tests are not wired into the repo.
- Desktop browser is the main development loop; WebXR is available for immersive testing.
