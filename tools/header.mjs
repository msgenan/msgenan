// Generates the animated profile header: light streaming past a dark sphere and
// breaking into a Kármán vortex street.
//
//   node tools/header.mjs      -> assets/header-dark.svg, assets/header-light.svg
//
// No dependencies. The flow is a 2D potential flow (uniform stream + doublet +
// circulation) around a cylinder, plus a vortex street that is shed behind it,
// drifts downstream and dies out, plus a little curl noise. Streamlines are
// iso-lines of the stream function, so they crowd together exactly where the
// flow is fast.
//
// Animation, all SMIL (works inside <img>), all seamless:
//  - the wake is computed at K phases of one shedding period and the streamlines
//    and eddy rings are morphed between them. After one period every vortex sits
//    where its neighbour-but-one started, so the loop closes like a conveyor belt
//    (lines in the heart of the street are cut into pieces that ride that belt);
//  - comets ride the streamlines at the local flow speed (faster round the sphere).
// prefers-reduced-motion swaps all of it for one frozen frame.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- parameters
const W = 1200, H = 340;          // viewBox
const PAD = 60;                   // the field extends past the frame so line ends stay hidden
const CX = 318, CY = 170, A = 64; // the sphere
const U = 1;                      // free-stream speed (psi units per px)
const GAMMA = 70;                 // circulation round the sphere, breaks the symmetry a little
const SPACING = 4.1;              // streamline spacing upstream, px
const GRID = 1.25;                // contouring resolution, px
const PX_PER_S = 185;             // free-stream speed on screen
const STREET = 150;               // distance between two vortices of the same row
const DRIFT = 50;                 // how fast the street drifts, px/s
const PERIOD = STREET / DRIFT;    // one shedding period = the loop
const K = 6;                      // keyframes per period
const XS = CX;                    // streamlines are static left of this x, morphing right of it
const SEED = 20260924;

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const f2 = (x) => (Math.round(x * 100) / 100).toString();
const f3 = (x) => (Math.round(x * 1000) / 1000).toString();
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]); return L; };

function perlin(seed) {
  const r = mulberry32(seed);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = [], gy = [];
  for (let i = 0; i < 16; i++) { gx.push(Math.cos(i * Math.PI / 8)); gy.push(Math.sin(i * Math.PI / 8)); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (h, dx, dy) => gx[h & 15] * dx + gy[h & 15] * dy;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v);
  };
}
const noise = perlin(SEED ^ 0x5bd1e995);
const fbm = (x, y) => noise(x, y) + 0.5 * noise(x * 2.03 + 17.1, y * 2.03 - 9.2);

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = len < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// n points evenly spaced by arclength
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const L = cum[cum.length - 1], out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (j < pts.length - 1 && cum[j] < s) j++;
    const u = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push([lerp(pts[j - 1][0], pts[j][0], u), lerp(pts[j - 1][1], pts[j][1], u)]);
  }
  return out;
}

// distance from p to segment ab
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
// fewest evenly spaced points that keep every frame within tol of its true shape
function adaptiveResample(frames, tol, minN, maxN) {
  // iron out marching-squares jitter first (ends stay put)
  frames = frames.map((f) => {
    let g = f;
    for (let it = 0; it < 2; it++) g = g.map((p, i) => (i === 0 || i === g.length - 1 ? p : [(g[i - 1][0] + 2 * p[0] + g[i + 1][0]) / 4, (g[i - 1][1] + 2 * p[1] + g[i + 1][1]) / 4]));
    return g;
  });
  const L = Math.max(...frames.map(polyLen));
  for (const step of [30, 24, 19, 15, 12, 10, 8, 6.5, 5, 4]) {
    const n = clamp(Math.ceil(L / step) + 1, minN, maxN);
    const rs = frames.map((f) => resample(f, n));
    // every coarse point lies on its fine polyline at a known arclength, so each
    // fine point is checked against the chord that spans it
    let ok = true;
    for (let k = 0; k < frames.length && ok; k++) {
      const f = frames[k], r = rs[k], seg = polyLen(f) / (n - 1);
      let s = 0;
      for (let i = 0; i < f.length && ok; i++) {
        if (i) s += dist(f[i], f[i - 1]);
        const q = Math.min(n - 2, Math.floor(s / seg));
        let best = segDist(f[i], r[q], r[q + 1]);
        if (q > 0) best = Math.min(best, segDist(f[i], r[q - 1], r[q]));
        if (q < n - 2) best = Math.min(best, segDist(f[i], r[q + 1], r[q + 2]));
        if (best > tol) ok = false;
      }
    }
    if (ok || n === maxN) return rs;
  }
  return frames.map((f) => resample(f, maxN));
}

