#!/usr/bin/env python3
"""Chroma-key + de-spill + de-fringe + auto-slice the v3 green-screen sheets
into individual transparent PNG sprites.

Usage:
    python extract_v3.py <sheet.jpeg> <out_dir> [--min-area N] [--gap R]

Produces out_dir/sprite-NN.png (sorted top-to-bottom, left-to-right) plus a
contact sheet out_dir/_contact.png and prints a bbox table for naming.
"""
import sys, os, argparse
import numpy as np
from PIL import Image


def key_mask(rgb):
    """True where pixel is FOREGROUND (not the green screen)."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    # green screen: green clearly dominant and bright (tolerant for JPEG noise)
    green = (g > 90) & (g > r * 1.25) & (g > b * 1.25)
    return ~green


def erode(mask, iters=1):
    m = mask
    for _ in range(iters):
        out = m.copy()
        out[:-1] &= m[1:]
        out[1:] &= m[:-1]
        out[:, :-1] &= m[:, 1:]
        out[:, 1:] &= m[:, :-1]
        m = out
    return m


def dilate(mask, iters=1):
    m = mask
    for _ in range(iters):
        out = m.copy()
        out[:-1] |= m[1:]
        out[1:] |= m[:-1]
        out[:, :-1] |= m[:, 1:]
        out[:, 1:] |= m[:, :-1]
        m = out
    return m


def despill(rgb, mask):
    """Pull green-tinted edge pixels back toward neutral."""
    out = rgb.copy().astype(int)
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    spill = mask & (g > r) & (g > b)
    cap = np.maximum(r, b)
    g[spill] = np.minimum(g[spill], cap[spill] + 8)
    return np.clip(out, 0, 255).astype(np.uint8)


def label_cc(mask):
    """Two-pass connected-component labeling (4-connectivity) in pure numpy/python."""
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    parent = [0]

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    nxt = 1
    for y in range(h):
        row = mask[y]
        lrow = labels[y]
        prev = labels[y - 1] if y > 0 else None
        prevm = mask[y - 1] if y > 0 else None
        for x in range(w):
            if not row[x]:
                continue
            left = lrow[x - 1] if x > 0 and row[x - 1] else 0
            up = prev[x] if prev is not None and prevm[x] else 0
            if left and up:
                m = left if left < up else up
                lrow[x] = m
                union(left, up)
            elif left:
                lrow[x] = left
            elif up:
                lrow[x] = up
            else:
                lrow[x] = nxt
                parent.append(nxt)
                nxt += 1
    # resolve
    flat = labels.ravel()
    nz = flat > 0
    flat[nz] = [find(v) for v in flat[nz]]
    return labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out_dir")
    ap.add_argument("--min-area", type=int, default=900, help="min sprite area (full-res px)")
    ap.add_argument("--gap", type=int, default=7, help="grouping radius (full-res px)")
    ap.add_argument("--ds", type=int, default=2, help="downscale factor for labeling")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    im = Image.open(args.sheet).convert("RGB")
    rgb = np.array(im)
    H, W = rgb.shape[:2]

    fg = key_mask(rgb)
    fg = erode(fg, 1)          # kill the 1px JPEG fringe
    rgb = despill(rgb, fg)

    # group nearby parts of one object, on a downscaled mask, for labeling speed
    ds = args.ds
    grp = dilate(fg, max(1, args.gap // ds * ds))
    small = grp[::ds, ::ds]
    labels_s = label_cc(small)

    boxes = []
    for lab in np.unique(labels_s):
        if lab == 0:
            continue
        ys, xs = np.where(labels_s == lab)
        x0, x1 = xs.min() * ds, (xs.max() + 1) * ds
        y0, y1 = ys.min() * ds, (ys.max() + 1) * ds
        # measure real area within the (un-dilated) fg
        sub = fg[y0:y1, x0:x1]
        area = int(sub.sum())
        if area >= args.min_area:
            boxes.append((y0, x0, y1, x1, area))

    # sort into reading order: rows top→bottom, then left→right
    boxes.sort(key=lambda b: (round(b[0] / 60), b[1]))

    print(f"{os.path.basename(args.sheet)}: {len(boxes)} sprites")
    contact_cells = []
    for i, (y0, x0, y1, x1, area) in enumerate(boxes, 1):
        # pad 2px, clamp
        py0, px0 = max(0, y0 - 2), max(0, x0 - 2)
        py1, px1 = min(H, y1 + 2), min(W, x1 + 2)
        crop_rgb = rgb[py0:py1, px0:px1]
        crop_a = (fg[py0:py1, px0:px1].astype(np.uint8)) * 255
        out = np.dstack([crop_rgb, crop_a])
        Image.fromarray(out, "RGBA").save(os.path.join(args.out_dir, f"sprite-{i:02d}.png"))
        print(f"  {i:02d}: pos=({x0:4d},{y0:4d}) size={px1-px0:4d}x{py1-py0:4d} area={area}")
        contact_cells.append(Image.fromarray(out, "RGBA"))

    # contact sheet for visual verification (on dark bg)
    if contact_cells:
        cols = 5
        cw = max(c.width for c in contact_cells) + 16
        ch = max(c.height for c in contact_cells) + 28
        rows = (len(contact_cells) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cw, rows * ch), (22, 30, 55, 255))
        for idx, c in enumerate(contact_cells):
            cx = (idx % cols) * cw + (cw - c.width) // 2
            cy = (idx // cols) * ch + (ch - c.height) // 2
            sheet.alpha_composite(c, (cx, cy))
        sheet.save(os.path.join(args.out_dir, "_contact.png"))


if __name__ == "__main__":
    main()
