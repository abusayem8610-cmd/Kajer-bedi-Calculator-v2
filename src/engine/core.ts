// Core value types, errors and numeric helpers for the fx-991ES PLUS engine.

export class CalcError extends Error {
  msg: string;
  constructor(msg: string) {
    super(msg);
    this.msg = msg;
  }
}
export const mathErr = () => new CalcError('Math ERROR');
export const syntaxErr = () => new CalcError('Syntax ERROR');
export const stackErr = () => new CalcError('Stack ERROR');
export const argErr = () => new CalcError('Argument ERROR');
export const dimErr = () => new CalcError('Dimension ERROR');
export const varErr = () => new CalcError('Variable ERROR');
export const cantSolve = () => new CalcError("Can't Solve");

export class Cx {
  re: number;
  im: number;
  constructor(re: number, im = 0) {
    this.re = re;
    this.im = im;
  }
}
export class Mat {
  r: number;
  c: number;
  a: number[][];
  vec: boolean;
  constructor(r: number, c: number, a: number[][], vec = false) {
    this.r = r;
    this.c = c;
    this.a = a;
    this.vec = vec;
  }
  static zeros(r: number, c: number, vec = false) {
    return new Mat(r, c, Array.from({ length: r }, () => Array(c).fill(0)), vec);
  }
  clone() {
    return new Mat(this.r, this.c, this.a.map((x) => x.slice()), this.vec);
  }
}
/** Multi-valued result such as Pol( / Rec( */
export class Tup {
  vals: number[];
  labels: string[];
  constructor(vals: number[], labels: string[]) {
    this.vals = vals;
    this.labels = labels;
  }
}
export type Val = number | Cx | Mat | Tup;

export const isC = (v: unknown): v is Cx => v instanceof Cx;
export const isM = (v: unknown): v is Mat => v instanceof Mat;
export const toC = (v: Val): Cx => (v instanceof Cx ? v : new Cx(v as number, 0));
export const chop15 = (v: number) => (isFinite(v) ? Number(v.toPrecision(15)) : v);

export function checkRange(v: number): number {
  if (!isFinite(v) || Math.abs(v) >= 1e100) throw mathErr();
  return v;
}

// ---------- complex -------------
export const cadd = (a: Cx, b: Cx) => new Cx(a.re + b.re, a.im + b.im);
export const csub = (a: Cx, b: Cx) => new Cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Cx, b: Cx) => new Cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export function cdiv(a: Cx, b: Cx) {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) throw mathErr();
  return new Cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
export const cabs = (a: Cx) => Math.hypot(a.re, a.im);
export const carg = (a: Cx) => Math.atan2(a.im, a.re);
export const cconj = (a: Cx) => new Cx(a.re, -a.im);
export const cexp = (a: Cx) => {
  const m = Math.exp(a.re);
  return new Cx(m * Math.cos(a.im), m * Math.sin(a.im));
};
export function cln(a: Cx) {
  if (a.re === 0 && a.im === 0) throw mathErr();
  return new Cx(Math.log(cabs(a)), carg(a));
}
export function csqrt(a: Cx) {
  const m = cabs(a);
  const re = Math.sqrt((m + a.re) / 2);
  let im = Math.sqrt(Math.max(0, (m - a.re) / 2));
  if (a.im < 0) im = -im;
  return new Cx(re, im);
}
export function cpow(a: Cx, b: Cx) {
  if (a.re === 0 && a.im === 0) {
    if (b.re === 0 && b.im === 0) throw mathErr();
    if (b.re < 0) throw mathErr();
    return new Cx(0, 0);
  }
  // integer exponents: repeated multiplication for accuracy
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) {
    let r = new Cx(1, 0);
    const n = Math.abs(b.re);
    for (let i = 0; i < n; i++) r = cmul(r, a);
    return b.re < 0 ? cdiv(new Cx(1, 0), r) : r;
  }
  return cexp(cmul(b, cln(a)));
}
const I = new Cx(0, 1);
export const csin = (z: Cx) => new Cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
export const ccos = (z: Cx) => new Cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
export const ctan = (z: Cx) => cdiv(csin(z), ccos(z));
export const csinh = (z: Cx) => new Cx(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im));
export const ccosh = (z: Cx) => new Cx(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im));
export const ctanh = (z: Cx) => cdiv(csinh(z), ccosh(z));
export const casinh = (z: Cx) => cln(cadd(z, csqrt(cadd(cmul(z, z), new Cx(1, 0)))));
export const cacosh = (z: Cx) =>
  cln(cadd(z, cmul(csqrt(cadd(z, new Cx(1, 0))), csqrt(csub(z, new Cx(1, 0))))));