// ---------------------------------------------------------------- the field
// Vortex slot k sits at X0V + (k + 2*phi) * STREET/2: after one period (phi 0 -> 1)
// every slot has moved to where slot k+2 started. Strength and core size depend
// on x only, so the field at phi = 1 is exactly the field at phi = 0.
const X0V = CX + A * 1.55, ROW = 58, EDDY = 140;
const SLOTS = [];
for (let k = -2; k <= 16; k++) SLOTS.push(k);
function vortexAt(k, phi) {
  const x = X0V + (k + 2 * phi) * STREET / 2;
  const upper = ((k % 2) + 2) % 2 === 0;
  const env = smooth(X0V - 40, X0V + 80, x) * Math.exp(-(x - X0V) / 560) * (1 - smooth(W + 40, W + 200, x));
  // a Gaussian bump in psi: a shielded eddy with no far field, so the
  // streamlines well above and below the street stay put
  return { k, x, y: CY + (upper ? -ROW / 2 : ROW / 2), g: (upper ? -1 : 1) * EDDY * env, s: 23 + Math.max(0, x - X0V) * 0.012 };
}
const vortices = (phi) => SLOTS.map((k) => vortexAt(k, phi)).filter((v) => Math.abs(v.g) > 1e-4);

// Potential flow round the sphere, plus the wake. The wake terms fade out next
// to the sphere so its surface stays exactly the streamline psi = 0.
function psiRaw(x, y, V) {
  const dx = x - CX, dY = CY - y;
  const r2 = dx * dx + dY * dY, r = Math.sqrt(r2);
  let psi = U * dY * (1 - (A * A) / r2) - (GAMMA / (2 * Math.PI)) * Math.log(r / A);
  let wake = 0;
  for (const v of V) {
    const d2 = (x - v.x) ** 2 + (y - v.y) ** 2;
    if (d2 < 36 * v.s * v.s) wake += v.g * Math.exp(-d2 / (2 * v.s * v.s));
  }
  // curl-noise turbulence confined to a widening wake
  const along = x - (CX + A * 0.6);
  if (along > 0) {
    const width = A * 1.05 + along * 0.2;
    const env = smooth(0, 260, along) * Math.exp(-((dY / width) ** 2)) * (1 - 0.35 * smooth(500, 900, along));
    wake += env * 26 * fbm(x / 115, y / 70);
  }
  // a whisper of large-scale meander everywhere, so nothing is ruler-straight
  wake += 5.5 * noise(x / 420 + 3.1, y / 260 - 7.7) * smooth(-PAD, 200, x);
  return psi + wake * smooth(A * 1.04, A * 1.7, r);
}
function psi(x, y, V) {
  const dx = x - CX, dy = y - CY, r = Math.hypot(dx, dy);
  return r < A ? 0 : psiRaw(x, y, V);
}
// velocity in SVG orientation: vx = -dpsi/dy, vy = dpsi/dx
function vel(x, y, V) {
  const e = 0.35;
  const px = (psi(x + e, y, V) - psi(x - e, y, V)) / (2 * e);
  const py = (psi(x, y + e, V) - psi(x, y - e, V)) / (2 * e);
  return [-py, px];
}

// ---------------------------------------------------------------- contouring
function sampleGrid(x0, y0, nx, ny, g, V) {
  const F = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[j * nx + i] = psi(x0 + i * g, y0 + j * g, V);
  return { F, x0, y0, nx, ny, g };
}

// marching squares; edge keys: horizontal (i,j)-(i+1,j) = 2n, vertical (i,j)-(i,j+1) = 2n+1
function contour({ F, x0, y0, nx, ny, g }, level) {
  const segA = [], segB = [];
  const edgePt = new Map();
  const pt = (key) => {
    let p = edgePt.get(key);
    if (p) return p;
    const n = key >> 1, i = n % nx, j = (n / nx) | 0;
    const a = F[n], b = (key & 1) ? F[n + nx] : F[n + 1];
    const t = (level - a) / (b - a);
    p = (key & 1) ? [x0 + i * g, y0 + (j + t) * g] : [x0 + (i + t) * g, y0 + j * g];
    edgePt.set(key, p);
    return p;
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const n = j * nx + i;
    const a = F[n], b = F[n + 1], c = F[n + nx + 1], d = F[n + nx];
    const idx = ((a > level) << 3) | ((b > level) << 2) | ((c > level) << 1) | (d > level);
    if (idx === 0 || idx === 15) continue;
    const T = 2 * n, B = 2 * (n + nx), L = 2 * n + 1, R = 2 * (n + 1) + 1;
    const add = (p, q) => { segA.push(p); segB.push(q); };
    switch (idx) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(L, T); break;
      case 5: case 10: {
        const center = (a + b + c + d) / 4 > level;
        if ((idx === 5) === center) { add(L, T); add(B, R); } else { add(L, B); add(T, R); }
        break;
      }
    }
  }
  const adj = new Map();
  const link = (k, s) => { const l = adj.get(k); if (l) l.push(s); else adj.set(k, [s]); };
  for (let s = 0; s < segA.length; s++) { link(segA[s], s); link(segB[s], s); }
  const used = new Uint8Array(segA.length);
  const other = (s, k) => (segA[s] === k ? segB[s] : segA[s]);
  const walk = (s0, from) => {
    const keys = [];
    let s = s0, k = from;
    while (s !== undefined && !used[s]) {
      used[s] = 1;
      k = other(s, k);
      keys.push(k);
      s = (adj.get(k) || []).find((q) => !used[q]);
    }
    return keys;
  };
  const lines = [];
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    const start = segA[s];
    const fwd = walk(s, start);
    const nb = (adj.get(start) || []).find((q) => !used[q]);
    const back = nb !== undefined ? walk(nb, start) : [];
    const keys = [...back.reverse(), start, ...fwd];
    const closed = keys.length > 3 && keys[0] === keys[keys.length - 1];
    lines.push({ pts: keys.map(pt), closed });
  }
  return lines;
}

