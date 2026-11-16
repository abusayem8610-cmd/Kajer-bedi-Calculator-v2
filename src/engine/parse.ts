// Token-stream parser and evaluator (no eval()).
import {
  CalcError, Cx, Mat, Tup, Val, Angle, isC, isM, toC, chop15, checkRange, cancelAdd, rpow, factorial, nPr, nCr,
  mathErr, syntaxErr, stackErr, argErr, dimErr, sinA, cosA, tanA, fromRad, toRad,
  cadd, csub, cmul, cdiv, cabs, carg, cconj, cln, csqrt, cpow, csin, ccos, ctan, csinh, ccosh, ctanh,
  casinh, cacosh, catanh, casin, cacos, catan, cclean, matAdd, matScale, matMul, vecDot, matDet, matTrn, matPow,
} from './core';
import { integrate, derivative } from './solvers';
import { CONSTS, CONVS } from './tables';

export type Fmt = { kind: 'norm1' | 'norm2' | 'fix' | 'sci'; n: number };

export interface Ctx {
  angle: Angle;
  cmplx: boolean;
  base: number; // 0 = decimal COMP-style, otherwise 2/8/10/16 (BASE-N)
  vars: Record<string, Val>;
  ans: Val;
  mats: Record<string, Mat | null>;
  statVars: Record<string, number>;
  statEst: (kind: 'x' | 'y', v: number) => number;
  disp: Fmt;
  dec: boolean; // result must be shown as decimal
  piOK: boolean; // pi multiples allowed in exact output
  hasFrac: boolean;
  dms: boolean;
  steps: number;
}

export function newCtx(): Ctx {
  return {
    angle: 'deg', cmplx: false, base: 0, vars: {}, ans: 0, mats: {}, statVars: {}, statEst: () => { throw mathErr(); },
    disp: { kind: 'norm1', n: 0 }, dec: false, piOK: false, hasFrac: false, dms: false, steps: 0,
  };
}

