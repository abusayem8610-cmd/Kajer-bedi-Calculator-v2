// Numerical algorithms: integration, differentiation, root finding, polynomial / linear solvers, statistics.
import { Cx, cantSolve, mathErr } from './core';

const xgk = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.58608723546769113029414483825873, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0,
];
const wgk = [
  0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
const wg = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f: (x: number) => number, a: number, b: number) {
  const c = (a + b) / 2, h = (b - a) / 2;
  const fc = f(c);
  let rk = fc * wgk[7], rg = fc * wg[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * xgk[j];
    const s = f(c - dx) + f(c + dx);
    rk += wgk[j] * s;
    if (j % 2 === 1) rg += wg[(j - 1) / 2] * s;
  }
  return { val: rk * h, err: Math.abs((rk - rg) * h) };
}

export function integrate(f: (x: number) => number, a: number, b: number): number {
  if (a === b) return 0;
  let sign = 1;
  if (a > b) { [a, b] = [b, a]; sign = -1; }
  let evals = 0;
  const g = (x: number) => {
    evals++;
    if (evals > 200000) throw mathErr();
    const v = f(x);
    if (!isFinite(v)) throw mathErr();
    return v;
  };
  const rec = (lo: number, hi: number, tol: number, depth: number): number => {
    const r = gk15(g, lo, hi);
    if (r.err <= tol || depth >= 30) return r.val;
    const mid = (lo + hi) / 2;
    return rec(lo, mid, tol / 2, depth + 1) + rec(mid, hi, tol / 2, depth + 1);
  };
  // initial split into pieces to catch narrow features
  const N = 4;
  let total = 0;
  const first = gk15(g, a, b);
  const tol = Math.max(1e-11 * Math.abs(first.val), 1e-13);
  for (let i = 0; i < N; i++) total += rec(a + ((b - a) * i) / N, a + ((b - a) * (i + 1)) / N, tol / N, 0);
  return sign * Number(total.toPrecision(12));
}

export function derivative(f: (x: number) => number, x: number): number {
  const CON = 1.4, CON2 = CON * CON, BIG = 1e30, NTAB = 12, SAFE = 2;
  let h = Math.max(Math.abs(x) * 0.02, 0.02);
  const a: number[][] = Array.from({ length: NTAB }, () => Array(NTAB).fill(0));
  a[0][0] = (f(x + h) - f(x - h)) / (2 * h);
  let err = BIG, ans = a[0][0];
  for (let i = 1; i < NTAB; i++) {
    h /= CON;
    a[0][i] = (f(x + h) - f(x - h)) / (2 * h);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const errt = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (errt <= err) { err = errt; ans = a[j][i]; }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= SAFE * err) break;
  }
  if (!isFinite(ans)) throw mathErr();
  return Number(ans.toPrecision(11));
}

export function findRoot(f: (x: number) => number, x0: number): number {
  const safe = (x: number) => {
    try { const v = f(x); return isFinite(v) ? v : NaN; } catch { return NaN; }
  };
  const f0 = Math.abs(safe(x0));
  const scale = Math.max(1, isFinite(f0) ? f0 : 1);
  // Newton / secant
  let x = x0;
  for (let it = 0; it < 120; it++) {
    const fx = safe(x);
    if (!isFinite(fx)) break;
    if (Math.abs(fx) < 1e-13 * scale) return clean(x);
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const d = (safe(x + h) - safe(x - h)) / (2 * h);
    if (!isFinite(d) || d === 0) break;
    let step = fx / d;
    // damping
    let nx = x - step;
    let tries = 0;
    while (tries < 30 && !(Math.abs(safe(nx)) < Math.abs(fx) * 1.0001)) { step /= 2; nx = x - step; tries++; }
    if (Math.abs(nx - x) < 1e-14 * Math.max(1, Math.abs(x))) { x = nx; break; }
    x = nx;
  }
  const fx = safe(x);
  if (isFinite(fx) && Math.abs(fx) < 1e-9 * scale) return clean(x);
  // scan for sign change
  for (let r = 1; r <= 1e7; r *= 10) {
    const N = 400;
    let px = x0 - r, pf = safe(px);
    for (let i = 1; i <= N; i++) {
      const cx = x0 - r + (2 * r * i) / N;
      const cf = safe(cx);
      if (isFinite(pf) && isFinite(cf) && (pf === 0 || pf * cf < 0)) {
        let lo = px, hi = cx, flo = pf;
        for (let k = 0; k < 200; k++) {
          const mid = (lo + hi) / 2, fm = safe(mid);
          if (!isFinite(fm)) break;
          if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
        }
        const root = (lo + hi) / 2;
        const fr = safe(root);
        if (isFinite(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(pf), Math.abs(cf))) return clean(root);
      }
      px = cx; pf = cf;
    }
  }
  throw cantSolve();
}
const clean = (x: number) => (Math.abs(x) < 1e-13 ? 0 : Number(x.toPrecision(12)));

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
    if (Math.abs(m[p][i]) < 1e-12) throw mathErr();
    [m[i], m[p]] = [m[p], m[i]];
    for (let k = i + 1; k < n; k++) {
      const f = m[k][i] / m[i][i];
      for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x.map((v) => Number(v.toPrecision(14)));
}