const orient = (pts, V) => {
  const m = pts.length >> 1;
  const p = pts[Math.max(0, m - 1)], q = pts[Math.min(pts.length - 1, m + 1)];
  const [vx, vy] = vel((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, V);
  return (q[0] - p[0]) * vx + (q[1] - p[1]) * vy < 0 ? pts.slice().reverse() : pts;
};

// ---------------------------------------------------------------- streamlines
// Every level of psi is one streamline; it is traced at each phase, split at XS
// into a static upstream part and a downstream part that morphs.
const phaseV = [...Array(K + 1)].map((_, p) => vortices(p / K));
const GX = -PAD, GY = -PAD, GNX = Math.ceil((W + 2 * PAD) / GRID) + 1, GNY = Math.ceil((H + 2 * PAD) / GRID) + 1;
const grids = phaseV.slice(0, K).map((V) => sampleGrid(GX, GY, GNX, GNY, GRID, V));

function spanning(grid, level, V) {
  // the piece of this level that runs from the left edge to the right edge
  let best = null;
  for (const ln of contour(grid, level)) {
    if (ln.closed) continue;
    let cur = [];
    const pieces = [];
    for (const p of ln.pts) {
      if (dist(p, [CX, CY]) < A + 0.6) { if (cur.length > 1) pieces.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 1) pieces.push(cur);
    for (let pts of pieces) {
      pts = orient(pts, V);
      if (pts[0][0] < -PAD / 2 && pts[pts.length - 1][0] > W + PAD / 2 && (!best || pts.length > best.length)) best = pts;
    }
  }
  return best;
}
function trimX(pts, x0, x1) {
  // keep the stretch between the last entry past x0 and the first exit past x1
  let a = 0, b = pts.length - 1;
  for (let i = 0; i < pts.length; i++) if (pts[i][0] < x0) a = i;
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i][0] > x1) b = i;
  return pts.slice(a, b + 1);
}
function splitAt(pts, xs) {
  const i = pts.findIndex((p) => p[0] >= xs);
  if (i <= 0) return null;
  const u = (xs - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
  const q = [xs, lerp(pts[i - 1][1], pts[i][1], u)];
  return [[...pts.slice(0, i), q], [q, ...pts.slice(i)]];
}

// Lines in the heart of the street wind round the eddies, and the winding moves
// downstream: morphed as one piece their points would slide along the curve
// and cut corners. They are cut instead at boundaries that ride with the street
// (half-way between neighbouring eddies), so each piece mostly translates. After
// one period piece k sits exactly where piece k+2 started: a conveyor belt again.
const SEG_K0 = -4, SEG_K1 = Math.ceil((W + 24 + STREET - X0V) / (STREET / 2));
function subLine(pts, cum, s0, s1) {
  const at = (s) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const u = clamp((s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), 0, 1);
    return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)];
  };
  if (s1 - s0 < 0.5) { const p = at(s0); return [p, [p[0] + 0.01, p[1]]]; }
  const out = [at(s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + 0.2 && cum[i] < s1 - 0.2) out.push(pts[i]);
  out.push(at(s1));
  return out;
}
function conveyor(rights) {
  // rights[p] for p = 0..K (frame K is frame 0's geometry with phi = 1 boundaries)
  const perFrame = rights.map((pts, p) => {
    const phi = p / K, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
    const L = cum[cum.length - 1], bounds = [];
    let from = 1;
    for (let k = SEG_K0; k <= SEG_K1; k++) {
      const b = X0V + (k + 2 * phi + 0.5) * STREET / 2;
      if (b <= pts[0][0]) { bounds.push(0); continue; }
      let hit = -1;
      for (let i = from; i < pts.length; i++) if ((pts[i - 1][0] - b) * (pts[i][0] - b) <= 0 && pts[i][0] !== pts[i - 1][0]) { hit = i; break; }
      if (hit < 0) { bounds.push(L); from = pts.length; continue; }
      const u = (b - pts[hit - 1][0]) / (pts[hit][0] - pts[hit - 1][0]);
      bounds.push(cum[hit - 1] + u * (cum[hit] - cum[hit - 1]));
      from = hit;
    }
    const segs = [];
    for (let j = 0; j + 1 < bounds.length; j++) segs.push(subLine(pts, cum, bounds[j], bounds[j + 1]));
    return segs;
  });
  const segs = [];
  for (let j = 0; j < perFrame[0].length; j++) {
    const frames = perFrame.map((f) => f[j]);
    if (frames.every((f) => polyLen(f) < 1)) continue;
    segs.push(adaptiveResample(frames, 0.5, 3, 200));
  }
  return segs;
}

