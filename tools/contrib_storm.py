#!/usr/bin/env python3
"""Contribution storm: renders the last year of GitHub contributions as a pixel-art SVG.

A small storm cloud drifts across the calendar and strikes the brightest day of every active week
(the busiest days get a double strike); the brain-bot from the header walks underneath, looking up.
Pure SVG + CSS animation, no scripts or external assets, so it plays inside a README <img>.

    python3 tools/contrib_storm.py --user msgenan --out dist/contrib-storm.svg
    python3 tools/contrib_storm.py --data calendar.json --out contrib-storm.svg   # offline

The token is read from GITHUB_TOKEN (or GH_TOKEN); the Actions GITHUB_TOKEN is enough.
"""
import argparse
import json
import math
import os
import random
import re
import urllib.request

QUERY = """query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{
  totalContributions weeks{contributionDays{date contributionCount contributionLevel weekday}}}}}}"""


def fetch(user):
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    req = urllib.request.Request("https://api.github.com/graphql",
                                 data=json.dumps({"query": QUERY, "variables": {"u": user}}).encode(),
                                 headers={"Authorization": f"bearer {token}", "User-Agent": "contrib-storm"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# ------------------------------------------------------------------ pixel canvas
def path_d(pixels):
    """Pixels -> one compact path: row runs merged into rectangles."""
    rows = {}
    for x, y in pixels:
        rows.setdefault(y, []).append(x)
    runs = {}
    for y, xs in rows.items():
        xs.sort()
        r, s, p = [], xs[0], xs[0]
        for x in xs[1:]:
            if x == p + 1:
                p = x
                continue
            r.append((s, p - s + 1))
            s = p = x
        r.append((s, p - s + 1))
        runs[y] = r
    rects, live = [], {}
    for y in sorted(runs):
        cur, nxt = set(runs[y]), {}
        for key, (y0, h) in live.items():
            if key in cur and y0 + h == y:
                nxt[key] = (y0, h + 1)
                cur.discard(key)
            else:
                rects.append((key[0], y0, key[1], h))
        for key in cur:
            nxt[key] = (y, 1)
        live = nxt
    rects += [(k[0], y0, k[1], h) for k, (y0, h) in live.items()]
    rects.sort(key=lambda r: (r[1], r[0]))
    out, px, py = [], None, None
    for x, y, w, h in rects:
        out.append(f"M{x} {y}" if px is None else f"m{x - px} {y - py}")
        out.append(f"h{w}v{h}h-{w}z")
        px, py = x, y
    return "".join(out)


class Pix:
    def __init__(self):
        self.p = {}

    def set(self, x, y, c):
        self.p[(x, y)] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.p[(xx, yy)] = c
        return self

    def ascii(self, rows, pal, ox=0, oy=0):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in pal:
                    self.p[(ox + i, oy + j)] = pal[ch]
        return self

    def disc(self, cx, cy, r, c, sy=1.0):
        for y in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 2):
            for x in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 2):
                if (x + .5 - cx) ** 2 + ((y + .5 - cy) * sy) ** 2 <= r * r:
                    self.p[(x, y)] = c
        return self

    def svg(self, attrs=""):
        by = {}
        for xy, c in self.p.items():
            by.setdefault(c, []).append(xy)
        body = "".join(f'<path fill="{c}" d="{path_d(v)}"/>' for c, v in by.items())
        return f"<g{attrs}>{body}</g>" if attrs else body


# ------------------------------------------------------------------ CSS keyframe compiler
class Anim:
    """Every track is a step-end keyframe list over one shared loop, so all changes land on one frame grid."""

    def __init__(self, T, fps=24):
        self.T, self.fps, self.css, self._kf = T, fps, [], {}

    def hold(self, el, events, dur=None):
        dur = dur or self.T
        frames, last = [], None
        for t, css in sorted(events, key=lambda e: e[0]):
            if css != last:
                frames.append((t, css))
                last = css
        if frames[0][0] > 1e-9:
            frames.insert(0, (0, frames[-1][1]))
        if len(frames) == 1:
            self.css.append(f"#{el}{{{frames[0][1]}}}")
            return
        pc = lambda u: f"{u * 100:.3f}".rstrip("0").rstrip(".") + "%"  # noqa: E731
        body = "".join(f"{pc(t / dur)}{{{c}}}" for t, c in frames) + f"100%{{{frames[-1][1]}}}"
        name = self._kf.get(body)
        if not name:
            name = self._kf[body] = f"k{len(self._kf)}"
            self.css.append(f"@keyframes {name}{{{body}}}")
        self.css.append(f"#{el}{{animation:{name} {dur:g}s step-end infinite}}")

    def sample(self, el, fn, fps=None):
        fps = fps or self.fps
        self.hold(el, [(i / fps, fn(i / fps)) for i in range(round(self.T * fps))])


