# Sprite forge pipeline

This prototype uses `0x0funky/agent-sprite-forge` as the asset workflow reference.

## Inputs

- `asset-pack/reference_slices/contact_sheet.png` is a style reference only.
- `public/assets/raw/*.png` are raw image-generation outputs.
- Original generated files remain in `/Users/a.velts/.codex/generated_images/019ecd76-5c0f-7d40-849c-ab17dd322d30/`.

## Local processor

The deterministic scripts from `agent-sprite-forge` are vendored under `tools/sprite-forge/`.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/sprite-forge/requirements.txt
.venv/bin/python tools/sprite-forge/generate2dsprite.py process \
  --input public/assets/raw/groom_run_raw.png \
  --target asset \
  --mode run \
  --rows 2 \
  --cols 3 \
  --label-prefix groom-run \
  --cell-size 160 \
  --output-dir public/assets/sprites/groom_run \
  --align feet \
  --shared-scale \
  --component-mode largest \
  --fit-scale 0.9
```

The same command shape is used for collectibles, obstacles, environment props, and wedding character sheets. Generated `pipeline-meta.json` files contain QC details such as `edge_touch_frames`.

## Rule

Sprites and scenery are images; dates, address, timeline, dress code, and RSVP text come from `src/data/wedding.json`.
