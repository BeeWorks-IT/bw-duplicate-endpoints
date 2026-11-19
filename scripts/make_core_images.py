#!/usr/bin/env python3
"""Generate the New-endpoint / core-seam explanatory images (pure PIL, no network).

Run: python scripts/make_core_images.py
Outputs: docs/new-endpoint-form.png, docs/core-seam-editor.png, docs/core-seam-flow.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"

BG = (11, 18, 32)
PANEL = (17, 26, 44)
PANEL2 = (22, 33, 56)
STROKE = (42, 56, 82)
TEXT = (232, 238, 247)
MUTED = (148, 163, 184)
ACCENT = (245, 184, 65)
GREEN = (74, 222, 128)
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(size, bold=False, mono=False):
    name = "DejaVuSansMono.ttf" if mono else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default()


def canvas(w, h, title, subtitle=None):
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((48, 32), title, font=font(30, True), fill=TEXT)
    if subtitle:
        d.text((48, 74), subtitle, font=font(18), fill=MUTED)
    return img, d


def box(d, xy, fill=PANEL, outline=STROKE, r=12, w=2):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=w)


def arrow(d, x1, y1, x2, y2, color=ACCENT, w=3):
    d.line((x1, y1, x2, y2), fill=color, width=w)
    d.polygon([(x2, y2), (x2 - 12, y2 - 7), (x2 - 12, y2 + 7)], fill=color)


def check(d, x, y, on=True, label="", size=18):
    box(d, (x, y, x + size, y + size), fill=PANEL2, outline=ACCENT if on else STROKE, r=4, w=2)
    if on:
        d.line((x + 4, y + size // 2, x + size // 2 - 1, y + size - 5), fill=ACCENT, width=2)
        d.line((x + size // 2 - 1, y + size - 5, x + size - 4, y + 4), fill=ACCENT, width=2)
    if label:
        d.text((x + size + 10, y - 1), label, font=font(17), fill=TEXT)


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name)
    print(f"wrote docs/{name} ({img.width}x{img.height})")


# ---------------------------------------------------------------------------
def new_endpoint_form():
    img, d = canvas(1200, 620, "New endpoint — create once, choose profiles",
                    "Plugin sub-page: one form, a checkbox list of profiles, validation and read-back verification.")
    cards = [
        ("1 · Endpoint details", 48, [
            "Name · Provider ID (optional)",
            "Base URL · Default model",
            "API key (optional, password field)",
            "Transport: Auto / Chat / Responses",
            "Context length (optional)",
            "Discover models · Set as default",
        ]),
        ("2 · Create on profiles", 424, [
            "Every profile on the host,",
            "with its endpoint count.",
        ]),
        ("3 · Validation & create", 800, [
            "Missing-field hints gate the button",
            "Confirm dialog lists the targets",
            "Each write: Hermes save handler",
            "Key stored by Hermes per profile",
            "Read-back: verified badge",
            "Per-profile error reporting",
        ]),
    ]
    for title, x, lines in cards:
        box(d, (x, 120, x + 352, 480))
        d.text((x + 20, 140), title, font=font(21, True), fill=ACCENT)
        y = 186
        for line in lines:
            d.text((x + 20, y), ("• " + line) if line else "", font=font(15), fill=TEXT)
            y += 34
        if x < 800:
            arrow(d, x + 356, 300, x + 372, 300)
    # profile checkboxes illustration inside card 2
    check(d, 444, 260, True, "default")
    check(d, 444, 296, True, "cto")
    check(d, 444, 332, False, "rh")
    check(d, 444, 368, True, "secretariat")
    d.text((444, 412), "Tick at least one profile.", font=font(15), fill=MUTED)
    box(d, (48, 510, 1152, 580), fill=PANEL2)
    d.text((68, 530), "Same safety as duplication: keys never inline, never shown; a target's active model changes only if you tick it.",
           font=font(16), fill=MUTED)
    save(img, "new-endpoint-form.png")


# ---------------------------------------------------------------------------
def core_seam_editor():
    img, d = canvas(1200, 660, "The seam in the core editor (once #157898 ships)",
                    "Settings ▸ Providers ▸ Custom Endpoints — core fields unchanged; the plugin block slots in.")
    # editor card
    box(d, (48, 120, 780, 620))
    d.text((70, 140), "Add endpoint", font=font(22, True), fill=TEXT)
    # core fields (simplified rows)
    for y, label, value in [(186, "Name", "My endpoint"), (232, "Base URL", "https://api.example.com/v1"),
                            (278, "Default model", "model-id")]:
        d.text((70, y), label, font=font(14), fill=MUTED)
        box(d, (220, y - 6, 756, y + 26), fill=PANEL2, r=6, w=1)
        d.text((234, y), value, font=font(15, mono=True), fill=TEXT)
    check(d, 70, 330, True, "Use for new chats")
    check(d, 300, 330, True, "Discover models")
    # plugin contribution block (highlighted)
    box(d, (70, 376, 756, 500), fill=PANEL2, outline=ACCENT, r=10, w=2)
    d.text((90, 392), "Also create on other profiles", font=font(17, True), fill=ACCENT)
    d.text((90, 420), "After Save, copied to the checked profiles (with its key).", font=font(14), fill=MUTED)
    check(d, 90, 452, True, "cto", size=16)
    check(d, 200, 452, True, "secretariat", size=16)
    check(d, 400, 452, False, "rh", size=16)
    # core buttons
    box(d, (70, 524, 180, 566), fill=PANEL2, r=8, w=1)
    d.text((102, 534), "Test", font=font(16), fill=TEXT)
    box(d, (196, 524, 310, 566), fill=ACCENT, r=8, w=1)
    d.text((228, 534), "Save", font=font(16, True), fill=BG)
    d.text((70, 584), "Core keeps the fields, validation and the save path.", font=font(14), fill=MUTED)
    # annotation panel
    box(d, (820, 120, 1152, 620))
    d.text((842, 140), "What the plugin gets", font=font(20, True), fill=ACCENT)
    lines = [
        "profile — editor scope",
        "",
        "draft — read-only snapshot:",
        "name, URL, model, flags,",
        "hasApiKey (never the value)",
        "",
        "saved — after a successful Save:",
        "id, name, base_url, model,",
        "has_api_key, savedAt",
        "",
        "saving — save in flight",
        "",
        "Rendered in its own error",
        "boundary; renders null when",
        "it has nothing to offer.",
        "",
        "Older hosts: area absent,",
        "registration skipped.",
    ]
    y = 184
    for line in lines:
        mono = line.startswith(("profile", "draft", "saved", "saving", "name,", "id,", "hasApiKey"))
        d.text((842, y), line, font=font(14, mono=mono), fill=TEXT if line else MUTED)
        y += 24
    arrow(d, 790, 438, 816, 438)
    save(img, "core-seam-editor.png")


# ---------------------------------------------------------------------------
def core_seam_flow():
    img, d = canvas(1200, 440, "How the seam works end to end",
                    "The plugin never touches core markup: it registers on customEndpoint.form and reacts to the save.")
    steps = [
        ("1 · Tick profiles", ["Plugin block inside the", "core editor: check the", "profiles to receive the", "endpoint."]),
        ("2 · Save (core)", ["The user presses Save.", "Core validates and saves", "on the scoped profile —", "the path is unchanged."]),
        ("3 · Save notification", ["Contributions receive", "saved { id, has_api_key,", "savedAt } — savedAt changes", "on every save."]),
        ("4 · Copy (plugin)", ["Plugin backend duplicates", "to the checked profiles via", "Hermes handlers; read-back", "verification per profile."]),
    ]
    x = 48
    for title, lines in steps:
        box(d, (x, 120, x + 264, 360))
        d.text((x + 18, 138), title, font=font(19, True), fill=ACCENT)
        y = 180
        for line in lines:
            d.text((x + 18, y), line, font=font(15), fill=TEXT)
            y += 26
        if x < 900:
            arrow(d, x + 268, 240, x + 288, 240)
        x += 288
    box(d, (48, 384, 1152, 424), fill=PANEL2)
    d.text((68, 394), "Keys resolve through Hermes' secret scope only — the draft snapshot carries hasApiKey, never the value.",
           font=font(15), fill=MUTED)
    save(img, "core-seam-flow.png")


if __name__ == "__main__":
    new_endpoint_form()
    core_seam_editor()
    core_seam_flow()