const lines = [];   // { level, whole } | { level, left, right: K frames } | { level, left, segs, still }
let dropped = 0, leftDrift = 0;
{
  const fmin = Math.min(...grids.map((g) => g.F.reduce((m, v) => Math.min(m, v), Infinity)));
  const fmax = Math.max(...grids.map((g) => g.F.reduce((m, v) => Math.max(m, v), -Infinity)));
  for (let c = Math.floor(fmin / SPACING) * SPACING + SPACING * 0.5; c < fmax; c += SPACING) {
    const per = [];
    for (let p = 0; p < K; p++) {
      const s = spanning(grids[p], c, phaseV[p]);
      if (!s) break;
      per.push(s);
    }
    if (per.length < K) { dropped++; continue; }
    if (!per.some((pts) => pts.some(([, y]) => y > 10 && y < H - 10))) continue;
    const parts = per.map((pts) => splitAt(trimX(pts, -24, W + 24), XS));
    if (parts.some((x) => !x)) { dropped++; continue; }
    const q0 = parts[0][0][parts[0][0].length - 1];
    for (const [l] of parts) leftDrift = Math.max(leftDrift, Math.abs(l[l.length - 1][1] - q0[1]));
    const rights = parts.map(([, r]) => [q0, ...r.slice(1)]);
    const rs = adaptiveResample(rights, 0.5, 4, 400);
    const n = rs[0].length;
    let dev = 0, jump = 0;
    for (let p = 0; p < K; p++) for (let i = 0; i < n; i++) {
      dev = Math.max(dev, dist(rs[p][i], rs[0][i]));
      jump = Math.max(jump, dist(rs[p][i], rs[(p + 1) % K][i]));
    }
    const left = rdp(parts[0][0], 0.3);
    if (dev < 1.5) lines.push({ level: c, whole: rdp([...parts[0][0], ...parts[0][1].slice(1)], 0.3) });
    else if (jump < 40) lines.push({ level: c, left, right: rs });
    else lines.push({ level: c, left, segs: conveyor([...rights, rights[0]]), still: rdp(rights[0], 0.3) });
  }
}

// ---------------------------------------------------------------- eddy rings
// Closed streamlines round each vortex, found as psi-levels around the local
// extremum, resampled from their topmost point so they morph cleanly. When a
// ring does not exist at some phase it keeps the nearest shape (carried along
// with the vortex) and fades out.
function insideLoop(P, c) {
  let inside = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    if ((P[a][1] > c[1]) !== (P[b][1] > c[1]) && c[0] < ((P[b][0] - P[a][0]) * (c[1] - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) inside = !inside;
  }
  return inside;
}
function fromTop(pts) {
  let top = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[top][1]) top = i;
  return [...pts.slice(top), ...pts.slice(0, top)];
}
const rings = [];
for (const k of SLOTS) {
  const frames = [];
  for (let p = 0; p <= K; p++) {
    const V = phaseV[p], v = vortexAt(k, p / K);
    if (Math.abs(v.g) < 8 || v.x > W + 90 || v.x < CX + A * 0.9) { frames.push({ v, levels: [] }); continue; }
    const R = 64;
    const grid = sampleGrid(v.x - R, v.y - R, 2 * R + 1, 2 * R + 1, 1, V);
    const sgn = Math.sign(v.g); // psi has a bump of this sign at the core
    let best = -1, bv = 0;
    for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
      if ((i - R) ** 2 + (j - R) ** 2 > 30 * 30) continue;
      const val = grid.F[j * grid.nx + i] * sgn;
      if (best < 0 || val > bv) { bv = val; best = j * grid.nx + i; }
    }
    const c = [grid.x0 + (best % grid.nx), grid.y0 + ((best / grid.nx) | 0)];
    const levels = [];
    for (let j = 1; j <= 10; j++) {
      const level = grid.F[best] - sgn * (j - 0.5) * SPACING;
      const loops = contour(grid, level).filter((ln) => ln.closed && ln.pts.length > 8 && insideLoop(ln.pts, c));
      if (!loops.length || loops[0].pts.some((q) => dist(q, [CX, CY]) < A + 3)) break;
      loops.sort((a, b) => polyLen(a.pts) - polyLen(b.pts));
      let pts = orient(loops[0].pts.slice(0, -1), V);
      pts = fromTop(pts);
      levels.push([...pts, pts[0]]);
    }
    frames.push({ v, levels });
  }
  const maxJ = Math.max(...frames.map((f) => f.levels.length));
  for (let j = 0; j < maxJ; j++) {
    const exists = frames.map((f) => !!f.levels[j]);
    const shapes = frames.map((f, p) => {
      if (f.levels[j]) return f.levels[j];
      // not a closed ring at this phase: a shrunken copy of the nearest one,
      // carried with the vortex (it fades out meanwhile)
      let near = -1;
      for (let d = 1; d <= K && near < 0; d++) {
        if (p - d >= 0 && exists[p - d]) near = p - d;
        else if (p + d <= K && exists[p + d]) near = p + d;
      }
      const src = frames[near].levels[j];
      const cx = src.reduce((a, q) => a + q[0], 0) / src.length, cy = src.reduce((a, q) => a + q[1], 0) / src.length;
      const shrunk = (dx) => src.map(([x, y]) => [cx + (x - cx) * 0.35 + dx, cy + (y - cy) * 0.35]);
      const moved = shrunk(f.v.x - frames[near].v.x);
      return moved.some((q) => dist(q, [CX, CY]) < A + 2) ? shrunk(0) : moved;
    });
    if (frames.every((f, p) => !exists[p] || f.v.x > W + 40)) continue;
    rings.push({ k, j: j + 1, shapes: adaptiveResample(shapes, 0.3, 12, 64), exists });
  }
}