def tr(x, y):
    return f"transform:translate({x}px,{y}px)"


def vis(on):
    return "visibility:visible" if on else "visibility:hidden"


# ------------------------------------------------------------------ the brain-bot (same sprite as the header)
HEAD = [
    "........bbbbbbbb........",
    "......bbcdddedddbb......",
    ".....bcdedddeddeddb.....",
    "....bfdddeddedddeddb....",
    "....bdedddddeddedddb....",
    "....bddededdedddedeb....",
    "....bdddddddeddddddb....",
]
PAL = {"b": "#9ed9f2", "c": "#ffffff", "f": "#d9f2ff", "d": "#f5a8bd", "e": "#d16b87"}
BODY, SHADE, EYE = "#d97757", "#b05b41", "#211a17"
LEVEL = {"NONE": "#262840", "FIRST_QUARTILE": "#5a3f66", "SECOND_QUARTILE": "#9a5480",
         "THIRD_QUARTILE": "#d16b87", "FOURTH_QUARTILE": "#f5a8bd"}
RANK = {k: i for i, k in enumerate(LEVEL)}


FONT = {
    "A": [".#.", "#.#", "###", "#.#", "#.#"], "B": ["##.", "#.#", "##.", "#.#", "##."],
    "C": [".##", "#..", "#..", "#..", ".##"], "D": ["##.", "#.#", "#.#", "#.#", "##."],
    "E": ["###", "#..", "##.", "#..", "###"], "F": ["###", "#..", "##.", "#..", "#.."],
    "G": [".##", "#..", "#.#", "#.#", ".##"], "J": ["..#", "..#", "..#", "#.#", ".#."],
    "L": ["#..", "#..", "#..", "#..", "###"], "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
    "N": ["#..#", "##.#", "#.##", "#..#", "#..#"], "O": [".#.", "#.#", "#.#", "#.#", ".#."],
    "P": ["##.", "#.#", "##.", "#..", "#.."], "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "S": [".##", "#..", ".#.", "..#", "##."], "T": ["###", ".#.", ".#.", ".#.", ".#."],
    "U": ["#.#", "#.#", "#.#", "#.#", "###"], "V": ["#.#", "#.#", "#.#", "#.#", ".#."],
    "Y": ["#.#", "#.#", ".#.", ".#.", ".#."],
}


def text(pix, s, x, y, color):
    for ch in s:
        for j, row in enumerate(FONT[ch]):
            for i, c in enumerate(row):
                if c == "#":
                    pix.set(x + i, y + j, color)
        x += len(FONT[ch][0]) + 1


