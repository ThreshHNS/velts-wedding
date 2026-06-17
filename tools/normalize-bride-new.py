#!/usr/bin/env python3
"""Normalize the two new bride illustrations (idle + wave) as a matched pair.

Registration: scale each by head->feet distance (head detected in the right
portion of the bbox to ignore the raised wave arm), align feet to a common
baseline and the dress/hip x to a common center. Both get the same declared
contentHeight so the intro idle<->wave swap has no size/position jump.

Preview by default; --apply writes game files + spriteBounds.json.
"""
import sys, os, json
from PIL import Image
import numpy as np

ROOT = "/Users/a.velts/Documents/wedding"
SRC = f"{ROOT}/public/assets/game/characters/run-new"
OUT_GAME = f"{ROOT}/public/assets/game/characters"
PREVIEW = f"{ROOT}/docs/run-new-preview"
BOUNDS = f"{ROOT}/src/data/spriteBounds.json"

FRAMES = [("bride-idle-src", "bride-idle"), ("bride-wave-src", "bride-wave")]
REF_H = 238            # match existing bride contentHeight
PADX, PADTOP, PADBOT = 18, 18, 4
A = 128                 # figure is fully opaque; ignore the soft glow halo around it

def analyze(path):
    im = Image.open(path).convert("RGBA")
    al = np.asarray(im)[:, :, 3]
    ys, xs = np.where(al > A)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    feet = y1
    # head top = topmost opaque row in the RIGHT 55% of bbox (skips raised arm)
    rx0 = x0 + int(0.45 * (x1 - x0))
    sub = al[:, rx0:x1 + 1]
    rys = np.where(sub > A)[0]
    head_top = rys.min()
    # hip x = horizontal center of opaque span at ~62% down (waist/skirt top)
    yhip = int(y0 + 0.62 * (y1 - y0))
    band = al[max(0, yhip - 8):yhip + 8] > A
    bxs = np.where(band.any(0))[0]
    hip_x = (bxs.min() + bxs.max()) // 2 if len(bxs) else (x0 + x1) // 2
    return {"im": im, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "feet": feet, "head_top": head_top, "hip_x": hip_x,
            "body_h": feet - head_top}

def main():
    apply = "--apply" in sys.argv
    os.makedirs(PREVIEW, exist_ok=True)
    fr = [(analyze(f"{SRC}/{src}.png"), key) for src, key in FRAMES]

    scaled = []
    for d, key in fr:
        k = REF_H / d["body_h"]
        crop = d["im"].crop((d["x0"], d["y0"], d["x1"] + 1, d["y1"] + 1))
        nw = max(1, round(crop.width * k)); nh = max(1, round(crop.height * k))
        crop = crop.resize((nw, nh), Image.LANCZOS)
        scaled.append({
            "img": crop, "key": key, "w": nw, "h": nh,
            "hip_dx": (d["hip_x"] - d["x0"]) * k,      # hip x within crop
            "feet_dy": (d["feet"] - d["y0"]) * k,       # feet y within crop (~= nh)
        })

    # shared canvas: hips aligned to anchor_x, feet aligned to baseline
    anchor_x = round(max(s["hip_dx"] for s in scaled)) + PADX
    right = round(max(s["w"] - s["hip_dx"] for s in scaled)) + PADX
    canvas_w = anchor_x + right
    canvas_h = REF_H + PADTOP + PADBOT
    baseline = canvas_h - PADBOT

    bounds = json.load(open(BOUNDS))
    outdir = OUT_GAME if apply else PREVIEW
    strip = Image.new("RGBA", (canvas_w * 2, canvas_h), (0, 0, 0, 0))
    onion = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    for i, s in enumerate(scaled):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        px = round(anchor_x - s["hip_dx"])
        py = round(baseline - s["feet_dy"])
        canvas.alpha_composite(s["img"], (px, py))
        canvas.save(f"{outdir}/{s['key']}.png")
        strip.alpha_composite(canvas, (i * canvas_w, 0))

        layer = canvas.copy()
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * 0.45)))
        onion.alpha_composite(layer)

        al = np.asarray(canvas)[:, :, 3]
        ys, xs = np.where(al > A)
        bounds[s["key"]] = {
            "contentWidth": int(xs.max() - xs.min() + 1),
            "contentHeight": REF_H,
            "textureWidth": canvas_w,
            "textureHeight": canvas_h,
        }

    strip.save(f"{PREVIEW}/_bride_strip.png")
    onion.save(f"{PREVIEW}/_bride_onion.png")
    print(f"canvas={canvas_w}x{canvas_h}  anchor_x={anchor_x}  -> {'APPLIED' if apply else 'preview only'}")
    for s in scaled:
        print(f"  {s['key']}: scaled {s['w']}x{s['h']}")
    if apply:
        json.dump(bounds, open(BOUNDS, "w"), indent=2)
        print("bounds updated")

if __name__ == "__main__":
    main()
