# Codex task: build mobile wedding invitation game prototype

You are working on a mobile-first wedding invitation web game called "Путь к Кате".

## Goal
Build a small 2D side-scroller / auto-runner intro that unlocks the wedding invitation details. Use the supplied concept references only for visual direction; do not bake key copy into image files.

## Source data
Read `data/wedding.json` and render all text from it.

## Tech constraints
- TypeScript.
- Prefer Phaser 3 for gameplay. Use React/Next/Vite for site shell.
- Mobile-first: portrait layout, 390px wide as primary target, responsive up to desktop.
- Tap to jump. Include "Пропустить игру".
- Keep bundle lightweight.

## Use image2sprite skill
For each sprite in the list below, use the image2sprite skill to regenerate a clean transparent pixel-art sprite/animation from the reference concept style.
Do not crop production sprites from the concept mockup except for temporary placeholders.

### Generate sprites
- groom: idle, run 6 frames, jump, land
- bride: idle, wave
- collectibles: ring, heart, bouquet, envelope, bow_tie, suit
- obstacles: traffic_car, traffic_cone, deadline_stack, rain_cloud, forgotten_jacket, puddle
- environment: embankment tiles, railing, lamp post, flower arch, mansion silhouette, water parallax, Saint Petersburg skyline parallax
- UI: hud panel, heart icon, ring icon, info card panel, primary button, secondary button

## Game scenes
1. BootScene: preload assets.
2. IntroScene: title "Путь к Кате", tap to start.
3. LevelScene: auto-runner with 3 themed segments.
4. FinaleScene: final invitation actions.
5. DetailsOverlay: timing, location, dress code, details.

## Acceptance criteria
- Works smoothly on mobile Safari/Chrome.
- Wedding information matches `data/wedding.json`.
- No important text is baked into sprite images.
- Game is skippable.
- Static invitation details are accessible without completing the game.