export type Root = number | Cx;
export function quadRoots(a: number, b: number, c: number): Root[] {
  if (a === 0) throw mathErr();
  const D = b * b - 4 * a * c;
  if (D === 0) return [-b / (2 * a)];
  if (D > 0) {
    const s = Math.sqrt(D);
    const q = -(b + Math.sign(b || 1) * s) / 2;
    let r1 = q / a, r2 = c / q;
    if (q === 0) { r1 = (-b + s) / (2 * a); r2 = (-b - s) / (2 * a); }
    return [Number(r1.toPrecision(14)), Number(r2.toPrecision(14))].sort((x, y) => y - x).map((v) => v);
  }
  const s = Math.sqrt(-D) / (2 * a), re = -b / (2 * a);
  return [new Cx(re, s), new Cx(re, -s)];
}
export function cubicRoots(a: number, b: number, c: number, d: number): Root[] {
  if (a === 0) throw mathErr();
  const B = b / a, C = c / a, D = d / a;
  const p = C - (B * B) / 3, q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
  const sh = -B / 3;
  const disc = (q * q) / 4 + (p * p * p) / 27;
  let roots: Root[];
  if (Math.abs(disc) < 1e-14 * Math.max(1, Math.abs(q * q))) {
    if (Math.abs(p) < 1e-14 && Math.abs(q) < 1e-14) roots = [sh];
    else {
      const u = Math.cbrt(-q / 2);
      roots = [2 * u + sh, -u + sh];
    }
  } else if (disc > 0) {
    const sd = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sd), v = Math.cbrt(-q / 2 - sd);
    const re = -(u + v) / 2 + sh, im = (Math.sqrt(3) / 2) * (u - v);
    roots = [u + v + sh, new Cx(re, im), new Cx(re, -im)];
  } else {
    const r = Math.sqrt((-p * p * p) / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
    const m = 2 * Math.cbrt(r);
    roots = [0, 1, 2].map((k) => m * Math.cos((phi + 2 * Math.PI * k) / 3) + sh);
  }
  // Newton polish for real roots
  roots = roots.map((r) => {
    if (typeof r !== 'number') return new Cx(Number(r.re.toPrecision(13)), Number(r.im.toPrecision(13)));
    let x = r;
    for (let i = 0; i < 4; i++) {
      const f = ((a * x + b) * x + c) * x + d, df = (3 * a * x + 2 * b) * x + c;
      if (df !== 0) x -= f / df;
    }
    return Number(x.toPrecision(13));
  });
  return roots.sort((x, y) => (typeof y === 'number' ? y : -1e300) - (typeof x === 'number' ? x : -1e300));
}

// ---------------- statistics -----------------
export type StatType = '1var' | 'lin' | 'quad' | 'ln' | 'exp' | 'ab' | 'pow' | 'inv';
export interface StatData { x: number[]; y: number[]; f: number[] }
export const statIs2 = (t: StatType) => t !== '1var';