export const catanh = (z: Cx) => {
  const r = cln(cdiv(cadd(new Cx(1, 0), z), csub(new Cx(1, 0), z)));
  return new Cx(r.re / 2, r.im / 2);
};
export const casin = (z: Cx) => {
  // -i ln(iz + sqrt(1 - z^2))
  const t = cln(cadd(cmul(I, z), csqrt(csub(new Cx(1, 0), cmul(z, z)))));
  return new Cx(t.im, -t.re);
};
export const cacos = (z: Cx) => {
  const a = casin(z);
  return new Cx(Math.PI / 2 - a.re, -a.im);
};
export const catan = (z: Cx) => {
  // (i/2) ln((i+z)/(i-z))
  const t = cln(cdiv(cadd(I, z), csub(I, z)));
  return new Cx(-t.im / 2, t.re / 2);
};

/** collapse complex values with negligible imaginary part */
export function cclean(z: Cx): Cx {
  const s = Math.max(Math.abs(z.re), Math.abs(z.im), 1e-300);
  const re = Math.abs(z.re) < 1e-14 * Math.max(Math.abs(z.im), 1e-300) ? 0 : z.re;
  const im = Math.abs(z.im) < 1e-14 * s ? 0 : z.im;
  return new Cx(re, im);
}

// ---------- real helpers -------------
export function cancelAdd(a: number, b: number): number {
  const s = a + b;
  const m = Math.max(Math.abs(a), Math.abs(b));
  if (m > 0 && Math.abs(s) < m * 1e-15) return 0;
  return s;
}

export function rpow(a: number, b: number): number {
  if (a === 0 && b === 0) throw mathErr();
  if (a === 0 && b < 0) throw mathErr();
  if (a < 0 && !Number.isInteger(b)) {
    // odd root support: b = p/q with q odd
    for (let q = 1; q <= 99; q += 2) {
      const p = b * q;
      if (Math.abs(p - Math.round(p)) < 1e-12) {
        const r = Math.pow(-a, b);
        return Math.round(p) % 2 === 0 ? r : -r;
      }
    }
    throw mathErr();
  }
  const r = Math.pow(a, b);
  if (!isFinite(r)) throw mathErr();
  return r;
}

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 69) throw mathErr();
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
export function nPr(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw mathErr();
  let v = 1;
  for (let i = 0; i < r; i++) {
    v *= n - i;
    if (!isFinite(v)) throw mathErr();
  }
  return checkRange(v);
}
export function nCr(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw mathErr();
  const k = Math.min(r, n - r);
  let v = 1;
  for (let i = 1; i <= k; i++) {
    v = (v * (n - k + i)) / i;
    if (!isFinite(v)) throw mathErr();
  }
  return checkRange(Math.round(v) === v || v > 1e15 ? v : Math.round(v));
}

export type Angle = 'deg' | 'rad' | 'gra';
export const toRad = (x: number, a: Angle) => (a === 'deg' ? (x * Math.PI) / 180 : a === 'gra' ? (x * Math.PI) / 200 : x);
export const fromRad = (x: number, a: Angle) => (a === 'deg' ? (x * 180) / Math.PI : a === 'gra' ? (x * 200) / Math.PI : x);
const quarterTurns = (x: number, a: Angle) => (a === 'deg' ? x / 90 : a === 'gra' ? x / 100 : x / (Math.PI / 2));
function snapQ(x: number, a: Angle): number | null {
  const q = quarterTurns(x, a);
  const n = Math.round(q);
  if (Math.abs(q - n) < 1e-11 * Math.max(1, Math.abs(q))) return ((n % 4) + 4) % 4;
  return null;
}
export function sinA(x: number, a: Angle) {
  const s = snapQ(x, a);
  if (s !== null) return [0, 1, 0, -1][s];
  return chop15(Math.sin(toRad(x, a)));
}
export function cosA(x: number, a: Angle) {
  const s = snapQ(x, a);
  if (s !== null) return [1, 0, -1, 0][s];
  return chop15(Math.cos(toRad(x, a)));
}
export function tanA(x: number, a: Angle) {
  const s = snapQ(x, a);
  if (s !== null) {
    if (s % 2 === 1) throw mathErr();
    return 0;
  }
  return chop15(Math.tan(toRad(x, a)));
}

