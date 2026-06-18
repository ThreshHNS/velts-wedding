# Project Notes

This is a wedding invitation project.

## Scope

- The game is considered finished. Do not change game logic, levels, sprites, or Phaser code unless explicitly asked.
- Most new work should be limited to the landing page design.
- Landing page files live under public/main/.
- Root app/game files live under src/ and should usually be left untouched.

## Common Commands

- Install dependencies: npm ci
- Run locally: npm run dev
- Production check: npm run build

## Editing Rules

- Keep changes small and visual when working on the landing page.
- Do not commit generated folders such as dist, node_modules, .venv, or zip files.
- Before finishing, run npm run build.
- Prefer editing existing HTML/CSS/JS structure over introducing new frameworks.

## Key Files

- Landing HTML: public/main/index.html
- Landing styles: public/main/style.css
- Landing behavior: public/main/script.js
- Landing assets: public/main/figma-export/
- Game entry/app code: src/
