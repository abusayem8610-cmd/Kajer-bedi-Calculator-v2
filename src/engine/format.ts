// Result formatting: decimals, fixed/sci/eng, exact fractions, surds, pi multiples, DMS, complex, matrices.
import { Cx, Mat, Tup, Val, isC, isM, carg, cabs, fromRad, Angle } from './core';
import { Ctx, Fmt } from './parse';

export type Disp =
  | { kind: 'none' }
  | { kind: 'math'; tokens: string[]; alt: boolean }
  | { kind: 'lines'; rows: { label: string; tokens: string[] }[]; alt: boolean }
  | { kind: 'mat'; cells: string[][][]; vec: boolean; alt: boolean }
  | { kind: 'text'; lines: string[] }
  | { kind: 'err'; msg: string };

export interface FmtOpts {
  fmt: Fmt;
  io: 'math' | 'line';
  mixed: boolean; // ab/c (true) or d/c (false)
  forceDec?: boolean;
  forceEng?: number | null; // engineering shift steps; null = off
  cmplxPolar?: boolean;
  forceDMS?: boolean;
  angle: Angle;
}

const D = (n: number) => String(n).split('');
const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };

function expTokens(e: number): string[] {
  return ['×', '1', '0', 'POW', ...(e < 0 ? ['-'] : []), ...D(Math.abs(e)), 'END'];
}

function sciParts(v: number, digits: number): { mant: string; exp: number } {
  const s = v.toExponential(digits);
  const [m, e] = s.split('e');
  return { mant: m, exp: parseInt(e, 10) };
}
const stripZeros = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

export function decTokens(v: number, f: Fmt, eng: number | null = null): string[] {
  if (Object.is(v, -0)) v = 0;
  if (eng !== null && v !== 0) {
    const { exp } = sciParts(v, 9);
    const e3 = Math.floor(exp / 3) * 3 + eng * 3;
    const mant = v / Math.pow(10, e3);
    const m = stripZeros(Number(mant.toPrecision(10)).toFixed(Math.max(0, 9 - Math.floor(Math.log10(Math.abs(mant) || 1)))));
    return [...m.split(''), ...expTokens(e3)];
  }
  if (f.kind === 'fix') {
    if (Math.abs(v) >= 1e10) {
      const p = sciParts(v, f.n);
      return [...p.mant.split(''), ...expTokens(p.exp)];
    }
    let s = v.toFixed(f.n);
    if (Number(s) === 0) s = s.replace('-', '');
    return s.split('');
  }
  if (f.kind === 'sci') {
    if (v === 0) return [...(f.n === 0 ? '0' : (0).toFixed(Math.max(0, f.n - 1))).split(''), ...expTokens(0)];
    const p = sciParts(v, f.n === 0 ? 9 : Math.max(0, f.n - 1));
    return [...(f.n === 0 ? stripZeros(p.mant) : p.mant).split(''), ...expTokens(p.exp)];
  }
  if (v === 0) return ['0'];
  const r = Number(v.toPrecision(10));
  const a = Math.abs(r);
  const low = f.kind === 'norm1' ? 1e-2 : 1e-9;
  if (a >= 1e10 || a < low) {
    const p = sciParts(v, 9);
    return [...stripZeros(p.mant).split(''), ...expTokens(p.exp)];
  }
  let s = r.toString();
  if (s.includes('e')) s = stripZeros(r.toFixed(12));
  return s.split('');
}

export function plainNumTokens(v: number): string[] {
  const r = Number(v.toPrecision(15));
  const s = String(r);
  if (s.includes('e')) {
    const [m, e] = s.split('e');
    return [...m.split(''), ...expTokens(parseInt(e, 10))];
  }
  return s.split('');
}

function ratApprox(v: number, maxDen: number, tol = 1e-12): [number, number] | null {
  const a = Math.abs(v);
  if (!isFinite(a)) return null;
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  let x = a;
  for (let i = 0; i < 40; i++) {
    const ai = Math.floor(x);
    const h2 = ai * h1 + h0, k2 = ai * k1 + k0;
    if (k2 > maxDen) return null;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(a - h1 / k1) <= tol * Math.max(a, 1e-300)) return [Math.sign(v) * h1, k1];
    const fr = x - ai;
    if (fr < 1e-15) return null;
    x = 1 / fr;
  }
  return null;
}

function sqfree(n: number): [number, number] {
  // n = s^2 * t
  let s = 1, t = n;
  for (let p = 2; p * p <= t; p++) {
    while (t % (p * p) === 0) { t /= p * p; s *= p; }
  }
  return [s, t];
}

function fracTokens(p: number, q: number, mixed: boolean): string[] {
  const neg = p < 0;
  const a = Math.abs(p);
  const out: string[] = neg ? ['-'] : [];
  if (q === 1) return [...out, ...D(a)];
  if (mixed && a > q) {
    const w = Math.floor(a / q), r = a - w * q;
    return [...out, 'MIX', ...D(w), 'SEP', ...D(r), 'SEP', ...D(q), 'END'];
  }
  return [...out, 'FRAC', ...D(a), 'SEP', ...D(q), 'END'];
}

const SURD_T = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23];

function surdTokens(a: number, b: number, t: number, d: number): string[] {
  const g = gcd(gcd(a, b), d);
  a /= g; b /= g; d /= g;
  const num: string[] = [];
  if (a !== 0) num.push(...(a < 0 ? ['-'] : []), ...D(Math.abs(a)));
  if (b !== 0) {
    if (a !== 0) num.push(b < 0 ? '-' : '+');
    else if (b < 0) num.push('-');
    if (Math.abs(b) !== 1) num.push(...D(Math.abs(b)));
    num.push('SQRT', ...D(t), 'END');
  }
  if (d === 1) return num;
  if (a === 0) {
    // keep leading sign outside the fraction
    const neg = num[0] === '-';
    return [...(neg ? ['-'] : []), 'FRAC', ...(neg ? num.slice(1) : num), 'SEP', ...D(d), 'END'];
  }
  return ['FRAC', ...num, 'SEP', ...D(d), 'END'];
}