// ---------------------------------------------------------------- comets
function timeline(pts, extra) {
  // cumulative (arclength, time) along a polyline at the phase-0 flow speed
  const V = phaseV[0];
  const s = [0], t = [0];
  let v0 = Math.hypot(...vel(...pts[0], V));
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i], pts[i - 1]);
    const v1 = Math.hypot(...vel(...pts[i], V));
    const v = Math.max(0.3, (v0 + v1) / 2) * PX_PER_S;
    s.push(s[i - 1] + d); t.push(t[i - 1] + d / v);
    v0 = v1;
  }
  if (extra > 0) { const v = Math.max(0.3, v0) * PX_PER_S; s.push(s[s.length - 1] + extra); t.push(t[t.length - 1] + extra / v); }
  const st = rdp(s.map((x, i) => [x, t[i] * 60]), 0.8); // tolerance: under 1/60 s
  return st.map(([x, y]) => [x, y / 60]);
}

const comets = [];
for (const [li, ln] of lines.entries()) {
  if (ln.segs) continue;
  const full = ln.whole || [...ln.left, ...ln.right[0].slice(1)];
  const inFrame = full.filter(([x, y]) => x > 0 && x < W && y > 0 && y < H).length / full.length;
  if (inFrame < 0.2) continue;
  const L = polyLen(full);
  const n = rand() < 0.82 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const tail = 80 + rand() * 110;
    const tl = timeline(full, tail);
    const dur = tl[tl.length - 1][1] + 0.6 + rand() * 5.5;
    comets.push({ li, tail, tl, dur, begin: -rand() * dur, L, split: ln.whole ? 0 : polyLen(ln.left), still: rand() < 0.5 });
  }
}
// Ring comets: their period divides the loop and their phase depends only on
// (ring, row), so the conveyor hand-over at the end of each period is invisible.
const ringComets = [];
{
  const phaseOf = new Map();
  for (const [ri, r] of rings.entries()) {
    if (r.j % 2 === 1 || r.j > 8) continue;
    const key = `${r.j}:${((r.k % 2) + 2) % 2}`;
    if (!phaseOf.has(key)) phaseOf.set(key, rand());
    const len = polyLen(r.shapes[K >> 1]);
    const laps = Math.max(1, Math.round((PERIOD * 150) / Math.max(len, 1)));
    ringComets.push({ ri, dur: PERIOD / laps, phase: phaseOf.get(key), tail: 30 });
  }
}

// ---------------------------------------------------------------- SVG
// Compact path data: points snapped to 0.1 px, then written as relative moves
// (exact, no drift), numbers without leading zeros or needless separators.
// Streamline geometry is written in half-pixel integer units (the paths carry
// scale(.5)) as relative moves, which keeps the morph keyframes compact.
const Q = 2, TF = ` transform="scale(${1 / Q})"`;
function pathD(pts, closed) {
  const q = pts.map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]);
  let d = `M${q[0][0]} ${q[0][1]}l`, prev = false;
  for (let i = 1; i < q.length; i++) for (const t of [q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]) {
    d += prev && t >= 0 ? ' ' + t : String(t);
    prev = true;
  }
  return d + (closed ? 'z' : '');
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('');
}