// ---------- matrix ops -------------
export function matAdd(a: Mat, b: Mat, sign = 1): Mat {
  if (a.r !== b.r || a.c !== b.c) throw dimErr();
  return new Mat(a.r, a.c, a.a.map((row, i) => row.map((v, j) => v + sign * b.a[i][j])), a.vec && b.vec);
}
export function matScale(a: Mat, k: number): Mat {
  return new Mat(a.r, a.c, a.a.map((row) => row.map((v) => v * k)), a.vec);
}
export function matMul(a: Mat, b: Mat): Mat {
  if (a.vec && b.vec) {
    // cross product
    const pa = vecOf(a), pb = vecOf(b);
    if (pa.length !== pb.length) throw dimErr();
    const x = pa.length === 2 ? [pa[0], pa[1], 0] : pa;
    const y = pb.length === 2 ? [pb[0], pb[1], 0] : pb;
    const cr = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    const out = pa.length === 2 ? cr : cr;
    return new Mat(1, 3, [out], true);
  }
  if (a.c !== b.r) throw dimErr();
  const out = Mat.zeros(a.r, b.c, false);
  for (let i = 0; i < a.r; i++)
    for (let j = 0; j < b.c; j++) {
      let s = 0;
      for (let k = 0; k < a.c; k++) s += a.a[i][k] * b.a[k][j];
      out.a[i][j] = s;
    }
  return out;
}
export const vecOf = (m: Mat): number[] => (m.r === 1 ? m.a[0].slice() : m.a.map((r) => r[0]));
export function vecDot(a: Mat, b: Mat): number {
  const x = vecOf(a), y = vecOf(b);
  if (x.length !== y.length) throw dimErr();
  return x.reduce((s, v, i) => s + v * y[i], 0);
}
export function matDet(m: Mat): number {
  if (m.vec || m.r !== m.c) throw dimErr();
  const n = m.r;
  const a = m.a.map((r) => r.slice());
  let det = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    if (Math.abs(a[p][i]) < 1e-300) return 0;
    if (p !== i) {
      [a[p], a[i]] = [a[i], a[p]];
      det = -det;
    }
    det *= a[i][i];
    for (let k = i + 1; k < n; k++) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return chop15(det);
}
export function matInv(m: Mat): Mat {
  if (m.vec || m.r !== m.c) throw dimErr();
  const n = m.r;
  const a = m.a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    if (Math.abs(a[p][i]) < 1e-12 * Math.max(1, ...m.a.flat().map(Math.abs))) throw mathErr();
    [a[p], a[i]] = [a[i], a[p]];
    const d = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= d;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = a[k][i];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return new Mat(n, n, a.map((r) => r.slice(n).map(chop15)));
}
export function matTrn(m: Mat): Mat {
  if (m.vec) throw dimErr();
  const out = Mat.zeros(m.c, m.r);
  for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) out.a[j][i] = m.a[i][j];
  return out;
}
export function matPow(m: Mat, n: number): Mat {
  if (m.vec || m.r !== m.c || !Number.isInteger(n)) throw dimErr();
  if (n === -1) return matInv(m);
  if (n < 0) throw mathErr();
  let r = Mat.zeros(m.r, m.c);
  for (let i = 0; i < m.r; i++) r.a[i][i] = 1;
  for (let i = 0; i < n; i++) r = matMul(r, m);
  return r;
}
