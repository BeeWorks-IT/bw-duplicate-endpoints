#!/usr/bin/env python3
"""Generate docs/catalog-banner.png (1200x600) for the catalog card.

Pure PIL, no network. Run: python scripts/make_banner.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 600
BG = (11, 18, 32)
PANEL = (17, 26, 44)
STROKE = (42, 56, 82)
TEXT = (232, 238, 247)
MUTED = (148, 163, 184)
ACCENT = (245, 184, 65)
GREEN = (74, 222, 128)

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default()


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # honeycomb hint, top-right
    for i, (cx, cy) in enumerate([(1050, 70), (1110, 105), (1050, 140), (1110, 35)]):
        r = 26
        pts = [(cx + r * 0.866, cy + r * 0.5), (cx, cy + r), (cx - r * 0.866, cy + r * 0.5),
               (cx - r * 0.866, cy - r * 0.5), (cx, cy - r), (cx + r * 0.866, cy - r * 0.5)]
        d.polygon(pts, outline=ACCENT if i == 0 else STROKE, width=2)

    d.text((64, 56), "Community plugin", font=font(30, True), fill=ACCENT)
    d.text((64, 100), "Hermes Duplicate Settings", font=font(52, True), fill=TEXT)
    d.text((64, 178), "Custom endpoints across Hermes profiles — keys optional,", font=font(24), fill=MUTED)
    d.text((64, 210), "validated, confirmed, verified.", font=font(24), fill=MUTED)

    # diagram: source profile -> two targets
    src = (64, 300, 384, 520)
    rounded(d, src, 14, PANEL, STROKE, 2)
    d.text((88, 320), "profile: rh", font=font(22, True), fill=TEXT)
    rounded(d, (88, 360, 360, 404), 8, BG, STROKE, 1)
    d.text((102, 370), "Refuseless.ai  ·  8 models", font=font(18), fill=MUTED)
    rounded(d, (88, 416, 360, 460), 8, BG, STROKE, 1)
    d.text((102, 426), "Local Lab  ·  key in .env", font=font(18), fill=MUTED)
    d.ellipse((88, 478, 100, 490), fill=GREEN)
    d.text((110, 474), "source", font=font(18), fill=MUTED)

    for y, label in [(330, "profile: cto"), (440, "profile: secretariat")]:
        box = (560, y, 900, y + 90)
        rounded(d, box, 14, PANEL, STROKE, 2)
        d.text((584, y + 14), label, font=font(22, True), fill=TEXT)
        d.text((584, y + 48), "endpoint copied  ✓ verified", font=font(18), fill=GREEN)
        d.line((384, 410, 560, y + 45), fill=ACCENT, width=3)
        d.polygon([(560, y + 45), (548, y + 39), (548, y + 51)], fill=ACCENT)

    rounded(d, (940, 330, 1136, 530), 14, PANEL, STROKE, 2)
    d.text((962, 350), "with or", font=font(20), fill=MUTED)
    d.text((962, 378), "without", font=font(20), fill=MUTED)
    d.text((962, 406), "API keys", font=font(20, True), fill=ACCENT)
    d.text((962, 452), "SDK-only", font=font(18), fill=MUTED)
    d.text((962, 480), "MIT", font=font(18), fill=MUTED)

    d.text((64, 556), "Settings ▸ Plugins ▸ Duplicate Custom Endpoints", font=font(18), fill=MUTED)

    out = ROOT / "docs" / "catalog-banner.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"wrote {out} ({W}x{H})")


if __name__ == "__main__":
    main()