const THEMES = {
  dark: {
    bg: '#0d1117', bgCenter: '#121b2e',
    flow: [[0, '#2a45b8'], [0.16, '#3572ff'], [0.24, '#5cc8ff'], [0.31, '#b9f3ff'], [0.4, '#8f9dff'], [0.55, '#c566ff'], [0.72, '#ff5fa0'], [0.88, '#ff8a6a'], [1, '#ffc26b']],
    core: ['#ffffff', 0.6],        // comet cores: flow colour mixed toward this
    silk: 0.2, silkBoost: 0.5, silkWidth: 0.8, ring: 0.36,
    glow: 0.22, mid: 0.7,
    orb: ['#03050a', '#101829'], rim: '#c9f4ff', rim2: '#c566ff', fresnel: 0.22, spec: 0.5,
    hot: '#8fe6ff', warm: '#c566ff', haze: 0.6,
  },
  light: {
    bg: '#ffffff', bgCenter: '#eef3fb',
    flow: [[0, '#274aa8'], [0.16, '#2563eb'], [0.24, '#0891b2'], [0.31, '#0e7490'], [0.4, '#4f46e5'], [0.55, '#9333ea'], [0.72, '#db2777'], [0.88, '#ea580c'], [1, '#d97706']],
    core: ['#0b1020', 0.18],
    silk: 0.25, silkBoost: 0.45, silkWidth: 0.75, ring: 0.4,
    glow: 0.12, mid: 0.65,
    orb: ['#05070d', '#1c2640'], rim: '#bff0ff', rim2: '#e9a8ff', fresnel: 0.3, spec: 0.6,
    hot: '#38bdf8', warm: '#c084fc', haze: 0.35,
  },
};