export function exactTokens(v: number, c: Ctx, o: FmtOpts): string[] | null {
  if (!isFinite(v) || Number.isInteger(v) && Math.abs(v) < 1e10) return null;
  const rat = ratApprox(v, 99999);
  if (rat && Math.abs(rat[0]) < 1e10 && D(Math.abs(rat[0])).length + D(rat[1]).length <= 10) return fracTokens(rat[0], rat[1], o.mixed);
  if (o.io === 'line') return null;
  if (c.piOK) {
    const r = ratApprox(v / Math.PI, 9999);
    if (r && Math.abs(r[0]) < 100000 && r[0] !== 0) {
      const [p, q] = r;
      const neg = p < 0;
      const ap = Math.abs(p);
      const top = [...(ap === 1 ? [] : D(ap)), 'π'];
      return [...(neg ? ['-'] : []), ...(q === 1 ? top : ['FRAC', ...top, 'SEP', ...D(q), 'END'])];
    }
  }
  // pure surd: v = s*sqrt(t)/q
  const r2 = ratApprox(v * v, 400, 1e-11);
  if (r2 && r2[0] > 0) {
    const [s, t] = sqfree(r2[0] * r2[1]);
    if (t > 1 && t < 1e6 && s <= 9999) return surdTokens(0, Math.sign(v) * s, t, r2[1]);
  }
  // (a + b sqrt t) / d
  for (let d = 1; d <= 12; d++) {
    for (const t of SURD_T) {
      const st = Math.sqrt(t);
      for (let b = -9; b <= 9; b++) {
        if (b === 0) continue;
        const a = v * d - b * st;
        if (Math.abs(a - Math.round(a)) < 1e-9 * Math.max(1, Math.abs(v * d)) && Math.abs(a) <= 99) {
          return surdTokens(Math.round(a), b, t, d);
        }
      }
    }
  }
  return null;
}

export function toDMS(v: number): string[] {
  const neg = v < 0;
  const total = Math.round(Math.abs(v) * 3600 * 100) / 100;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total - d * 3600) / 60);
  const s = Number((total - d * 3600 - m * 60).toFixed(2));
  return [...(neg ? ['-'] : []), ...D(d), '°', ...D(m), "'", ...String(s).split(''), '"'];
}

function realDisp(v: number, c: Ctx, o: FmtOpts): { tokens: string[]; alt: boolean } {
  if (o.forceDMS || (c.dms && o.angle === 'deg' && false)) return { tokens: toDMS(v), alt: false };
  const exact = !c.dec ? exactTokens(v, c, o) : null;
  const forceDec = o.forceDec || (o.io === 'line' && !(c.hasFrac && exact));
  if (exact && !forceDec && o.forceEng == null) return { tokens: exact, alt: true };
  return { tokens: decTokens(v, o.fmt, o.forceEng ?? null), alt: !!exact };
}

function cplxDisp(z: Cx, c: Ctx, o: FmtOpts): { tokens: string[]; alt: boolean } {
  if (o.cmplxPolar) {
    const r = cabs(z), th = fromRad(carg(z), o.angle);
    const a = realDisp(r, c, o), b = realDisp(Math.abs(th) < 1e-12 ? 0 : th, c, o);
    return { tokens: [...a.tokens, '∠', ...b.tokens], alt: a.alt || b.alt };
  }
  const out: string[] = [];
  let alt = false;
  if (z.re !== 0 || z.im === 0) { const a = realDisp(z.re, c, o); out.push(...a.tokens); alt = alt || a.alt; }
  if (z.im !== 0) {
    const neg = z.im < 0;
    if (out.length) out.push(neg ? '-' : '+'); else if (neg) out.push('-');
    if (Math.abs(z.im) !== 1) { const b = realDisp(Math.abs(z.im), c, o); out.push(...b.tokens); alt = alt || b.alt; }
    out.push('i');
  }
  return { tokens: out, alt };
}

export function formatVal(v: Val, c: Ctx, o: FmtOpts): Disp {
  if (v instanceof Tup) {
    let alt = false;
    const rows = v.labels.map((l, i) => { const r = realDisp(v.vals[i], c, o); alt = alt || r.alt; return { label: l + '=', tokens: r.tokens }; });
    return { kind: 'lines', rows, alt };
  }
  if (isM(v)) {
    let alt = false;
    const cells = (v as Mat).a.map((row) => row.map((x) => { const r = realDisp(x, c, o); alt = alt || r.alt; return r.tokens; }));
    return { kind: 'mat', cells, vec: (v as Mat).vec, alt };
  }
  if (isC(v)) {
    const r = cplxDisp(v, c, o);
    return { kind: 'math', tokens: r.tokens, alt: r.alt };
  }
  const r = realDisp(v as number, c, o);
  return { kind: 'math', tokens: r.tokens, alt: r.alt };
}

export function baseLines(v: number, base: number): string[] {
  if (base === 10) return [String(v)];
  const u = v >>> 0;
  if (base === 16) return [u.toString(16).toUpperCase().padStart(8, '0')];
  if (base === 8) return [u.toString(8).padStart(11, '0')];
  const bits = u.toString(2).padStart(u < 65536 ? 16 : 32, '0');
  const groups = bits.match(/.{1,4}/g) as string[];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(' '));
  return lines;
}