export const OPENERS = new Set(['FRAC', 'MIX', 'SQRT', 'CBRT', 'ROOT', 'POW', 'LOGB', 'ABS', 'INT', 'DER', 'SIG']);
export const STAT_VARS = new Set(['n', 'x̄', 'σx', 'sx', 'Σx', 'Σx²', 'minX', 'maxX', 'ȳ', 'σy', 'sy', 'Σy', 'Σy²', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴', 'minY', 'maxY', 'rA', 'rB', 'rC', 'rr']);
const SIMPLE_VARS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M', 'Ans', 'π', 'e', 'i', 'MatA', 'MatB', 'MatC', 'MatAns', 'VctA', 'VctB', 'VctC', 'VctAns']);
const isVarTok = (t: string) => SIMPLE_VARS.has(t) || STAT_VARS.has(t) || /^K\d\d$/.test(t);
const isFnTok = (t: string) => t.length > 1 && t.endsWith('(');

export function readGroup(t: string[], i: number): { secs: string[][]; next: number } {
  const secs: string[][] = [];
  let cur: string[] = [];
  let depth = 0;
  let j = i + 1;
  for (; j < t.length; j++) {
    const k = t[j];
    if (OPENERS.has(k)) { depth++; cur.push(k); }
    else if (k === 'END') {
      if (depth === 0) { secs.push(cur); return { secs, next: j + 1 }; }
      depth--; cur.push(k);
    } else if (k === 'SEP' && depth === 0) { secs.push(cur); cur = []; }
    else cur.push(k);
  }
  secs.push(cur);
  return { secs, next: t.length };
}

export type Node = any;

class Parser {
  t: string[];
  base: number;
  depth: number;
  p = 0;
  constructor(t: string[], base: number, depth = 0) {
    this.t = t; this.base = base; this.depth = depth;
    if (depth > 24) throw stackErr();
  }
  peek() { return this.t[this.p]; }
  parseAll(): Node {
    if (this.t.length === 0) throw syntaxErr();
    const n = this.base > 0 ? this.parseOr() : this.parseAdd();
    if (this.p < this.t.length) throw syntaxErr();
    return n;
  }
  sub(tokens: string[]): Node {
    return new Parser(tokens, this.base, this.depth + 1).parseAll();
  }
  parseOr(): Node {
    let l = this.parseAnd();
    while (['or', 'xor', 'xnor'].includes(this.peek())) {
      const op = this.t[this.p++];
      l = { t: 'bin', op, l, r: this.parseAnd() };
    }
    return l;
  }
  parseAnd(): Node {
    let l = this.parseAdd();
    while (this.peek() === 'and') { this.p++; l = { t: 'bin', op: 'and', l, r: this.parseAdd() }; }
    return l;
  }
  parseAdd(): Node {
    let l = this.parseMul();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.t[this.p++];
      l = { t: 'bin', op, l, r: this.parseMul() };
    }
    return l;
  }
  parseMul(): Node {
    let l = this.parsePerm();
    while (this.peek() === '×' || this.peek() === '÷' || this.peek() === '·') {
      const op = this.t[this.p++];
      l = { t: 'bin', op, l, r: this.parsePerm() };
    }
    return l;
  }
  parsePerm(): Node {
    let l = this.parsePolar();
    while (this.peek() === 'nPr' || this.peek() === 'nCr') {
      const op = this.t[this.p++];
      l = { t: 'bin', op, l, r: this.parsePolar() };
    }
    return l;
  }
  parsePolar(): Node {
    const l = this.parseImpl();
    if (this.peek() === '∠') { this.p++; const r = this.parseImpl(); return { t: 'polar', l, r }; }
    return l;
  }
  startsPrimary(k: string | undefined): boolean {
    if (!k) return false;
    if (/^[0-9.]$/.test(k)) return true;
    if (k === '(' || isFnTok(k) || isVarTok(k) || k === 'Ran#') return true;
    if (OPENERS.has(k) && k !== 'POW') return true;
    return false;
  }
  parseImpl(): Node {
    let l = this.parseUnary();
    while (this.base === 0 && this.startsPrimary(this.peek())) {
      const r = this.parsePost();
      l = { t: 'bin', op: '×', l, r, implicit: true };
    }
    return l;
  }
  parseUnary(): Node {
    const k = this.peek();
    if (k === '-') { this.p++; return { t: 'un', op: '-', e: this.parseUnary() }; }
    if (k === '+') { this.p++; return this.parseUnary(); }
    return this.parsePost();
  }
  parsePost(): Node {
    let e = this.parsePrimary();
    for (;;) {
      const k = this.peek();
      if (k === 'POW') {
        const g = readGroup(this.t, this.p);
        this.p = g.next;
        if (g.secs[0].length === 0) throw syntaxErr();
        e = { t: 'pow', b: e, e: this.sub(g.secs[0]) };
      } else if (k === '!') { this.p++; e = { t: 'fact', e }; }
      else if (k === '%') { this.p++; e = { t: 'pct', e }; }
      else if (/^Cv\d\d$/.test(k)) { this.p++; e = { t: 'conv', k, e }; }
      else if (k === 'D°' || k === 'ʳ' || k === 'ᵍ') { this.p++; e = { t: 'ang', u: k, e }; }
      else break;
    }
    return e;
  }
  isDigit(k: string | undefined) {
    return !!k && (/^[0-9]$/.test(k) || (this.base > 0 && /^[A-F]$/.test(k)));
  }
  readNumRaw(): { v: number; dec: boolean } {
    let s = '';
    let dec = false;
    while (this.p < this.t.length) {
      const k = this.t[this.p];
      if (this.isDigit(k)) { s += k; this.p++; }
      else if (k === '.' && this.base === 0) { if (dec) throw syntaxErr(); dec = true; s += '.'; this.p++; }
      else break;
    }
    if (s === '' || s === '.') throw syntaxErr();
    if (this.base > 0) {
      for (const ch of s) if (parseInt(ch, 16) >= this.base) throw syntaxErr();
      return { v: parseInt(s, this.base), dec: false };
    }
    return { v: parseFloat(s), dec };
  }
  parsePrimary(): Node {
    const k = this.peek();
    if (k === undefined) throw syntaxErr();
    if (this.isDigit(k) || (k === '.' && this.base === 0)) {
      const n = this.readNumRaw();
      if (this.base === 0 && this.peek() === '°') {
        this.p++;
        let m = 0, s = 0;
        if (this.isDigit(this.peek())) {
          const m1 = this.readNumRaw();
          if (this.peek() !== "'") throw syntaxErr();
          this.p++;
          m = m1.v;
          if (this.isDigit(this.peek())) {
            const s1 = this.readNumRaw();
            if (this.peek() !== '"') throw syntaxErr();
            this.p++;
            s = s1.v;
          }
        }
        return { t: 'n', v: n.v + m / 60 + s / 3600, dec: false, dms: true };
      }
      return { t: 'n', v: n.v, dec: n.dec };
    }
    if (k === '(') {
      this.p++;
      const depthSave = this.depth;
      const inner = new Parser(this.t, this.base, this.depth + 1);
      inner.p = this.p;
      const e = this.base > 0 ? inner.parseOr() : inner.parseAdd();
      this.p = inner.p;
      this.depth = depthSave;
      if (this.peek() === ')') this.p++;
      else if (this.p < this.t.length) throw syntaxErr();
      return e;
    }
    if (isFnTok(k)) {
      this.p++;
      const args: Node[] = [];
      const inner = new Parser(this.t, this.base, this.depth + 1);
      inner.p = this.p;
      if (inner.peek() === ')') throw syntaxErr();
      for (;;) {
        args.push(this.base > 0 ? inner.parseOr() : inner.parseAdd());
        if (inner.peek() === ',') { inner.p++; continue; }
        break;
      }
      this.p = inner.p;
      if (this.peek() === ')') this.p++;
      else if (this.p < this.t.length) throw syntaxErr();
      return { t: 'fn', n: k.slice(0, -1), args };
    }
    if (k === 'Ran#') { this.p++; return { t: 'fn', n: 'Ran#', args: [] }; }
    if (isVarTok(k)) { this.p++; return { t: 'var', n: k }; }
    if (OPENERS.has(k) && k !== 'POW') {
      const g = readGroup(this.t, this.p);
      this.p = g.next;
      const s = g.secs.map((x) => { if (x.length === 0) throw syntaxErr(); return this.sub(x); });
      const need: Record<string, number> = { FRAC: 2, MIX: 3, SQRT: 1, CBRT: 1, ROOT: 2, LOGB: 2, ABS: 1, INT: 3, DER: 2, SIG: 3 };
      if (s.length !== need[k]) throw syntaxErr();
      return { t: 'fn', n: k.toLowerCase(), args: s };
    }
    throw syntaxErr();
  }
}

export function parseTokens(tokens: string[], base = 0): Node {
  return new Parser(tokens, base).parseAll();
}

// -------------------------------------------------------------------------
const R = (v: Val): number => {
  if (typeof v === 'number') return v;
  if (v instanceof Cx) { if (v.im === 0) return v.re; throw mathErr(); }
  throw mathErr();
};
const normC = (z: Cx): Val => { const c = cclean(z); return c.im === 0 ? c.re : c; };
const rangeVal = (v: Val): Val => (typeof v === 'number' ? checkRange(v) : v);

function binop(op: string, a: Val, b: Val, _c: Ctx): Val {
  if (a instanceof Tup || b instanceof Tup) throw syntaxErr();
  if (isM(a) || isM(b)) {
    if (op === '+' || op === '-') {
      if (isM(a) && isM(b)) return matAdd(a, b, op === '+' ? 1 : -1);
      throw mathErr();
    }
    if (op === '×') {
      if (isM(a) && isM(b)) return matMul(a, b);
      if (isM(a)) return matScale(a, R(b));
      return matScale(b as Mat, R(a));
    }
    if (op === '÷') { if (isM(a) && !isM(b)) { const d = R(b); if (d === 0) throw mathErr(); return matScale(a, 1 / d); } throw mathErr(); }
    if (op === '·') { if (isM(a) && isM(b) && a.vec && b.vec) return vecDot(a, b); throw mathErr(); }
    throw mathErr();
  }
  if (op === 'nPr') return nPr(R(a), R(b));
  if (op === 'nCr') return nCr(R(a), R(b));
  if (op === '·') throw mathErr();
  if (isC(a) || isC(b)) {
    const x = toC(a), y = toC(b);
    switch (op) {
      case '+': return normC(cadd(x, y));
      case '-': return normC(csub(x, y));
      case '×': return normC(cmul(x, y));
      case '÷': return normC(cdiv(x, y));
    }
    throw syntaxErr();
  }
  const x = a as number, y = b as number;
  switch (op) {
    case '+': return checkRange(cancelAdd(x, y));
    case '-': return checkRange(cancelAdd(x, -y));
    case '×': return checkRange(x * y);
    case '÷': if (y === 0) throw mathErr(); return checkRange(x / y);
  }
  throw syntaxErr();
}

function powOp(a: Val, b: Val, c: Ctx): Val {
  if (isM(a)) return matPow(a, R(b));
  if (isM(b) || a instanceof Tup || b instanceof Tup) throw mathErr();
  if (isC(a) || isC(b)) return normC(cpow(toC(a), toC(b)));
  const x = a as number, y = b as number;
  if (c.cmplx && x < 0 && !Number.isInteger(y)) return normC(cpow(new Cx(x, 0), new Cx(y, 0)));
  return checkRange(rpow(x, y));
}

function roundDisp(x: number, f: Fmt): number {
  if (f.kind === 'fix') return Number(x.toFixed(f.n));
  if (f.kind === 'sci') return Number(x.toExponential(f.n === 0 ? 9 : Math.max(0, f.n - 1)));
  return Number(x.toPrecision(10));
}

const fns: Record<string, (a: Val[], c: Ctx) => Val> = {};
function def(names: string, f: (a: Val[], c: Ctx) => Val) { for (const n of names.split(' ')) fns[n] = f; }
const want = (a: Val[], n: number) => { if (a.length !== n) throw syntaxErr(); };
const markDec = (r: number, c: Ctx) => { if (!Number.isInteger(r)) c.dec = true; return r; };

function realOrComplex(
  a: Val[], c: Ctx, rf: (x: number) => number, cf: (z: Cx) => Cx, domainOk: (x: number) => boolean, dec = true,
): Val {
  want(a, 1);
  const v = a[0];
  if (isM(v) || v instanceof Tup) throw mathErr();
  if (isC(v)) { c.dec = true; return normC(cf(v)); }
  if (domainOk(v)) { const r = rf(v); return dec ? markDec(r, c) : r; }
  if (c.cmplx) { c.dec = true; return normC(cf(new Cx(v, 0))); }
  throw mathErr();
}
const always = () => true;
def('sin', (a, c) => realOrComplex(a, c, (x) => sinA(x, c.angle), csin, always, false));
def('cos', (a, c) => realOrComplex(a, c, (x) => cosA(x, c.angle), ccos, always, false));
def('tan', (a, c) => realOrComplex(a, c, (x) => tanA(x, c.angle), ctan, always, false));
def('asin', (a, c) => { if (c.angle === 'rad') c.piOK = true; return realOrComplex(a, c, (x) => chop15(fromRad(Math.asin(x), c.angle)), casin, (x) => Math.abs(x) <= 1, false); });
def('acos', (a, c) => { if (c.angle === 'rad') c.piOK = true; return realOrComplex(a, c, (x) => chop15(fromRad(Math.acos(x), c.angle)), cacos, (x) => Math.abs(x) <= 1, false); });
def('atan', (a, c) => { if (c.angle === 'rad') c.piOK = true; return realOrComplex(a, c, (x) => chop15(fromRad(Math.atan(x), c.angle)), catan, always, false); });
def('sinh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.sinh(x)), csinh, always));
def('cosh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.cosh(x)), ccosh, always));
def('tanh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.tanh(x)), ctanh, always));
def('asinh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.asinh(x)), casinh, always));
def('acosh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.acosh(x)), cacosh, (x) => x >= 1));
def('atanh', (a, c) => realOrComplex(a, c, (x) => chop15(Math.atanh(x)), catanh, (x) => Math.abs(x) < 1));
def('log', (a, c) => realOrComplex(a, c, (x) => chop15(Math.log10(x)), (z) => { const l = cln(z); return new Cx(l.re / Math.LN10, l.im / Math.LN10); }, (x) => x > 0));
def('ln', (a, c) => realOrComplex(a, c, (x) => chop15(Math.log(x)), cln, (x) => x > 0));
def('sqrt', (a, c) => realOrComplex(a, c, (x) => Math.sqrt(x), csqrt, (x) => x >= 0, false));
def('cbrt', (a) => {
  want(a, 1);
  if (isC(a[0])) return normC(cpow(a[0], new Cx(1 / 3, 0)));
  return Math.cbrt(R(a[0]));
});
def('root', (a, c) => {
  want(a, 2);
  const n = R(a[0]);
  if (isC(a[1])) return normC(cpow(a[1], new Cx(1 / n, 0)));
  const x = R(a[1]);
  if (n === 0) throw mathErr();
  if (x < 0) {
    if (c.cmplx) return normC(cpow(new Cx(x, 0), new Cx(1 / n, 0)));
  }
  return rpow(x, 1 / n);
});
def('abs', (a) => {
  want(a, 1);
  const v = a[0];
  if (isC(v)) return cabs(v);
  if (isM(v)) return Math.sqrt(v.a.flat().reduce((s, x) => s + x * x, 0));
  return Math.abs(R(v));
});
def('arg', (a, c) => { want(a, 1); if (!c.cmplx) throw syntaxErr(); return chop15(fromRad(carg(toC(a[0])), c.angle)); });
def('Conjg', (a, c) => { want(a, 1); if (!c.cmplx) throw syntaxErr(); return normC(cconj(toC(a[0]))); });
def('Re', (a, c) => { want(a, 1); if (!c.cmplx) throw syntaxErr(); return toC(a[0]).re; });
def('Im', (a, c) => { want(a, 1); if (!c.cmplx) throw syntaxErr(); return toC(a[0]).im; });
def('frac', (a, c) => { c.hasFrac = true; return binop('÷', a[0], a[1], c); });
def('mix', (a, c) => {
  c.hasFrac = true;
  const w = R(a[0]);
  const f = binop('÷', a[1], a[2], c) as number;
  return w < 0 ? checkRange(w - f) : checkRange(w + f);
});
def('logb', (a, c) => {
  want(a, 2);
  const b = R(a[0]), x = R(a[1]);
  if (b <= 0 || b === 1 || x <= 0) throw mathErr();
  return markDec(chop15(Math.log(x) / Math.log(b)), c);
});
def('Pol', (a, c) => {
  want(a, 2);
  const x = R(a[0]), y = R(a[1]);
  const r = chop15(Math.hypot(x, y));
  const th = chop15(fromRad(Math.atan2(y, x), c.angle));
  c.vars.X = r; c.vars.Y = th;
  return new Tup([r, th], ['r', 'θ']);
});
def('Rec', (a, c) => {
  want(a, 2);
  const r = R(a[0]), th = R(a[1]);
  const x = chop15(r * cosA(th, c.angle)), y = chop15(r * sinA(th, c.angle));
  c.vars.X = x; c.vars.Y = y;
  return new Tup([x, y], ['x', 'y']);
});
def('Ran#', (_a, c) => { c.dec = true; return Math.floor(Math.random() * 1000) / 1000; });
def('RanInt', (a) => {
  want(a, 2);
  const lo = R(a[0]), hi = R(a[1]);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi || Math.abs(lo) >= 1e10 || Math.abs(hi) >= 1e10) throw mathErr();
  return lo + Math.floor(Math.random() * (hi - lo + 1));
});
def('Rnd', (a, c) => { want(a, 1); return roundDisp(R(a[0]), c.disp); });
def('det', (a) => { want(a, 1); if (!isM(a[0])) throw mathErr(); return matDet(a[0]); });
def('Trn', (a) => { want(a, 1); if (!isM(a[0])) throw mathErr(); return matTrn(a[0]); });
def('Ide', (a) => {
  want(a, 1);
  const n = R(a[0]);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw argErr();
  const m = Mat.zeros(n, n);
  for (let i = 0; i < n; i++) m.a[i][i] = 1;
  return m;
});
def('x̂', (a, c) => { want(a, 1); return c.statEst('x', R(a[0])); });
def('ŷ', (a, c) => { want(a, 1); return c.statEst('y', R(a[0])); });

function withX<T>(c: Ctx, f: () => T): T {
  const saved = c.vars.X;
  try { return f(); } finally { c.vars.X = saved; }
}

function ev(n: Node, c: Ctx): Val {
  if (++c.steps > 3_000_000) throw new CalcError('Time Out');
  switch (n.t) {
    case 'n':
      if (n.dec) c.dec = true;
      if (n.dms) c.dms = true;
      return n.v;
    case 'var': return evVar(n.n, c);
    case 'bin': {
      const a = ev(n.l, c), b = ev(n.r, c);
      return binop(n.op, a, b, c);
    }
    case 'polar': {
      if (!c.cmplx) throw syntaxErr();
      const r = R(ev(n.l, c)), th = R(ev(n.r, c));
      return normC(new Cx(r * cosA(th, c.angle), r * sinA(th, c.angle)));
    }
    case 'un': {
      const v = ev(n.e, c);
      if (typeof v === 'number') return -v;
      if (isC(v)) return new Cx(-v.re, -v.im);
      if (isM(v)) return matScale(v, -1);
      throw syntaxErr();
    }
    case 'pow': return powOp(ev(n.b, c), ev(n.e, c), c);
    case 'fact': return factorial(R(ev(n.e, c)));
    case 'pct': { const v = ev(n.e, c); if (typeof v !== 'number') throw mathErr(); return v / 100; }
    case 'ang': {
      const x = R(ev(n.e, c));
      const k = n.u;
      let rad: number;
      if (k === 'D°') rad = (x * Math.PI) / 180; else if (k === 'ʳ') rad = x; else rad = (x * Math.PI) / 200;
      if ((k === 'D°' && c.angle === 'deg') || (k === 'ʳ' && c.angle === 'rad') || (k === 'ᵍ' && c.angle === 'gra')) return x;
      return chop15(fromRad(rad, c.angle));
    }
    case 'fn': return evFn(n, c);
    case 'conv': {
      const x = R(ev(n.e, c));
      const cv = CONVS[parseInt(n.k.slice(2), 10) - 1];
      if (!cv) throw syntaxErr();
      c.dec = true;
      return cv.f(x);
    }
  }
  throw syntaxErr();
}

function evVar(name: string, c: Ctx): Val {
  switch (name) {
    case 'π': c.piOK = true; return Math.PI;
    case 'e': return Math.E;
    case 'i': if (!c.cmplx) throw syntaxErr(); return new Cx(0, 1);
    case 'Ans': return c.ans instanceof Tup ? c.ans.vals[0] : c.ans;
  }
  if (/^K\d\d$/.test(name)) {
    const k = CONSTS[parseInt(name.slice(1), 10) - 1];
    if (!k) throw syntaxErr();
    c.dec = true;
    return k.v;
  }
  if (name.startsWith('Mat') || name.startsWith('Vct')) {
    const m = c.mats[name];
    if (!m) throw mathErr();
    return m;
  }
  if (STAT_VARS.has(name)) {
    const v = c.statVars[name];
    if (v === undefined || !isFinite(v)) throw mathErr();
    return v;
  }
  const v = c.vars[name];
  return v === undefined ? 0 : v;
}

function evFn(n: Node, c: Ctx): Val {
  const name: string = n.n;
  if (name === 'int') {
    const a = R(ev(n.args[1], c)), b = R(ev(n.args[2], c));
    c.dec = true;
    return withX(c, () => integrate((x) => { c.vars.X = x; return R(ev(n.args[0], c)); }, a, b));
  }
  if (name === 'der') {
    const x0 = R(ev(n.args[1], c));
    c.dec = true;
    return withX(c, () => derivative((x) => { c.vars.X = x; return R(ev(n.args[0], c)); }, x0));
  }
  if (name === 'sig') {
    const a = R(ev(n.args[1], c)), b = R(ev(n.args[2], c));
    if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 1e5) throw mathErr();
    return withX(c, () => {
      let s = 0;
      for (let k = a; k <= b; k++) { c.vars.X = k; s += R(ev(n.args[0], c)); }
      return checkRange(s);
    });
  }
  const args = n.args.map((x: Node) => ev(x, c));
  const f = fns[name];
  if (!f) throw syntaxErr();
  return rangeVal(f(args, c));
}

// ---------------- BASE-N integer evaluation ------------------------------
const W32 = 1n << 32n;
function wrap(v: bigint): number {
  let r = ((v % W32) + W32) % W32;
  if (r >= 1n << 31n) r -= W32;
  return Number(r);
}
function evBase(n: Node, c: Ctx): number {
  switch (n.t) {
    case 'n': {
      if (n.v > 0xffffffff) throw mathErr();
      return n.v > 0x7fffffff ? (c.base === 10 ? (() => { throw mathErr(); })() : n.v - 0x100000000) : n.v;
    }
    case 'var': {
      if (n.n === 'Ans') return Math.trunc(Number(c.ans instanceof Tup ? 0 : c.ans));
      throw syntaxErr();
    }
    case 'un': return wrapChecked(-BigInt(evBase(n.e, c)), c);
    case 'bin': {
      const a = BigInt(evBase(n.l, c)), b = BigInt(evBase(n.r, c));
      switch (n.op) {
        case '+': return wrapChecked(a + b, c);
        case '-': return wrapChecked(a - b, c);
        case '×': return wrapChecked(a * b, c);
        case '÷': if (b === 0n) throw mathErr(); return wrapChecked(a / b, c);
        case 'and': return wrap(a & b);
        case 'or': return wrap(a | b);
        case 'xor': return wrap(a ^ b);
        case 'xnor': return wrap(~(a ^ b));
      }
      throw syntaxErr();
    }
    case 'fn': {
      if (n.n === 'Not') return wrap(~BigInt(evBase(n.args[0], c)));
      if (n.n === 'Neg') return wrapChecked(-BigInt(evBase(n.args[0], c)), c);
      throw syntaxErr();
    }
  }
  throw syntaxErr();
}
function wrapChecked(v: bigint, c: Ctx): number {
  if (v > 0x7fffffffn || v < -0x80000000n) {
    if (c.base === 10) throw mathErr();
  }
  return wrap(v);
}

/** Evaluate a flat token stream. */
export function evalTokens(tokens: string[], c: Ctx): Val {
  c.dec = false; c.piOK = false; c.hasFrac = false; c.dms = false; c.steps = 0;
  if (c.base > 0) {
    const node = parseTokens(tokens, c.base);
    return evBase(node, c);
  }
  const node = parseTokens(tokens, 0);
  const v = ev(node, c);
  if (isC(v)) return normC(v);
  if (typeof v === 'number') return checkRange(v);
  return v;
}

export { toRad };
export type { Val };
export { dimErr };
