# Wedding game invitation — implementation plan

## Product idea
Mobile-first web invitation as a short 2D pixel side-scroller: "Путь к Кате". The game is a 30–60 second intro, not a barrier. Every core wedding detail is also available through normal UI blocks and a "Пропустить игру" action.

## Source of truth
Use `data/wedding.json` for all text, dates, timing and location. Do not bake important text into generated images.

## Architecture
- Framework: Next.js / Vite React + TypeScript.
- Game layer: Phaser 3 recommended for fast mobile 2D platformer; Three.js is optional only for decorative parallax, not for gameplay.
- Rendering: 2D canvas, fixed internal game resolution, responsive scale to mobile viewport.
- Content: JSON-driven copy and timeline.
- RSVP: link/button to current анкета or custom form.
- Fallback: static invitation sections visible without game.

## Gameplay structure
1. Intro / tap to start.
2. Level 1 — "Собраться": collect suit, bow tie, ring, bouquet, envelope.
3. Level 2 — "Не опоздать": avoid traffic, deadline stack, rain cloud, forgotten jacket.
4. Level 3 — "Добраться до места": evening embankment, lights, signs to Balinsky Mansion.
5. Finale: groom reaches bride under floral arch, unlocks invitation actions.

## Mobile controls
- Default: auto-runner.
- Tap: jump.
- Long press: higher jump or glide.
- Swipe down: duck only if needed; otherwise avoid extra mechanics.
- Always show "Пропустить игру".

## Asset pipeline with Codex image2sprite skill
Use the generated concept only as style/layout reference. The production sprites must be regenerated as clean transparent assets.

Recommended flow:
1. Put concept references into `/art/reference/`.
2. For each object/person, run image2sprite with:
   - transparent background
   - pixel-art output
   - consistent 32/48/64 px grid
   - no text baked into sprites
   - 2x or 4x nearest-neighbor export
3. Save outputs in `/public/assets/sprites/` and `/public/assets/tilesets/`.
4. Build animation JSON/atlas through TexturePacker, free-tex-packer, or Phaser atlas.
5. Review sprites on real mobile scale before adding polish.

## First asset list
### Characters
- groom_idle, groom_run_6f, groom_jump, groom_land
- bride_idle, bride_wave, bride_final_hug/idle_pair

### Collectibles
- ring, heart, bouquet, envelope, bow_tie, suit

### Obstacles
- traffic_car, traffic_cone, deadline_stack, rain_cloud, forgotten_jacket, puddle

### Environment
- embankment_tileset, platform_tileset, railing, lamp_post, tree, flower_arch, mansion_silhouette, Neva/water parallax, SPb skyline parallax

### UI
- hud_panel, heart_icon, ring_icon, pause_button, info_card_panel, primary_button, secondary_button, pixel_palette_swatches

## What not to do
- Do not copy Nintendo/Mario visuals directly.
- Do not bake dates/addresses into images.
- Do not make 3D first-person controls on mobile.
- Do not force users to complete the game to see wedding details.
