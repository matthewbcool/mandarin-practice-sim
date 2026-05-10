---
title: "珍奶快打 UI Direction"
owner: "Codex"
last_updated: "2026-05-09"
---

# Product Feel

珍奶快打 is a first-person arcade roleplay simulator, not a dashboard. The scene carries the experience; UI should feel like small in-world surfaces, receipts, tickets, and cashier cues.

# Principles

- Gameplay UI is glanceable, quiet, and removable from the player's center view.
- Live ordering information belongs on WebXR-visible Three.js surfaces.
- DOM overlays are reserved for pre-round selection, debugging, settings, technical recovery, and post-round receipts.
- Mandarin is the default surface. English or pinyin appears only when a setting explicitly enables it.
- Keep the cashier, counter, menu boards, drink, and reticle readable at all times.

# Tokens

```css
--panel-bg: rgba(48, 45, 24, 0.72);
--panel-border: rgba(241, 231, 200, 0.16);
--text-main: #fff5d8;
--text-muted: rgba(255, 245, 216, 0.72);
--accent-sage: #9fb88f;
--accent-matcha: #b8c98f;
--accent-cream: #f1e7c8;
--accent-gold: #846f18;
--danger-soft: #bd7659;
--radius-control: 8px;
```

# Palette

The current palette comes from the provided reference: sage green, matcha green, warm cream, and antique gold. Use the greens for calm learning states, cream for tickets and receipts, and gold only as a small accent so it feels premium instead of loud.

# Surfaces

- Objective ticket: visible only during briefing, then disappears.
- Cashier line: small in-world speech surface near the counter, below the menu boards.
- Current order: small in-world POS-like status surface, shown only after something has been recognized.
- Pressure: quiet in-world cue that appears only after the line starts getting impatient.
- HUD: compact desktop-only testing strip; it should not teach the primary interaction model.
- Receipt: larger DOM card is acceptable because the round is over.

# WebXR Notes

- Any UI needed during live ordering must be available inside the Three.js scene.
- Avoid DOM-only dependencies for the headset path after the round starts.
- Prefer fixed, low counter-height panels over floating center-screen panels.
- Keep gaze focus visually subtle until listening starts.