function build(themeName) {
  const th = THEMES[themeName];
  const out = [];
  const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const kt = [...Array(K + 1)].map((_, p) => f3(p / K)).join(';');
  const morph = (frames, closed) => `<animate attributeName="d" dur="${PERIOD}s" repeatCount="indefinite" keyTimes="${kt}" values="${frames.map((f) => pathD(f, closed)).join(';')}"/>`;
  const loopAnim = (attr, values) => `<animate attributeName="${attr}" dur="${PERIOD}s" repeatCount="indefinite" keyTimes="${kt}" values="${values.join(';')}"/>`;

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Streams of light flowing around a dark sphere and breaking into a trail of eddies">`);
  out.push(`<style>
.silk use{fill:none;stroke:url(#flow);stroke-width:${th.silkWidth * Q}}
.k use{fill:none;stroke-linecap:round}
.k .g{stroke:url(#flow);stroke-width:${4.2 * Q};stroke-opacity:${th.glow}}
.k .m{stroke:url(#flow);stroke-width:${1.7 * Q};stroke-opacity:${th.mid};stroke-linecap:butt}
.k .c{stroke:url(#core);stroke-width:${1.25 * Q};stroke-linecap:butt}
.still{display:none}
@media (prefers-reduced-motion: reduce){.live{display:none}.still{display:inline}}
</style>`);
  out.push('<defs>');
  out.push(`<linearGradient id="flow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W * Q}" y2="0">${stops(th.flow)}</linearGradient>`);
  out.push(`<linearGradient id="core" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W * Q}" y2="0">${stops(th.flow.map(([o, c]) => [o, mix(c, th.core[0], th.core[1])]))}</linearGradient>`);
  out.push(`<radialGradient id="bgg" cx="${CX + 200}" cy="${CY}" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${th.bgCenter}"/><stop offset="1" stop-color="${th.bg}"/></radialGradient>`);
  out.push(`<radialGradient id="orb" cx="${CX - A * 0.3}" cy="${CY - A * 0.35}" r="${A * 1.3}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${th.orb[1]}"/><stop offset="1" stop-color="${th.orb[0]}"/></radialGradient>`);
  out.push(`<radialGradient id="fresnel" cx="${CX}" cy="${CY}" r="${A}" gradientUnits="userSpaceOnUse"><stop offset=".78" stop-color="${th.rim}" stop-opacity="0"/><stop offset="1" stop-color="${th.rim}" stop-opacity="${th.fresnel}"/></radialGradient>`);
  out.push(`<linearGradient id="rimg" gradientUnits="userSpaceOnUse" x1="${CX - A}" y1="${CY - A}" x2="${CX + A}" y2="${CY + A}"><stop offset="0" stop-color="${th.rim}" stop-opacity=".95"/><stop offset=".5" stop-color="${th.rim}" stop-opacity=".2"/><stop offset="1" stop-color="${th.rim2}" stop-opacity=".75"/></linearGradient>`);
  out.push(`<linearGradient id="spec" gradientUnits="userSpaceOnUse" x1="${CX - A}" y1="${CY}" x2="${CX}" y2="${CY - A}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${th.spec}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  for (const s of ['L', 'R', 'T', 'B']) {
    const v = { L: 'x1="0" x2="1"', R: 'x1="1" x2="0"', T: 'x1="0" y1="0" x2="0" y2="1"', B: 'x1="0" y1="1" x2="0" y2="0"' }[s];
    out.push(`<linearGradient id="fade${s}" ${v}><stop offset="0" stop-color="${th.bg}"/><stop offset="1" stop-color="${th.bg}" stop-opacity="0"/></linearGradient>`);
  }
  out.push(`<radialGradient id="hot"><stop offset="0" stop-color="${th.hot}" stop-opacity=".5"/><stop offset="1" stop-color="${th.hot}" stop-opacity="0"/></radialGradient>`);
  out.push(`<radialGradient id="warm"><stop offset="0" stop-color="${th.warm}" stop-opacity=".24"/><stop offset="1" stop-color="${th.warm}" stop-opacity="0"/></radialGradient>`);
  out.push(`<clipPath id="frame"><rect width="${W}" height="${H}" rx="14"/></clipPath>`);
  // geometry: a = whole line or its static left part, b = morphing right part,
  // r = eddy ring, s = frozen right part for reduced motion
  for (const [i, ln] of lines.entries()) {
    if (ln.whole) { out.push(`<path id="a${i}"${TF} d="${pathD(ln.whole)}"/>`); continue; }
    out.push(`<path id="a${i}"${TF} d="${pathD(ln.left)}"/>`);
    if (ln.segs) {
      ln.segs.forEach((f, j) => out.push(`<path id="c${i}_${j}"${TF} d="${pathD(f[0])}">${morph(f)}</path>`));
      out.push(`<path id="s${i}"${TF} d="${pathD(ln.still)}"/>`);
      continue;
    }
    out.push(`<path id="b${i}"${TF} d="${pathD(ln.right[0])}">${morph([...ln.right, ln.right[0]])}</path>`);
    out.push(`<path id="s${i}"${TF} d="${pathD(rdp(ln.right[0], 0.3))}"/>`);
  }
  for (const [i, r] of rings.entries()) out.push(`<path id="r${i}"${TF} pathLength="100" d="${pathD(r.shapes[0], true)}">${morph(r.shapes, true)}</path>`);
  out.push('</defs>');

  out.push(`<g clip-path="url(#frame)">`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#bgg)"/>`);
  out.push(`<g opacity="${th.haze}"><ellipse cx="${CX}" cy="${CY - A * 1.05}" rx="${A * 2.6}" ry="${A * 0.75}" fill="url(#hot)"/><ellipse cx="${CX}" cy="${CY + A * 1.05}" rx="${A * 2.6}" ry="${A * 0.75}" fill="url(#hot)"/><ellipse cx="${CX + 440}" cy="${CY}" rx="480" ry="150" fill="url(#warm)"/></g>`);

  // silk: brighter the closer a streamline passes to the sphere
  const op = (ln) => f2(th.silk + th.silkBoost * Math.exp(-Math.abs(ln.level) / 30));
  out.push('<g class="silk">');
  for (const [i, ln] of lines.entries()) out.push(`<use href="#a${i}" stroke-opacity="${op(ln)}"/>`);
  out.push('<g class="live">');
  for (const [i, ln] of lines.entries()) {
    if (ln.segs) ln.segs.forEach((_, j) => out.push(`<use href="#c${i}_${j}" stroke-opacity="${op(ln)}"/>`));
    else if (!ln.whole) out.push(`<use href="#b${i}" stroke-opacity="${op(ln)}"/>`);
  }
  for (const [i, r] of rings.entries()) {
    if (r.exists.every(Boolean)) out.push(`<use href="#r${i}" stroke-opacity="${th.ring}"/>`);
    else out.push(`<use href="#r${i}" stroke-opacity="${r.exists[0] ? th.ring : 0}">${loopAnim('stroke-opacity', r.exists.map((e) => (e ? th.ring : 0)))}</use>`);
  }
  out.push('</g><g class="still">');
  for (const [i, ln] of lines.entries()) if (!ln.whole) out.push(`<use href="#s${i}" stroke-opacity="${op(ln)}"/>`);
  for (const r of rings) if (r.exists[0]) out.push(`<path${TF} d="${pathD(r.shapes[0], true)}" fill="none" stroke="url(#flow)" stroke-width="${th.silkWidth * Q}" stroke-opacity="${th.ring}"/>`);
  out.push('</g></g>');

  // the sphere: dark glass, fresnel edge, rim light, a thin specular arc
  const arc = (r, a0, a1) => {
    const p = (a) => [CX + r * Math.cos(a * Math.PI / 180), CY + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 0 1 ${f1(x1)} ${f1(y1)}`;
  };
  out.push(`<circle cx="${CX}" cy="${CY}" r="${A}" fill="url(#orb)"/>`);
  out.push(`<circle cx="${CX}" cy="${CY}" r="${A}" fill="url(#fresnel)"/>`);
  out.push(`<circle cx="${CX}" cy="${CY}" r="${A - 0.5}" fill="none" stroke="url(#rimg)" stroke-width="1.1"/>`);
  out.push(`<path d="${arc(A * 0.84, 188, 262)}" fill="none" stroke="url(#spec)" stroke-width="2.4" stroke-linecap="round"/>`);

  // comets: a soft glow, a brighter middle and a hot core, fronts aligned
  const layers = (href, tail, gap, cap = 24 * Q) => {
    const core = Math.min(cap, tail * 0.3);
    return `<use class="g" href="#${href}"/>`
      + `<use class="m" href="#${href}" stroke-dasharray="0 ${f1(tail * 0.45)} ${f1(tail * 0.55)} ${f1(gap)}"/>`
      + `<use class="c" href="#${href}" stroke-dasharray="0 ${f1(tail - core)} ${f1(core)} ${f1(gap)}"/>`;
  };
  const cometSvg = (c, animated) => {
    const gap = (c.L + c.tail + 60) * Q, tail = c.tail * Q;
    const tl = c.tl, total = c.dur;
    const kts = tl.map(([, t]) => f3(t / total));
    kts.push('1');
    for (let i = 1; i < kts.length; i++) if (+kts[i] <= +kts[i - 1]) kts[i] = f3(+kts[i - 1] + 0.001);
    if (+kts[kts.length - 2] >= 1) return '';
    const parts = c.split ? [[`a${c.li}`, 0], [`b${c.li}`, c.split]] : [[`a${c.li}`, 0]];
    const dash = `${f1(tail)} ${f1(gap)}`;
    return parts.map(([href, s0]) => {
      if (!animated) {
        const tAt = (-c.begin) % total;
        let s = tl[tl.length - 1][0];
        for (let i = 1; i < tl.length; i++) if (tl[i][1] >= tAt) { s = lerp(tl[i - 1][0], tl[i][0], (tAt - tl[i - 1][1]) / (tl[i][1] - tl[i - 1][1])); break; }
        return `<g class="k" stroke-dasharray="${dash}" stroke-dashoffset="${f1((c.tail - s + s0) * Q)}">${layers(href[0] === 'b' ? `s${c.li}` : href, tail, gap)}</g>`;
      }
      const vals = tl.map(([s]) => f1((c.tail - s + s0) * Q));
      vals.push(vals[vals.length - 1]);
      return `<g class="k" stroke-dasharray="${dash}"><animate attributeName="stroke-dashoffset" dur="${f2(total)}s" begin="${f2(c.begin)}s" repeatCount="indefinite" keyTimes="${kts.join(';')}" values="${vals.join(';')}"/>${layers(href, tail, gap)}</g>`;
    }).join('');
  };
  out.push('<g class="live">');
  for (const c of comets) out.push(cometSvg(c, true));
  for (const c of ringComets) {
    const r = rings[c.ri];
    const vis = r.exists.every(Boolean) ? '' : loopAnim('opacity', r.exists.map((e) => (e ? 1 : 0)));
    out.push(`<g class="k" stroke-dasharray="${c.tail} ${100 - c.tail}"${r.exists[0] ? '' : ' opacity="0"'}>${vis}<animate attributeName="stroke-dashoffset" dur="${f3(c.dur)}s" begin="${f3(-c.phase * c.dur)}s" repeatCount="indefinite" values="0;-100"/>${layers(`r${c.ri}`, c.tail, 100 - c.tail, 24)}</g>`);
  }
  out.push('</g><g class="still">');
  for (const c of comets) if (c.still) out.push(cometSvg(c, false));
  out.push('</g>');

  out.push(`<rect width="90" height="${H}" fill="url(#fadeL)"/><rect x="${W - 140}" width="140" height="${H}" fill="url(#fadeR)"/><rect width="${W}" height="34" fill="url(#fadeT)"/><rect y="${H - 34}" width="${W}" height="34" fill="url(#fadeB)"/>`);
  out.push('</g></svg>');
  return out.join('\n');
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
const morphing = lines.filter((l) => !l.whole).length, conv = lines.filter((l) => l.segs).length;
console.log(`lines=${lines.length} (morphing ${morphing}, conveyor ${conv}, dropped ${dropped}, left drift ${leftDrift.toFixed(2)}px) rings=${rings.length} comets=${comets.length}+${ringComets.length}`);
for (const name of Object.keys(THEMES)) {
  const svg = build(name);
  const file = join(ROOT, 'assets', `header-${name}.svg`);
  writeFileSync(file, svg);
  console.log(`${file}  ${(svg.length / 1024).toFixed(0)} KB`);
}
