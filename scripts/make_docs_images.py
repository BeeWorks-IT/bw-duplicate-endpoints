#!/usr/bin/env python3
"""Generate the explanatory README images (pure PIL, no network).

Run: python scripts/make_docs_images.py
Outputs: docs/install-flow.png, docs/workflow.png, docs/profiles-page.png,
         docs/key-handling.png, docs/architecture.png
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
RED = (248, 113, 113)
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


def chip(d, x, y, text, color=MUTED, fill=PANEL2, size=16):
    f = font(size)
    tw = d.textlength(text, font=f)
    box(d, (x, y, x + tw + 24, y + size + 14), fill=fill, outline=STROKE, r=8, w=1)
    d.text((x + 12, y + 7), text, font=f, fill=color)
    return tw + 24


def arrow(d, x1, y1, x2, y2, color=ACCENT, w=3):
    d.line((x1, y1, x2, y2), fill=color, width=w)
    if x2 >= x1:
        d.polygon([(x2, y2), (x2 - 12, y2 - 7), (x2 - 12, y2 + 7)], fill=color)
    else:
        d.polygon([(x2, y2), (x2 + 12, y2 - 7), (x2 + 12, y2 + 7)], fill=color)


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name)
    print(f"wrote docs/{name} ({img.width}x{img.height})")


# ---------------------------------------------------------------------------
def install_flow():
    img, d = canvas(1280, 460, "Install in 4 steps",
                    "Desktop half on the machine running the app; backend on the gateway host.")
    steps = [
        ("1 · Install", ["Desktop: Capabilities ▸", "Plugins ▸ Install from Git:", "BeeWorks-IT/", "bw-duplicate-endpoints", "", "or CLI:", "hermes plugins install \\", "  BeeWorks-IT/", "  bw-duplicate-endpoints"]),
        ("2 · Enable", ["hermes plugins enable \\", "  bw-duplicate-endpoints", "", "Enable for each profile that", "serves the page (the Profiles", "sub-page can do it for you)."]),
        ("3 · Restart gateway", ["Backend routes mount", "at startup:", "", "systemctl restart \\", "  hermes-serve", "", "The Desktop app reconnects", "automatically."]),
        ("4 · Open the page", ["Settings ▸ Plugins", "▸ Hermes Duplicate Settings", "", "Switch the Desktop half on in", "Capabilities ▸ Plugins", "(opt-in by default)."]),
    ]
    x = 48
    for title, lines in steps:
        box(d, (x, 120, x + 276, 420))
        d.text((x + 18, 138), title, font=font(20, True), fill=ACCENT)
        y = 176
        for line in lines:
            mono = line.strip().startswith(("hermes", "systemctl", "BeeWorks-IT/", "bw-duplicate-endpoints"))
            d.text((x + 18, y), line, font=font(13, mono=mono), fill=TEXT if mono else MUTED)
            y += 22
        if x < 900:
            arrow(d, x + 280, 270, x + 296, 270)
        x += 300
    save(img, "install-flow.png")


# ---------------------------------------------------------------------------
def workflow():
    img, d = canvas(1200, 600, "Duplication workflow",
                    "Every run: form validation → confirmation matrix → writes through Hermes → read-back verification.")
    cards = [
        ("1 · Source", 48, [
            "Profile selector + counts",
            "Rows: name · URL · model",
            "Badges: key / active / legacy",
            "Search + “with key only” filter",
            "Per-row connection Test",
            "Select all · Clear · Probe sel.",
        ]),
        ("2 · Destination", 424, [
            "Targets (source excluded)",
            "“updates N / skips N” badges",
            "All / None helpers",
            "Copy API keys (default on)",
            "Probe first · set default (off)",
            "Conflicts: Update / Skip",
        ]),
        ("3 · Validation & run", 800, [
            "Summary: N endpoints × M targets",
            "Selection hints gate the button",
            "Confirm: per-target matrix",
            "create/update/skip · key action",
            "Verified badge per write",
            "Per-endpoint/target errors",
        ]),
    ]
    for title, x, lines in cards:
        box(d, (x, 120, x + 352, 470))
        d.text((x + 20, 140), title, font=font(22, True), fill=ACCENT)
        y = 186
        for line in lines:
            d.text((x + 20, y), "• " + line, font=font(15), fill=TEXT)
            y += 34
        if x < 800:
            arrow(d, x + 356, 295, x + 372, 295)
    box(d, (48, 500, 1152, 566), fill=PANEL2)
    d.text((68, 520), "Safety: a target’s active model never changes unless “set as default” is ticked — and that is confirmed separately.",
           font=font(17), fill=MUTED)
    save(img, "workflow.png")


# ---------------------------------------------------------------------------
def profiles_page():
    img, d = canvas(1200, 560, "Profiles sub-page",
                    "One card per Hermes profile: state, inventory, metadata, backend enablement, default route.")
    box(d, (48, 120, 760, 520))
    d.ellipse((70, 146, 84, 160), fill=GREEN)
    d.text((96, 140), "rh", font=font(24, True), fill=TEXT)
    x = 140
    for label, color in [("default", ACCENT), ("gateway running", GREEN), ("alias: rh", MUTED)]:
        x += chip(d, x, 142, label, color=color) + 10
    d.text((70, 186), "Gestion, rh, social", font=font(17), fill=MUTED)
    x = 70
    for label in ["refuseless-test / deepseek-v4.1-flash", "2 endpoints", "1 keys", "42 skills"]:
        x += chip(d, x, 222, label, size=15) + 10
    box(d, (70, 272, 738, 330), fill=PANEL2)
    d.text((88, 288), "Plugin backend enabled", font=font(17, True), fill=TEXT)
    d.rounded_rectangle((660, 286, 716, 314), radius=14, fill=ACCENT)
    d.ellipse((690, 290, 710, 310), fill=BG)
    d.text((88, 344), "Default model route", font=font(16), fill=MUTED)
    box(d, (70, 372, 560, 414), fill=PANEL2)
    d.text((88, 382), "Refuseless.ai (deepseek-v4.1-flash)  ▾", font=font(16), fill=TEXT)
    box(d, (580, 372, 700, 414), fill=PANEL2, outline=ACCENT)
    d.text((606, 382), "Activate", font=font(16, True), fill=ACCENT)
    d.text((70, 444), "Duplicate from this profile", font=font(16), fill=ACCENT)
    d.text((360, 444), "Edit (display name · description)", font=font(16), fill=ACCENT)
    d.text((70, 480), "Activate asks for confirmation — it changes the profile’s active model.", font=font(15), fill=MUTED)

    box(d, (800, 120, 1152, 520))
    d.text((822, 140), "What you can do", font=font(20, True), fill=ACCENT)
    lines = [
        "See gateway state, active route,",
        "endpoint / key / skill counts.",
        "",
        "Edit display name + description",
        "(Hermes’ profile.yaml writer).",
        "",
        "Enable/disable the plugin backend",
        "per profile (admission transaction).",
        "",
        "Activate a default model route.",
        "",
        "Jump into duplication with the",
        "profile preselected as source.",
    ]
    y = 184
    for line in lines:
        d.text((822, y), line, font=font(16), fill=TEXT if line else MUTED)
        y += 24
    save(img, "profiles-page.png")


# ---------------------------------------------------------------------------
def key_handling():
    img, d = canvas(1200, 480, "API keys never leave Hermes’ credential path",
                    "Optional copy: resolved and stored by Hermes itself — never shown, never written to config.yaml.")
    box(d, (48, 140, 300, 300))
    d.text((68, 158), "Source profile", font=font(19, True), fill=TEXT)
    d.text((68, 196), ".env", font=font(17, mono=True), fill=ACCENT)
    d.text((68, 226), "SRC_API_KEY=***", font=font(15, mono=True), fill=MUTED)
    d.text((68, 256), "config.yaml: key_env", font=font(15, mono=True), fill=MUTED)

    box(d, (380, 140, 660, 300))
    d.text((400, 158), "Hermes secret scope", font=font(19, True), fill=TEXT)
    d.text((400, 196), "get_secret(NAME)", font=font(16, mono=True), fill=ACCENT)
    d.text((400, 226), "profile-scoped read", font=font(15), fill=MUTED)
    d.text((400, 256), "no direct .env parsing", font=font(15), fill=MUTED)

    box(d, (740, 140, 1020, 300))
    d.text((760, 158), "Target profile", font=font(19, True), fill=TEXT)
    d.text((760, 196), "store_secret(...)", font=font(16, mono=True), fill=ACCENT)
    d.text((760, 226), ".env ← key value", font=font(15, mono=True), fill=MUTED)
    d.text((760, 256), "config.yaml ← key_env", font=font(15, mono=True), fill=MUTED)

    arrow(d, 304, 220, 376, 220)
    arrow(d, 664, 220, 736, 220)
    d.text((318, 190), "value", font=font(14), fill=MUTED)
    d.text((676, 190), "value", font=font(14), fill=MUTED)

    box(d, (48, 340, 1152, 440), fill=PANEL2)
    d.text((68, 356), "UI + API responses: only “API key / no key” badges — never the value.", font=font(17), fill=GREEN)
    d.text((68, 388), "Keys off: existing target keys are kept; new endpoints arrive keyless. Cross-endpoint overwrite guard applies.",
           font=font(16), fill=MUTED)
    save(img, "key-handling.png")


# ---------------------------------------------------------------------------
def architecture():
    img, d = canvas(1200, 500, "Architecture — one package, two halves",
                    "The backend drives the same handlers as Settings ▸ Model ▸ Custom endpoints. Nothing is monkey-patched.")
    box(d, (48, 140, 330, 320))
    d.text((68, 158), "Desktop app", font=font(20, True), fill=TEXT)
    d.text((68, 196), "desktop/plugin.js", font=font(16, mono=True), fill=ACCENT)
    d.text((68, 226), "settings page + palette", font=font(15), fill=MUTED)
    d.text((68, 252), "SDK-only imports", font=font(15), fill=MUTED)
    d.text((68, 278), "EN / FR · React Query", font=font(15), fill=MUTED)

    box(d, (430, 140, 760, 320))
    d.text((450, 158), "Gateway / serve", font=font(20, True), fill=TEXT)
    d.text((450, 196), "/api/plugins/", font=font(15, mono=True), fill=ACCENT)
    d.text((450, 220), "  bw-duplicate-endpoints/", font=font(15, mono=True), fill=ACCENT)
    d.text((450, 252), "plugin_api.py → core.py", font=font(15, mono=True), fill=MUTED)
    d.text((450, 278), "profile scope + config lock", font=font(15), fill=MUTED)

    box(d, (860, 140, 1152, 320))
    d.text((880, 158), "Hermes handlers", font=font(20, True), fill=TEXT)
    d.text((880, 196), "custom-endpoint CRUD", font=font(15), fill=MUTED)
    d.text((880, 222), "profiles / write_meta", font=font(15), fill=MUTED)
    d.text((880, 248), "plugin admission", font=font(15), fill=MUTED)
    d.text((880, 274), "secret scope / store", font=font(15), fill=MUTED)

    arrow(d, 334, 230, 426, 230)
    d.text((342, 200), "ctx.rest", font=font(15, mono=True), fill=ACCENT)
    arrow(d, 764, 230, 856, 230)
    d.text((774, 200), "in-process", font=font(14), fill=MUTED)

    box(d, (430, 380, 1152, 460), fill=PANEL2)
    d.text((450, 398), "Per profile: config.yaml + .env (keys) + profile.yaml — atomic writes",
           font=font(15, mono=True), fill=TEXT)
    arrow(d, 1006, 324, 1006, 376)
    save(img, "architecture.png")


if __name__ == "__main__":
    install_flow()
    workflow()
    profiles_page()
    key_handling()
    architecture()
