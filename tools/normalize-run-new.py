#!/usr/bin/env python3
"""Slice new run-pose pairs, tight-crop by alpha, and normalize all frames to a
common scale + feet baseline + hip-x center so the run loop has no bob/slide.

Outputs to a preview dir by default; pass --apply to write game files + bounds.
"""
import sys, json
from PIL import Image
import numpy as np

ROOT = "/Users/a.velts/Documents/wedding"
SRC = f"{ROOT}/public/assets/game/characters/run-new"
OUT_GAME = f"{ROOT}/public/assets/game/characters"
PREVIEW = f"{ROOT}/docs/run-new-preview"
BOUNDS = f"{ROOT}/src/data/spriteBounds.json"

# (file, half) in run-cycle order: contact -> passing -> high -> extension
FRAMES = [("pair-1", 0), ("pair-1", 1), ("pair-3", 0), ("pair-3", 1)]
KEYS = ["groom-run-1", "groom-run-2", "groom-run-3", "groom-run-4"]

ALPHA = 20
REF_CONTENT_H = 219      # match current groom-run content height
PAD_X, PAD_TOP, PAD_BOT = 18, 18, 4

def load_half(name, half):
    im = Image.open(f"{SRC}/{name}.png").convert("RGBA")
    a = np.asarray(im)
    hw = a.shape[1] // 2
    return a[:, half*hw:(half+1)*hw, :]

def bbox(al):
    ys, xs = np.where(al > ALPHA)
    return xs.min(), ys.min(), xs.max(), ys.max()

def hip_x(al, y0, y1):
    yhip = int(y0 + 0.58*(y1-y0))
    band = al[yhip-8:yhip+8] > ALPHA
    xs = np.where(band.any(0))[0]
    return (xs.min()+xs.max())//2 if len(xs) else (al.shape[1]//2)

def main():
    apply = "--apply" in sys.argv
    import os
    os.makedirs(PREVIEW, exist_ok=True)

    raw = []
    for name, half in FRAMES:
        sub = load_half(name, half)
        al = sub[:, :, 3]
        x0, y0, x1, y1 = bbox(al)
        hx = hip_x(al, y0, y1)
        crop = sub[y0:y1+1, x0:x1+1, :]
        raw.append({"img": crop, "h": y1-y0+1, "w": x1-x0+1, "hip_dx": hx - x0})

    # single uniform scale: tallest pose -> REF_CONTENT_H
    max_h = max(r["h"] for r in raw)
    k = REF_CONTENT_H / max_h

    scaled = []
    for r in raw:
        nw, nh = max(1, round(r["w"]*k)), max(1, round(r["h"]*k))
        img = Image.fromarray(r["img"]).resize((nw, nh), Image.LANCZOS)
        scaled.append({"img": img, "w": nw, "h": nh, "hip_dx": r["hip_dx"]*k})

    # common canvas: width fits widest + pad; height = REF + pads
    max_w = max(s["w"] for s in scaled)
    max_hip = max(s["hip_dx"] for s in scaled)
    canvas_w = round(max_w + 2*PAD_X)
    canvas_h = round(REF_CONTENT_H + PAD_TOP + PAD_BOT)
    # hip anchor x in canvas: center of mass-ish, keep widest frame inside
    anchor_x = canvas_w // 2

    bounds = json.load(open(BOUNDS))
    outdir = OUT_GAME if apply else PREVIEW
    strip = Image.new("RGBA", (canvas_w*4, canvas_h), (0,0,0,0))

    for i, (s, key) in enumerate(zip(scaled, KEYS)):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0,0,0,0))
        px = round(anchor_x - s["hip_dx"])
        py = canvas_h - PAD_BOT - s["h"]          # feet -> baseline
        px = max(0, min(px, canvas_w - s["w"]))
        canvas.alpha_composite(s["img"], (px, py))
        canvas.save(f"{outdir}/{key}.png")
        strip.alpha_composite(canvas, (i*canvas_w, 0))

        # content metrics for bounds (declare uniform contentHeight for stable scale)
        al = np.asarray(canvas)[:, :, 3]
        ys, xs = np.where(al > ALPHA)
        bounds[key] = {
            "contentWidth": int(xs.max()-xs.min()+1),
            "contentHeight": REF_CONTENT_H,           # uniform -> no in-game resize jitter
            "textureWidth": canvas_w,
            "textureHeight": canvas_h,
        }

    # onion-skin overlay for inspection
    overlay = Image.new("RGBA", (canvas_w, canvas_h), (0,0,0,0))
    for s in scaled:
        layer = Image.new("RGBA", (canvas_w, canvas_h), (0,0,0,0))
        px = round(anchor_x - s["hip_dx"]); py = canvas_h - PAD_BOT - s["h"]
        px = max(0, min(px, canvas_w - s["w"]))
        layer.alpha_composite(s["img"].point(lambda v: v), (px, py))
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v*0.4)))
        overlay.alpha_composite(layer)

    strip.save(f"{PREVIEW}/_strip.png")
    overlay.save(f"{PREVIEW}/_onion.png")
    print(f"scale k={k:.4f}  canvas={canvas_w}x{canvas_h}  -> {'APPLIED to game' if apply else 'preview only'}")
    print("strip:", f"{PREVIEW}/_strip.png", " onion:", f"{PREVIEW}/_onion.png")
    if apply:
        json.dump(bounds, open(BOUNDS, "w"), indent=2)
        print("bounds updated:", BOUNDS)

if __name__ == "__main__":
    main()