export function statCompute(type: StatType, d: StatData): Record<string, number> {
  const out: Record<string, number> = {};
  const idx: number[] = [];
  for (let i = 0; i < d.x.length; i++) if (isFinite(d.x[i]) && d.f[i] > 0 && (type === '1var' || isFinite(d.y[i]))) idx.push(i);
  const n = idx.reduce((s, i) => s + d.f[i], 0);
  if (n === 0) throw mathErr();
  const S = (g: (i: number) => number) => idx.reduce((s, i) => s + d.f[i] * g(i), 0);
  const x = (i: number) => d.x[i], y = (i: number) => d.y[i];
  out['n'] = n;
  out['Σx'] = S(x);
  out['Σx²'] = S((i) => x(i) ** 2);
  out['x̄'] = out['Σx'] / n;
  out['σx'] = Math.sqrt(Math.max(0, out['Σx²'] / n - out['x̄'] ** 2));
  out['sx'] = n > 1 ? Math.sqrt(Math.max(0, (out['Σx²'] - n * out['x̄'] ** 2) / (n - 1))) : NaN;
  out['minX'] = Math.min(...idx.map(x));
  out['maxX'] = Math.max(...idx.map(x));
  if (type !== '1var') {
    out['Σy'] = S(y);
    out['Σy²'] = S((i) => y(i) ** 2);
    out['Σxy'] = S((i) => x(i) * y(i));
    out['Σx³'] = S((i) => x(i) ** 3);
    out['Σx²y'] = S((i) => x(i) ** 2 * y(i));
    out['Σx⁴'] = S((i) => x(i) ** 4);
    out['ȳ'] = out['Σy'] / n;
    out['σy'] = Math.sqrt(Math.max(0, out['Σy²'] / n - out['ȳ'] ** 2));
    out['sy'] = n > 1 ? Math.sqrt(Math.max(0, (out['Σy²'] - n * out['ȳ'] ** 2) / (n - 1))) : NaN;
    out['minY'] = Math.min(...idx.map(y));
    out['maxY'] = Math.max(...idx.map(y));
    // regression
    const tx = (v: number) => (type === 'ln' || type === 'pow' ? Math.log(v) : type === 'inv' ? 1 / v : v);
    const ty = (v: number) => (type === 'exp' || type === 'ab' || type === 'pow' ? Math.log(v) : v);
    const bad = idx.some((i) => ((type === 'ln' || type === 'pow') && x(i) <= 0) || ((type === 'exp' || type === 'ab' || type === 'pow') && y(i) <= 0) || (type === 'inv' && x(i) === 0));
    if (bad) { out['regError'] = 1; return out; }
    const X = (i: number) => tx(x(i)), Y = (i: number) => ty(y(i));
    const sx = S(X), sy = S(Y), sxx = S((i) => X(i) ** 2), syy = S((i) => Y(i) ** 2), sxy = S((i) => X(i) * Y(i));
    if (type === 'quad') {
      const s3 = out['Σx³'], s4 = out['Σx⁴'], sx2y = out['Σx²y'];
      // solve [n Σx Σx²; Σx Σx² Σx³; Σx² Σx³ Σx⁴] [A B C] = [Σy Σxy Σx²y]
      try {
        const sol = solveLinear([[n, out['Σx'], out['Σx²']], [out['Σx'], out['Σx²'], s3], [out['Σx²'], s3, s4]], [out['Σy'], out['Σxy'], sx2y]);
        out['rA'] = sol[0]; out['rB'] = sol[1]; out['rC'] = sol[2];
      } catch { out['regError'] = 1; }
      return out;
    }
    const den = n * sxx - sx * sx;
    if (den === 0) { out['regError'] = 1; return out; }
    const b = (n * sxy - sx * sy) / den;
    const a = (sy - b * sx) / n;
    const rd = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    out['rr'] = rd === 0 ? NaN : (n * sxy - sx * sy) / rd;
    if (type === 'exp') { out['rA'] = Math.exp(a); out['rB'] = b; }
    else if (type === 'ab') { out['rA'] = Math.exp(a); out['rB'] = Math.exp(b); }
    else if (type === 'pow') { out['rA'] = Math.exp(a); out['rB'] = b; }
    else { out['rA'] = a; out['rB'] = b; }
  }
  return out;
}

export function statEstimate(type: StatType, vars: Record<string, number>, kind: 'x' | 'y', v: number): number {
  const A = vars['rA'], B = vars['rB'], C = vars['rC'];
  if (vars['regError'] || A === undefined) throw mathErr();
  if (kind === 'y') {
    switch (type) {
      case 'lin': return A + B * v;
      case 'quad': return A + B * v + C * v * v;
      case 'ln': if (v <= 0) throw mathErr(); return A + B * Math.log(v);
      case 'exp': return A * Math.exp(B * v);
      case 'ab': return A * Math.pow(B, v);
      case 'pow': if (v <= 0) throw mathErr(); return A * Math.pow(v, B);
      case 'inv': if (v === 0) throw mathErr(); return A + B / v;
    }
  } else {
    switch (type) {
      case 'lin': if (B === 0) throw mathErr(); return (v - A) / B;
      case 'quad': {
        const D = B * B - 4 * C * (A - v);
        if (D < 0 || C === 0) throw mathErr();
        return (-B + Math.sqrt(D)) / (2 * C);
      }
      case 'ln': return Math.exp((v - A) / B);
      case 'exp': if (v / A <= 0) throw mathErr(); return Math.log(v / A) / B;
      case 'ab': if (v / A <= 0) throw mathErr(); return Math.log(v / A) / Math.log(B);
      case 'pow': if (v / A <= 0) throw mathErr(); return Math.pow(v / A, 1 / B);
      case 'inv': if (v === A) throw mathErr(); return B / (v - A);
    }
  }
  throw mathErr();
}