def render(cal):
    weeks = cal["weeks"]
    T, FPS = 14.0, 24
    PITCH, CELL = 4, 3
    GX, GY = 14, 17
    W = GX * 2 + PITCH * len(weeks) - 1
    H = 70
    FEET = 66
    an = Anim(T, FPS)
    defs, L = [], []

    # background: night panel, faint stars, roof line
    bg = Pix().rect(0, 0, W, H, "#1a1c29")
    rng = random.Random(len(weeks))
    for _ in range(26):
        bg.set(rng.randrange(W), rng.randrange(1, 14), rng.choice(["#3d4166", "#565c8a", "#2e3150"]))
    bg.rect(0, FEET + 1, W, 1, "#2b2e47")
    bg.rect(0, FEET + 2, W, H - FEET - 2, "#20223a")
    L.append(bg.svg())

    # the calendar
    grid = Pix()
    cells = {}
    for wi, wk in enumerate(weeks):
        for dday in wk["contributionDays"]:
            x, y = GX + wi * PITCH, GY + dday["weekday"] * PITCH
            grid.rect(x, y, CELL, CELL, LEVEL[dday["contributionLevel"]])
            cells[(wi, dday["weekday"])] = dday
    L.append(grid.svg())

    # month labels (3x5 pixel font), dim, above the first week of each month
    MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
    lab = Pix()
    last = None
    for wi, wk in enumerate(weeks):
        m = int(wk["contributionDays"][0]["date"][5:7])
        if m != last and wi < len(weeks) - 2 and (last is not None or wk["contributionDays"][0]["date"][8:] <= "07"):
            text(lab, MONTHS[m - 1], GX + wi * PITCH, GY - 7, "#3d4166")
        last = m
    L.append(lab.svg())

    # cloud path and strike schedule: brightest day of every active week
    C0, C1 = 0.4, T - 1.6
    cx0, cx1 = -26, W + 26

    def cloud_x(t):
        return cx0 + (cx1 - cx0) * min(1, max(0, (t - C0) / (C1 - C0)))

    def time_at(x):
        return C0 + (x - cx0) / (cx1 - cx0) * (C1 - C0)

    counts = sorted((d["contributionCount"] for d in cells.values() if d["contributionCount"]), reverse=True)
    top = set(counts[:3])
    strikes = []
    for wi, wk in enumerate(weeks):
        best = max(wk["contributionDays"], key=lambda d: (RANK[d["contributionLevel"]], d["contributionCount"]))
        if best["contributionCount"] == 0:
            continue
        x = GX + wi * PITCH + 1
        ts = round(time_at(x) * FPS) / FPS  # keep every change on the shared frame grid
        strikes.append((ts, wi, best["weekday"], best["contributionCount"] in top))

    def bolt(x, y1, seed):
        r = random.Random(seed)
        core, glow = Pix(), Pix()
        y, cx = 13, x + r.choice([-2, 2])
        while y < y1:
            core.set(cx, y, "#ffffff")
            y += 1
            if y % 2 == 0 and y < y1 - 1:
                cx += max(-1, min(1, x - cx + r.choice([-1, 0, 1])))
        for (px, py) in list(core.p):
            for dx in (-1, 1):
                if (px + dx, py) not in core.p:
                    glow.set(px + dx, py, "#8fa3ff")
        return glow.svg() + core.svg()

    FLASH = [(0, True), (1, True), (2, False), (3, True)]
    for k, (ts, wi, wd, big) in enumerate(strikes):
        x, y = GX + wi * PITCH, GY + wd * PITCH
        L.append(f'<g id="b{k}">{bolt(x + 1, y, k)}</g>')
        hot = Pix().rect(x, y, CELL, CELL, "#ffffff")
        for dx, dy in ((-1, 1), (CELL, 1), (1, -1), (1, CELL)):
            hot.set(x + dx, y + dy, "#fff4a3")
        L.append(hot.svg(f' id="h{k}"'))
        L.append(Pix().rect(x, y, CELL, CELL, "#ffd6a0").svg(f' id="y{k}"'))
        L.append(Pix().rect(x, y, CELL, CELL, "#ff8fb0").svg(f' id="g{k}"'))
        hits = [ts] + ([ts + 5 / FPS] if big else [])
        ev_b, ev_h = [(0, vis(False))], [(0, vis(False))]
        for th in hits:
            for f, on in FLASH:
                ev_b.append((th + f / FPS, vis(on)))
            ev_b.append((th + 4 / FPS, vis(False)))
            ev_h += [(th, vis(True)), (th + 4 / FPS, vis(False))]
        end = hits[-1]
        an.hold(f"b{k}", ev_b)
        an.hold(f"h{k}", ev_h)
        an.hold(f"y{k}", [(0, vis(False)), (end + 4 / FPS, vis(True)), (end + 8 / FPS, vis(False))])
        an.hold(f"g{k}", [(0, vis(False)), (end + 8 / FPS, vis(True)), (end + 16 / FPS, vis(False))])

    # the storm cloud (lit from below, lights up on every strike)
    cl, lit = Pix(), Pix()
    for (px, py, pr) in ((6, 7, 4.5), (12, 5, 5.5), (18, 7, 4.5), (9, 9, 3.5), (15, 9, 3.8)):
        cl.disc(px, py, pr, "#2f3150")
    base = {xy for xy in cl.p if xy[1] <= 11}
    cl.p = {xy: "#2f3150" for xy in base}
    for (px, py) in base:
        if (px, py + 1) not in base:
            cl.p[(px, py)] = "#5b4a74"
            lit.set(px, py, "#c9c6f5")
        elif (px, py - 1) not in base:
            cl.p[(px, py)] = "#44476e"
            lit.set(px, py, "#9da2e0")
        else:
            lit.set(px, py, "#6d71b0")
    L.append('<g id="cloud">' + cl.svg() + lit.svg(' id="cl"') + "</g>")
    an.sample("cloud", lambda t: tr(round(cloud_x(t)) - 12, 1 + (1 if math.floor(t * 2) % 2 else 0)), 12)
    flashing = lambda t: any(0 <= (t - ts) * FPS < 2 or (big and 5 <= (t - ts) * FPS < 7)  # noqa: E731
                             for ts, _w, _d, big in strikes)
    an.sample("cl", lambda t: vis(flashing(t)))

    # rain under the cloud
    rain = Pix()
    for i, (dx, dy) in enumerate(((2, 14), (7, 12), (12, 15), (17, 13), (21, 14), (4, 18), (10, 20), (16, 17))):
        rain.set(dx, dy, "#6f7bb0")
        rain.set(dx, dy + 1, "#6f7bb0")
    L.append(f'<g id="rain"><g id="rn">{rain.svg()}</g></g>')
    an.sample("rain", lambda t: tr(round(cloud_x(t)) - 12, 0), 12)
    an.hold("rn", [(k / 12, tr(-(k % 3), 2 * (k % 3))) for k in range(3)], 3 / 12)

    # the brain-bot walks along underneath, a few pixels behind the cloud, and hops on each strike
    bot = Pix().ascii(HEAD, PAL)
    bot.rect(3, 7, 18, 6, BODY).rect(3, 13, 18, 1, SHADE)
    bot.rect(0, 10, 3, 2, BODY).rect(21, 10, 3, 2, BODY)
    eyes = Pix().rect(8, 8, 2, 2, EYE).rect(16, 8, 2, 2, EYE)
    legs = [Pix(), Pix(), Pix()]
    for x in (4, 7, 15, 18):
        legs[0].rect(x, 14, 2, 1, BODY).rect(x, 15, 2, 1, SHADE)
    for x, lifted in ((4, 1), (7, 0), (15, 1), (18, 0)):
        legs[1].rect(x, 14, 2, 1, SHADE if lifted else BODY)
        if not lifted:
            legs[1].rect(x, 15, 2, 1, SHADE)
    for x, lifted in ((4, 0), (7, 1), (15, 0), (18, 1)):
        legs[2].rect(x, 14, 2, 1, SHADE if lifted else BODY)
        if not lifted:
            legs[2].rect(x, 15, 2, 1, SHADE)
    L.append('<g id="bot">' + "".join(l.svg(f' id="l{i}"') for i, l in enumerate(legs)) +
             bot.svg() + eyes.svg() + "</g>")
    L.append('<g id="sh"><path fill="#15162a" d="M3 %dh18v1h-18z"/></g>' % (FEET + 1))

    def bot_x(t):
        return round(cloud_x(max(C0, t - .9))) - 12

    def hop(t):
        for ts, *_r in strikes:
            f = (t - ts) * FPS
            if 1 <= f < 7:
                return [0, 2, 3, 3, 2, 1][int(f) - 1]
        return 0

    an.sample("bot", lambda t: tr(bot_x(t), FEET - 15 - hop(t) - (1 if math.floor(t * 9) % 2 else 0) * (hop(t) == 0)))
    an.sample("sh", lambda t: tr(bot_x(t), 0), 12)
    for i in range(3):
        an.sample(f"l{i}", lambda t, i=i: vis(([1, 0, 2, 0][math.floor(t * 9) % 4] if hop(t) == 0 else 0) == i), 12)

    total = cal["totalContributions"]
    # fade in once when the image arrives (0.5 s, on the 24 fps grid), so it does not pop in after the text
    css = "".join(an.css) + "@keyframes intro{from{opacity:0}to{opacity:1}}.intro{animation:intro .5s steps(12,end) both}"
    css += ("@media (prefers-reduced-motion:reduce){*{animation-delay:-6s!important;"
            "animation-play-state:paused!important}}")
    fr = [f"M3 0H{W - 3}V1H{W - 1}V3H{W}V{H - 3}H{W - 1}V{H - 1}H{W - 3}V{H}H3V{H - 1}H1V{H - 3}H0V3H1V1H3Z"]
    defs.append(f'<clipPath id="frm"><path d="{fr[0]}"/></clipPath>')
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W * 4}" height="{H * 4}" viewBox="0 0 {W} {H}" '
         f'shape-rendering="crispEdges"><title>{total} contributions in the last year, struck by a small storm'
         f"</title><defs>{''.join(defs)}</defs><style>{css}</style>"
         f'<g class="intro" clip-path="url(#frm)">{"".join(L)}</g></svg>')
    # shorten animated ids
    ids = list(dict.fromkeys(re.findall(r"#([A-Za-z_][\w-]*)\{", css)))
    mp = {i: "i" + format(n, "x") for n, i in enumerate(ids)}
    s = re.sub(r'id="([\w-]+)"', lambda m: f'id="{mp.get(m.group(1), m.group(1))}"', s)
    s = re.sub(r"#([A-Za-z_][\w-]*)\{", lambda m: f"#{mp.get(m.group(1), m.group(1))}{{", s)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="msgenan")
    ap.add_argument("--data", help="calendar JSON from a previous GraphQL call (offline)")
    ap.add_argument("--out", default="dist/contrib-storm.svg")
    a = ap.parse_args()
    raw = json.load(open(a.data)) if a.data else fetch(a.user)
    cal = raw["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    svg = render(cal)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, "w").write(svg)
    print(f"{a.out}  {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
