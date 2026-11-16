// The calculator state machine: keys, modes, menus, editors and results.
import { CalcError, Cx, Mat, Tup, Val, Angle, mathErr, syntaxErr, argErr } from '../engine/core';
import { Ctx, Fmt, newCtx, evalTokens } from '../engine/parse';
import { Disp, formatVal, decTokens, plainNumTokens, baseLines } from '../engine/format';
import { findRoot, solveLinear, quadRoots, cubicRoots, statCompute, statEstimate, StatType, statIs2 } from '../engine/solvers';
import { CONSTS, CONVS } from '../engine/tables';
import { Ed, insert, template, del, vertical, captureBefore, splitTop, complexity } from './editor';

export type ModeName = 'COMP' | 'CMPLX' | 'STAT' | 'BASE' | 'EQN' | 'MATRIX' | 'TABLE' | 'VECTOR';

export interface Setup {
  io: 'math' | 'line';
  angle: Angle;
  fmt: Fmt;
  frac: 'mixed' | 'improper';
  cmplxFmt: 'rect' | 'polar';
  stat: boolean;
  dot: boolean;
  table: 'f' | 'fg';
}
const defaultSetup = (): Setup => ({
  io: 'math', angle: 'deg', fmt: { kind: 'norm1', n: 0 }, frac: 'mixed', cmplxFmt: 'rect', stat: false, dot: true, table: 'f',
});

export interface MenuItem { label: string; detail?: string; run: () => void }
export interface Menu {
  k: 'menu'; title: string; pages: MenuItem[][]; page: number; top: number; sel: number;
  cols: 1 | 2; multi: boolean; buf: string; visible: number;
}
export interface Grid {
  kind: 'stat' | 'mat' | 'vec' | 'eqn';
  title: string;
  nrows: () => number;
  ncols: number;
  colHead: string[];
  rowHead: (r: number) => string;
  get: (r: number, c: number) => number | null;
  set: (r: number, c: number, v: number | null) => void;
  growable: boolean;
  cr: number; cc: number; top: number;
  delRow?: (r: number) => void;
}
export interface TableRow { x: number; f: number | null; g: number | null }
export type Screen =
  | { k: 'calc' }
  | Menu
  | { k: 'digit'; text: string; on: (d: number) => void }
  | { k: 'confirm'; text: string; on: () => void }
  | { k: 'input'; label: string; onSubmit: (tk: string[]) => void; fresh: boolean }
  | { k: 'grid'; g: Grid; editing: boolean }
  | { k: 'table'; rows: TableRow[]; top: number; hasG: boolean }
  | { k: 'eqn'; rows: { label: string; tokens: string[] }[]; idx: number };

export type CatEvent =
  | { type: 'key' }
  | { type: 'type'; score: number; pos: number; tokens: string[] }
  | { type: 'result'; score: number; long: boolean; tokens?: string[] }
  | { type: 'error'; score: number; tokens: string[] }
  | { type: 'del'; score: number; tokens: string[] }
  | { type: 'ac' }
  | { type: 'mode' };

interface Res { v: Val; ctx: Ctx; mods: { dms?: boolean; polar?: boolean; rect?: boolean } }
interface HistEntry { tk: string[]; disp: Disp; res: Res }

const VAR_KEYS: Record<string, string> = { neg: 'A', dms: 'B', hyp: 'C', sin: 'D', cos: 'E', tan: 'F', rparen: 'X', sd: 'Y', mplus: 'M' };
const STO_VARS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M']);
const BASE_ALLOWED = /^([0-9A-F]|\+|-|×|÷|\(|\)|Ans|and|or|xor|xnor|Not\(|Neg\()$/;

export class Machine {
  off = false;
  shift = false;
  alpha = false;
  sto = false;
  rcl = false;
  hyp = false;
  ovw = false;
  mode: ModeName = 'COMP';
  setup: Setup = defaultSetup();
  vars: Record<string, Val> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 };
  ans: Val = 0;
  mats: Record<string, Mat | null> = {};
  statType: StatType = '1var';
  stat = { x: [null] as (number | null)[], y: [null] as (number | null)[], f: [1] as (number | null)[] };
  tableF: string[] = [];
  tableG: string[] = [];
  tableP = { start: 1, end: 5, step: 1 };
  eqnType = 1;
  eqnCoef: number[][] = [];
  baseSel = 10;

  tk: string[] = [];
  cur = 0;
  disp: Disp | null = null;
  res: Res | null = null;
  done = false;
  err: string | null = null;
  hist: HistEntry[] = [];
  histIdx: number | null = null;
  forceDec = false;
  mixedFlip = false;
  engShift: number | null = null;
  screen: Screen = { k: 'calc' };
  stash: Ed | null = null;
  calcSess: { vars: string[]; i: number; tokens: string[] } | null = null;
  prevScreen: Screen = { k: 'calc' };

  version = 0;
  listeners = new Set<() => void>();
  onEvent: ((e: CatEvent) => void) | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private touch() { this.version++; this.listeners.forEach((l) => l()); }
  private fire(e: CatEvent) { if (this.onEvent) this.onEvent(e); }
  private get ed(): Ed { return this as unknown as Ed; }

  // ---------------------------------------------------------------- entry
  press(id: string) {
    if (this.off) {
      if (id === 'on') { this.off = false; this.touch(); this.fire({ type: 'key' }); }
      return;
    }
    if (id === 'shift') { this.shift = !this.shift; this.alpha = false; this.touch(); this.fire({ type: 'key' }); return; }
    if (id === 'alpha') { this.alpha = !this.alpha; this.shift = false; this.touch(); this.fire({ type: 'key' }); return; }
    const shift = this.shift, alpha = this.alpha;
    this.shift = false; this.alpha = false;
    if (!(id === 'sin' || id === 'cos' || id === 'tan')) this.hyp = false;
    try {
      this.dispatch(id, shift, alpha);
    } catch (e) {
      if (e instanceof CalcError) this.fail(e.msg);
      else { console.error(e); this.fail('Math ERROR'); }
    }
    this.touch();
  }

  private fail(msg: string) {
    this.err = msg;
    this.disp = { kind: 'err', msg };
    this.done = false;
    this.fire({ type: 'error', score: complexity(this.tk), tokens: this.tk.slice() });
  }

  private dispatch(id: string, shift: boolean, alpha: boolean) {
    if (id === 'on') return;
    if (shift && id === 'ac') { this.off = true; this.fire({ type: 'key' }); return; }
    if (this.err) {
      if (id === 'ac') { this.err = null; this.disp = null; this.tk = []; this.cur = 0; this.screen = { k: 'calc' }; this.fire({ type: 'ac' }); }
      else if (id === 'left' || id === 'right') { this.err = null; this.disp = null; this.cur = id === 'left' ? this.tk.length : 0; this.fire({ type: 'key' }); }
      return;
    }
    if (this.sto || this.rcl) { this.storeRecall(id); return; }
    if (id === 'mode') { this.fire({ type: 'key' }); if (shift) this.openSetup(); else this.openModeMenu(); return; }
    if (shift && id === 'd9') { this.fire({ type: 'key' }); this.openClr(); return; }
    const s = this.screen;
    switch (s.k) {
      case 'menu': return this.menuKey(s, id);
      case 'digit': if (id === 'ac') this.screen = { k: 'calc' }; else if (/^d[0-9]$/.test(id)) s.on(Number(id[1])); return;
      case 'confirm': if (id === 'exe') s.on(); else if (id === 'ac') this.screen = { k: 'calc' }; return;
      case 'grid': return this.gridKey(s, id, shift, alpha);
      case 'table': return this.tableKey(s, id);
      case 'eqn': return this.eqnKey(s, id);
      default: return this.calcKey(id, shift, alpha);
    }
  }

  // ---------------------------------------------------------------- calc / input editing
  private calcKey(id: string, shift: boolean, alpha: boolean) {
    const s = this.screen;
    switch (id) {
      case 'ac': return this.acKey();
      case 'del':
        if (shift) { this.ovw = !this.ovw; return; }
        if (this.done) { this.done = false; this.disp = null; this.cur = this.tk.length; this.calcSess = null; }
        if (s.k === 'input') s.fresh = false;
        del(this.ed);
        this.fire({ type: 'del', score: complexity(this.tk), tokens: this.tk.slice() });
        return;
      case 'exe': return this.exe();
      case 'left': case 'right': case 'up': case 'down': return this.arrow(id);
      case 'calc':
        if (alpha) return this.typeKey(id, shift, alpha);
        if (s.k !== 'calc') return;
        return shift ? this.startSolve() : this.startCalc();
      case 'rcl': if (shift) this.sto = true; else this.rcl = true; this.fire({ type: 'key' }); return;
      case 'sd':
        if (alpha) break;
        if (this.done && this.res) {
          if (shift) this.mixedFlip = !this.mixedFlip; else this.forceDec = !this.forceDec;
          this.disp = this.makeDisp();
        }
        this.fire({ type: 'key' });
        return;
      case 'eng':
        if (this.mode === 'CMPLX' || alpha) break;
        if (this.done && this.res && typeof this.res.v === 'number') {
          this.engShift = (this.engShift === null ? 0 : this.engShift) + (shift ? -1 : this.engShift === null ? 0 : 1);
          this.disp = this.makeDisp();
        }
        this.fire({ type: 'key' });
        return;
      case 'mplus':
        if (alpha) break;
        return this.memory(shift ? -1 : 1);
      case 'hyp':
        if (!shift && !alpha && this.mode !== 'BASE') { this.hyp = true; this.fire({ type: 'key' }); return; }
        break;
    }
    this.typeKey(id, shift, alpha);
  }

  private acKey() {
    const s = this.screen;
    if (s.k === 'input') { this.endInput(); this.calcSess = null; this.fire({ type: 'ac' }); return; }
    if (this.calcSess && this.done) { this.calcSess = null; this.done = false; this.disp = null; this.cur = this.tk.length; this.fire({ type: 'ac' }); return; }
    this.calcSess = null;
    this.tk = []; this.cur = 0; this.disp = null; this.done = false; this.histIdx = null; this.res = null;
    this.forceDec = false; this.mixedFlip = false; this.engShift = null;
    this.fire({ type: 'ac' });
  }

  private arrow(id: string) {
    const s = this.screen;
    if (this.done && (id === 'left' || id === 'right')) {
      this.done = false; this.disp = null; this.calcSess = null; this.histIdx = null;
      this.cur = id === 'left' ? this.tk.length : 0;
      this.fire({ type: 'key' });
      return;
    }
    if (id === 'left') { if (this.cur > 0) this.cur--; }
    else if (id === 'right') { if (this.cur < this.tk.length) this.cur++; }
    else {
      if (!this.done && vertical(this.ed, id as 'up' | 'down')) { this.fire({ type: 'key' }); return; }
      if (s.k === 'calc') this.historyNav(id as 'up' | 'down');
    }
    if (s.k === 'input') s.fresh = false;
    this.fire({ type: 'key' });
  }

  private historyNav(dir: 'up' | 'down') {
    if (dir === 'up') {
      if (!this.hist.length) return;
      this.histIdx = this.histIdx === null ? this.hist.length - 1 : Math.max(0, this.histIdx - 1);
    } else {
      if (this.histIdx === null) return;
      if (this.histIdx >= this.hist.length - 1) {
        this.histIdx = null; this.tk = []; this.cur = 0; this.disp = null; this.done = false; this.res = null;
        return;
      }
      this.histIdx++;
    }
    const h = this.hist[this.histIdx!];
    this.tk = h.tk.slice(); this.cur = this.tk.length; this.res = h.res; this.done = true; this.calcSess = null;
    this.disp = this.makeDisp();
  }

  private beginEdit(opLike: boolean) {
    const s = this.screen;
    if (s.k === 'input' && s.fresh) { this.tk = []; this.cur = 0; s.fresh = false; }
    if (this.done) {
      this.done = false; this.disp = null; this.histIdx = null; this.calcSess = null;
      this.forceDec = false; this.mixedFlip = false; this.engShift = null;
      if (opLike) { this.tk = ['Ans']; this.cur = 1; } else { this.tk = []; this.cur = 0; }
    }
  }

  private put(toks: string[], off?: number, opLike = false) {
    this.beginEdit(opLike);
    if (this.tk.length + toks.length > 200) throw new CalcError('Stack ERROR');
    insert(this.ed, toks, off, this.ovw);
    this.fire({ type: 'type', score: complexity(this.tk), pos: this.tk.length ? this.cur / this.tk.length : 0, tokens: this.tk.slice() });
  }

  private typeKey(id: string, shift: boolean, alpha: boolean) {
    const m = this.mode;
    // BASE-N letters
    if (m === 'BASE' && !shift && !alpha && VAR_KEYS[id] && 'ABCDEF'.includes(VAR_KEYS[id])) { this.put([VAR_KEYS[id]]); return; }
    if (alpha && VAR_KEYS[id]) { this.put([VAR_KEYS[id]]); return; }
    const num = /^d([0-9])$/.exec(id);
    if (num && !shift && !alpha) { this.put([num[1]]); return; }
    if (num && shift) {
      switch (num[1]) {
        case '1': return this.openStatMenu();
        case '2': return this.openCmplxMenu();
        case '3': return this.openBaseMenu();
        case '4': return this.openMatMenu(false);
        case '5': return this.openMatMenu(true);
        case '7': return this.openConst();
        case '8': return this.openConv();
        case '0': return this.put(['Rnd(']);
      }
      return;
    }
    if (num) return;
    let t: string[] | null = null;
    let off: number | undefined;
    let op = false;
    switch (id) {
      case 'dot': if (alpha) t = ['RanInt(']; else if (shift) t = ['Ran#']; else t = ['.']; break;
      case 'add': t = shift ? ['Pol('] : ['+']; op = !shift; break;
      case 'sub': t = shift ? ['Rec('] : ['-']; op = !shift; break;
      case 'mul': t = shift ? ['nPr'] : ['×']; op = true; break;
      case 'div': t = shift ? ['nCr'] : ['÷']; op = true; break;
      case 'lparen': t = shift ? ['%'] : ['(']; op = shift; break;
      case 'rparen': t = shift ? [','] : [')']; break;
      case 'neg': t = shift ? ['∠'] : ['-']; op = shift; break;
      case 'dms': t = shift ? ['▸DMS'] : [this.nextDms()]; op = shift; break;
      case 'hyp': t = shift ? template('ABS') : null; off = 1; break;
      case 'sin': case 'cos': case 'tan': {
        const h = this.hyp; this.hyp = false;
        t = [(shift ? 'a' : '') + id + (h ? 'h' : '') + '('];
        break;
      }
      case 'sqrt': t = template(shift ? 'CBRT' : 'SQRT'); off = 1; break;
      case 'square': t = ['POW', shift ? '3' : '2', 'END']; off = 3; op = true; break;
      case 'power': if (shift) { t = template('ROOT'); off = 1; } else { t = ['POW', 'END']; off = 1; op = true; } break;
      case 'log': t = shift ? ['1', '0', 'POW', 'END'] : ['log(']; off = shift ? 3 : undefined; break;
      case 'ln': t = shift ? ['e', 'POW', 'END'] : ['ln(']; off = shift ? 2 : undefined; break;
      case 'inv': if (shift) { t = ['!']; op = true; } else { t = ['POW', '-', '1', 'END']; off = 4; op = true; } break;
      case 'logab': t = template(shift ? 'SIG' : 'LOGB'); off = 1; break;
      case 'frac': {
        this.beginEdit(false);
        if (shift) { t = template('MIX'); off = 1; break; }
        const cap = captureBefore(this.ed);
        t = ['FRAC', ...cap, 'SEP', 'END'];
        off = cap.length ? cap.length + 2 : 1;
        break;
      }
      case 'integral':
        if (alpha) t = [':']; else if (shift) { t = template('DER'); off = 1; } else { t = template('INT'); off = 1; }
        break;
      case 'calc': t = ['=']; break;
      case 'eng': t = ['i']; break;
      case 'exp': {
        if (alpha) { t = ['e']; break; }
        if (shift) { t = ['π']; break; }
        this.beginEdit(false);
        const prev = this.tk[this.cur - 1];
        const pre = this.cur === 0 || ['+', '-', '×', '÷', '(', ',', '∠'].includes(prev) || /\($/.test(prev) ? ['1'] : [];
        t = [...pre, '×', '1', '0', 'POW', 'END'];
        off = t.length - 1;
        break;
      }
      case 'ans': if (shift) return this.openDrg(); t = ['Ans']; break;
      case 'sd': t = ['Y']; break;
      case 'mplus': t = ['M']; break;
    }
    if (!t) return;
    if (m === 'BASE' && !t.every((x) => BASE_ALLOWED.test(x))) return;
    this.put(t, off, op);
  }

  private nextDms(): string {
    let j = this.cur - 1;
    let seen = '';
    while (j >= 0 && /^([0-9.]|°|'|")$/.test(this.tk[j])) { seen += this.tk[j]; j--; }
    if (seen.includes('"')) return '°';
    if (seen.includes("'")) return '"';
    if (seen.includes('°')) return "'";
    return '°';
  }

  private storeRecall(id: string) {
    const v = VAR_KEYS[id];
    const wasSto = this.sto;
    this.sto = false; this.rcl = false;
    if (!v || this.screen.k === 'menu' || this.screen.k === 'grid') return;
    if (wasSto) { this.put(['→', v], undefined, true); return; }
    const val = this.vars[v];
    if (typeof val === 'number') this.put(val < 0 ? ['(', ...plainNumTokens(val), ')'] : plainNumTokens(val));
    else this.put([v]);
  }

  private memory(sign: number) {
    if (this.screen.k !== 'calc') return;
    if (!this.done && this.tk.length) { this.exe(); if (this.err) return; }
    const a = this.ans;
    if (typeof a !== 'number') throw mathErr();
    const cur = this.vars.M as number;
    this.vars.M = cur + sign * a;
    if (!this.done) { this.res = { v: this.ans, ctx: this.makeCtx(), mods: {} }; this.disp = this.makeDisp(); this.done = true; }
    this.fire({ type: 'key' });
  }

  // ---------------------------------------------------------------- evaluation
  makeCtx(): Ctx {
    const c = newCtx();
    c.angle = this.setup.angle;
    c.cmplx = this.mode === 'CMPLX';
    c.base = this.mode === 'BASE' ? this.baseSel : 0;
    c.vars = this.vars;
    c.ans = this.ans;
    c.mats = this.mats;
    c.disp = this.setup.fmt;
    if (this.mode === 'STAT') {
      try {
        c.statVars = statCompute(this.statType, this.statData());
        c.statEst = (kind, v) => statEstimate(this.statType, c.statVars, kind, v);
      } catch { /* no data */ }
    }
    return c;
  }

  statData() {
    const n = this.stat.x.length;
    const use = (a: (number | null)[], i: number) => (a[i] === null || a[i] === undefined ? NaN : (a[i] as number));
    const x: number[] = [], y: number[] = [], f: number[] = [];
    for (let i = 0; i < n; i++) {
      x.push(use(this.stat.x, i));
      y.push(use(this.stat.y, i));
      f.push(this.setup.stat ? (this.stat.f[i] === null ? 1 : (this.stat.f[i] as number)) : 1);
    }
    return { x, y, f };
  }

  private evalSeg(seg: string[]): Res {
    let tokens = seg;
    const mods: Res['mods'] = {};
    const last = tokens[tokens.length - 1];
    if (last === '▸DMS') { mods.dms = true; tokens = tokens.slice(0, -1); }
    else if (last === '▸r∠θ') { mods.polar = true; tokens = tokens.slice(0, -1); }
    else if (last === '▸a+bi') { mods.rect = true; tokens = tokens.slice(0, -1); }
    let target: string | null = null;
    const si = tokens.lastIndexOf('→');
    if (si >= 0) {
      target = tokens[si + 1];
      if (si + 2 !== tokens.length || !STO_VARS.has(target)) throw syntaxErr();
      tokens = tokens.slice(0, si);
    }
    if (tokens.includes('=')) throw syntaxErr();
    const ctx = this.makeCtx();
    const v = evalTokens(tokens, ctx);
    if (target) {
      if (v instanceof Mat || v instanceof Tup) throw mathErr();
      this.vars[target] = v;
    }
    this.ans = v instanceof Tup ? v.vals[0] : v;
    if (v instanceof Mat) this.mats[v.vec ? 'VctAns' : 'MatAns'] = v;
    return { v, ctx, mods };
  }

  private execute() {
    if (!this.tk.length) return;
    const segs = splitTop(this.tk, ':');
    let last: Res | null = null;
    for (const s of segs) { if (s.length === 0) throw syntaxErr(); last = this.evalSeg(s); }
    if (!last) return;
    this.res = last;
    this.forceDec = false; this.mixedFlip = false; this.engShift = null;
    this.disp = this.makeDisp();
    this.done = true;
    this.histIdx = null;
    this.hist.push({ tk: this.tk.slice(), disp: this.disp, res: last });
    if (this.hist.length > 60) this.hist.shift();
    const score = complexity(this.tk);
    this.fire({ type: 'result', score, long: score > 18, tokens: this.tk.slice() });
  }

  makeDisp(): Disp {
    const r = this.res!;
    if (r.ctx.base > 0 || (this.mode === 'BASE' && typeof r.v === 'number')) {
      return { kind: 'text', lines: baseLines(r.v as number, this.baseSel) };
    }
    const mixed = this.setup.frac === 'mixed' ? !this.mixedFlip : this.mixedFlip;
    return formatVal(r.v, r.ctx, {
      fmt: this.setup.fmt, io: this.setup.io, mixed, forceDec: this.forceDec, forceEng: this.engShift,
      cmplxPolar: r.mods.polar ? true : r.mods.rect ? false : this.setup.cmplxFmt === 'polar',
      forceDMS: !!r.mods.dms || (r.ctx.dms && typeof r.v === 'number' && this.setup.angle === 'deg' && !r.ctx.dec),
      angle: this.setup.angle,
    });
  }

  private exe() {
    const s = this.screen;
    if (s.k === 'input') {
      const tk = this.tk.slice();
      s.onSubmit(tk);
      return;
    }
    if (this.calcSess && this.done) { this.startCalc(); return; }
    this.execute();
  }

  private evalNumber(tk: string[]): number {
    if (!tk.length) throw syntaxErr();
    const v = evalTokens(tk, this.makeCtx());
    if (typeof v !== 'number') throw mathErr();
    return v;
  }

  // ---------------------------------------------------------------- input prompts
  private pushInput(label: string, init: string[], onSubmit: (tk: string[]) => void) {
    if (this.screen.k !== 'input') this.stash = { tk: this.tk.slice(), cur: this.cur };
    this.tk = init.slice(); this.cur = this.tk.length;
    this.screen = { k: 'input', label, onSubmit, fresh: init.length > 0 };
  }
  private endInput() {
    if (this.stash) { this.tk = this.stash.tk; this.cur = this.stash.cur; this.stash = null; }
    this.screen = { k: 'calc' };
  }

  private startCalc() {
    const src = this.calcSess && this.done ? this.calcSess.tokens : this.tk.slice();
    if (!src.length) return;
    const vars = ['A', 'B', 'C', 'D', 'E', 'F', 'M', 'X', 'Y'].filter((v) => src.includes(v));
    this.calcSess = { vars, i: 0, tokens: src };
    this.tk = src.slice(); this.cur = this.tk.length; this.done = false; this.disp = null;
    if (!vars.length) { this.execute(); return; }
    this.promptCalc();
  }
  private promptCalc() {
    const s = this.calcSess!;
    const v = s.vars[s.i];
    const cur = this.vars[v];
    this.pushInput(v + '?', typeof cur === 'number' && cur !== 0 ? plainNumTokens(cur) : ['0'], (tk) => {
      this.vars[v] = this.evalNumber(tk);
      s.i++;
      if (s.i < s.vars.length) this.promptCalc();
      else {
        this.endInput();
        this.tk = s.tokens.slice(); this.cur = this.tk.length;
        this.execute();
        if (!this.done) this.calcSess = null;
      }
    });
  }

  private startSolve() {
    if (!this.tk.length) return;
    const sides = splitTop(this.tk, '=');
    if (sides.length > 2 || sides[0].length === 0 || (sides[1] && sides[1].length === 0)) throw syntaxErr();
    const L = sides[0], Rr = sides[1] ?? ['0'];
    const cur = this.vars.X;
    this.pushInput('Solve for X', typeof cur === 'number' && cur !== 0 ? plainNumTokens(cur) : ['0'], (tk) => {
      const x0 = this.evalNumber(tk);
      const ctx = this.makeCtx();
      const rv = (v: Val) => { if (typeof v !== 'number') throw mathErr(); return v; };
      const f = (x: number) => { ctx.vars.X = x; return rv(evalTokens(L, ctx)) - rv(evalTokens(Rr, ctx)); };
      const root = findRoot(f, x0);
      this.vars.X = root; this.ans = root;
      const fr = f(root);
      this.vars.X = root;
      this.endInput();
      const fmt = this.setup.fmt;
      this.disp = {
        kind: 'lines', alt: false,
        rows: [
          { label: 'X=', tokens: decTokens(root, fmt) },
          { label: 'L−R=', tokens: Math.abs(fr) < 1e-9 ? ['0'] : decTokens(Number(fr.toPrecision(3)), fmt) },
        ],
      };
      this.res = { v: root, ctx, mods: {} };
      this.done = true;
      this.fire({ type: 'result', score: complexity(this.tk), long: false });
    });
  }

  // ---------------------------------------------------------------- menus
  openMenu(title: string, pages: MenuItem[][], o: { cols?: 1 | 2; multi?: boolean; visible?: number; sel?: number } = {}) {
    this.prevScreen = this.screen.k === 'menu' ? this.prevScreen : this.screen;
    const m: Menu = {
      k: 'menu', title, pages, page: 0, top: 0, sel: o.sel ?? 0, cols: o.cols ?? 1, multi: !!o.multi, buf: '',
      visible: o.visible ?? 4,
    };
    this.screen = m;
    this.fire({ type: 'key' });
  }
  private closeMenu() { this.screen = this.prevScreen.k === 'menu' ? { k: 'calc' } : this.prevScreen; }
  private pick(m: Menu, idx: number) {
    const it = m.pages[m.page][idx];
    if (!it) return;
    this.closeMenu();
    it.run();
  }
  private menuKey(m: Menu, id: string) {
    const items = m.pages[m.page];
    const step = m.cols === 2 ? 4 : 1;
    if (id === 'ac') { this.closeMenu(); return; }
    const num = /^d([0-9])$/.exec(id);
    if (num) {
      const d = Number(num[1]);
      if (m.multi) {
        m.buf += d;
        const w = String(items.length).length;
        if (m.buf.length >= w) { const i = Number(m.buf) - 1; m.buf = ''; if (i >= 0 && i < items.length) this.pick(m, i); }
        return;
      }
      const i = d === 0 ? 9 : d - 1;
      if (i < items.length) this.pick(m, i);
      return;
    }
    if (id === 'exe') { if (m.multi && m.buf) { const i = Number(m.buf) - 1; m.buf = ''; if (i >= 0 && i < items.length) this.pick(m, i); } else this.pick(m, m.sel); return; }
    if (id === 'down' || id === 'right') {
      if (m.multi || m.cols === 1) {
        if (m.sel < items.length - 1) { m.sel++; if (m.sel >= m.top + m.visible) m.top = m.sel - m.visible + 1; }
        else if (m.page < m.pages.length - 1) { m.page++; m.top = 0; m.sel = 0; }
      } else if (m.top + step < items.length) { m.top += step; m.sel = m.top; }
      return;
    }
    if (id === 'up' || id === 'left') {
      if (m.multi || m.cols === 1) {
        if (m.sel > 0) { m.sel--; if (m.sel < m.top) m.top = m.sel; }
        else if (m.page > 0) { m.page--; m.top = 0; m.sel = 0; }
      } else if (m.top - step >= 0) { m.top -= step; m.sel = m.top; }
    }
  }

  private openModeMenu() {
    const modes: [string, ModeName][] = [['COMP', 'COMP'], ['CMPLX', 'CMPLX'], ['STAT', 'STAT'], ['BASE-N', 'BASE'], ['EQN', 'EQN'], ['MATRIX', 'MATRIX'], ['TABLE', 'TABLE'], ['VECTOR', 'VECTOR']];
    this.openMenu('MODE', [modes.map(([l, mm], i) => ({ label: `${i + 1}:${l}`, run: () => this.setMode(mm) }))], { cols: 2 });
  }

  setMode(mm: ModeName) {
    this.mode = mm;
    this.tk = []; this.cur = 0; this.disp = null; this.done = false; this.err = null; this.histIdx = null; this.res = null;
    this.calcSess = null; this.stash = null; this.screen = { k: 'calc' }; this.hist = [];
    this.forceDec = false; this.mixedFlip = false; this.engShift = null;
    if (mm === 'BASE') this.baseSel = 10;
    this.fire({ type: 'mode' });
    switch (mm) {
      case 'STAT': this.openStatType(); break;
      case 'EQN': this.openEqnType(); break;
      case 'MATRIX': this.openMatChooser(false); break;
      case 'VECTOR': this.openMatChooser(true); break;
      case 'TABLE': this.startTable(); break;
    }
  }

  private openSetup() {
    const S = this.setup;
    const digitPrompt = (text: string, on: (d: number) => void) => { this.screen = { k: 'digit', text, on: (d) => { on(d); this.screen = { k: 'calc' }; } }; };
    const p1: MenuItem[] = [
      { label: '1:MthIO', run: () => { S.io = 'math'; } },
      { label: '2:LineIO', run: () => { S.io = 'line'; } },
      { label: '3:Deg', run: () => { S.angle = 'deg'; this.reformat(); } },
      { label: '4:Rad', run: () => { S.angle = 'rad'; this.reformat(); } },
      { label: '5:Gra', run: () => { S.angle = 'gra'; this.reformat(); } },
      { label: '6:Fix', run: () => digitPrompt('Fix 0~9?', (d) => { S.fmt = { kind: 'fix', n: d }; this.reformat(); }) },
      { label: '7:Sci', run: () => digitPrompt('Sci 0~9?', (d) => { S.fmt = { kind: 'sci', n: d }; this.reformat(); }) },
      { label: '8:Norm', run: () => digitPrompt('Norm 1~2?', (d) => { if (d === 1 || d === 2) S.fmt = { kind: d === 1 ? 'norm1' : 'norm2', n: 0 }; this.reformat(); }) },
    ];
    const sub = (title: string, a: [string, () => void], b: [string, () => void]) => () =>
      this.openMenu(title, [[{ label: '1:' + a[0], run: a[1] }, { label: '2:' + b[0], run: b[1] }]]);
    const p2: MenuItem[] = [
      { label: '1:ab/c', run: () => { S.frac = 'mixed'; this.reformat(); } },
      { label: '2:d/c', run: () => { S.frac = 'improper'; this.reformat(); } },
      { label: '3:CMPLX', run: sub('CMPLX', ['a+bi', () => { S.cmplxFmt = 'rect'; this.reformat(); }], ['r∠θ', () => { S.cmplxFmt = 'polar'; this.reformat(); }]) },
      { label: '4:STAT', run: sub('STAT', ['ON', () => { S.stat = true; }], ['OFF', () => { S.stat = false; }]) },
      { label: '5:Disp', run: sub('Disp', ['Dot', () => { S.dot = true; }], ['Comma', () => { S.dot = false; }]) },
      { label: '6:Table', run: sub('Table', ['f(x)', () => { S.table = 'f'; }], ['f(x),g(x)', () => { S.table = 'fg'; }]) },
    ];
    this.openMenu('SETUP', [p1, p2], { visible: 4 });
  }

  private reformat() { if (this.done && this.res) this.disp = this.makeDisp(); }

  private openClr() {
    const ask = (text: string, on: () => void) => () => { this.screen = { k: 'confirm', text, on: () => { on(); this.screen = { k: 'calc' }; } }; };
    this.openMenu('CLR', [[
      { label: '1:Setup', run: ask('Setup:Reset?', () => { this.setup = defaultSetup(); this.reformat(); }) },
      { label: '2:Memory', run: ask('Memory:Clear?', () => this.clearMemory()) },
      { label: '3:All', run: ask('Reset All?', () => { this.clearMemory(); this.setup = defaultSetup(); this.stat = { x: [null], y: [null], f: [1] }; this.setMode('COMP'); }) },
    ]]);
  }
  private clearMemory() {
    for (const k of Object.keys(this.vars)) this.vars[k] = 0;
    this.ans = 0; this.mats = {};
  }

  private openDrg() {
    this.openMenu('DRG', [[{ label: '1:°', run: () => this.put(['D°']) }, { label: '2:ʳ', run: () => this.put(['ʳ']) }, { label: '3:ᵍ', run: () => this.put(['ᵍ']) }]]);
  }

  private openConst() {
    if (this.screen.k !== 'calc' && this.screen.k !== 'input') return;
    const items = CONSTS.map((c, i) => {
      const nn = String(i + 1).padStart(2, '0');
      return { label: `${nn}:${c.sym}`, detail: c.name, run: () => this.put(['K' + nn]) };
    });
    this.openMenu('CONST', [items], { multi: true, visible: 3 });
  }
  private openConv() {
    if (this.screen.k !== 'calc' && this.screen.k !== 'input') return;
    const items = CONVS.map((c, i) => {
      const nn = String(i + 1).padStart(2, '0');
      return { label: `${nn}:${c.label}`, run: () => this.put(['Cv' + nn]) };
    });
    this.openMenu('CONV', [items], { multi: true, visible: 3 });
  }

  private openCmplxMenu() {
    if (this.mode !== 'CMPLX') return;
    const ins = (t: string, op = false) => () => this.put([t], undefined, op);
    this.openMenu('CMPLX', [[
      { label: '1:arg', run: ins('arg(') }, { label: '2:Conjg', run: ins('Conjg(') }, { label: '3:Re', run: ins('Re(') },
      { label: '4:Im', run: ins('Im(') }, { label: '5:▸r∠θ', run: ins('▸r∠θ', true) }, { label: '6:▸a+bi', run: ins('▸a+bi', true) },
    ]]);
  }

  private openBaseMenu() {
    if (this.mode !== 'BASE') return;
    const setBase = (b: number) => () => { this.baseSel = b; this.reformat(); };
    const ins = (t: string) => () => this.put([t]);
    this.openMenu('BASE', [
      [{ label: '1:DEC(d)', run: setBase(10) }, { label: '2:HEX(h)', run: setBase(16) }, { label: '3:BIN(b)', run: setBase(2) }, { label: '4:OCT(o)', run: setBase(8) }],
      [{ label: '1:and', run: ins('and') }, { label: '2:or', run: ins('or') }, { label: '3:xor', run: ins('xor') }, { label: '4:xnor', run: ins('xnor') }, { label: '5:Not', run: ins('Not(') }, { label: '6:Neg', run: ins('Neg(') }],
    ]);
  }

  // ---- STAT
  private openStatType() {
    const types: [string, StatType][] = [['1-VAR', '1var'], ['A+BX', 'lin'], ['_+CX²', 'quad'], ['ln X', 'ln'], ['e^X', 'exp'], ['A·B^X', 'ab'], ['A·X^B', 'pow'], ['1/X', 'inv']];
    this.openMenu('STAT', [types.map(([l, t], i) => ({
      label: `${i + 1}:${l}`,
      run: () => { this.statType = t; this.openStatGrid(); },
    }))], { cols: 2 });
  }
  openStatGrid() {
    const st = this.stat;
    const two = statIs2(this.statType);
    const names: ('x' | 'y' | 'f')[] = two ? ['x', 'y'] : ['x'];
    if (this.setup.stat) names.push('f');
    const grid: Grid = {
      kind: 'stat', title: 'STAT', ncols: names.length,
      nrows: () => st.x.length,
      colHead: names.map((n) => (n === 'f' ? 'FREQ' : n.toUpperCase())),
      rowHead: (r) => String(r + 1),
      get: (r, c) => st[names[c]][r] ?? null,
      set: (r, c, v) => {
        st[names[c]][r] = v;
        if (names[c] !== 'f' && st.f[r] === null) st.f[r] = 1;
        if (r === st.x.length - 1 && st.x.length < (two ? 40 : 80)) { st.x.push(null); st.y.push(null); st.f.push(1); }
      },
      growable: true, cr: 0, cc: 0, top: 0,
      delRow: (r) => { if (st.x.length > 1) { st.x.splice(r, 1); st.y.splice(r, 1); st.f.splice(r, 1); } else { st.x[0] = null; st.y[0] = null; st.f[0] = 1; } },
    };
    this.screen = { k: 'grid', g: grid, editing: false };
    this.tk = []; this.cur = 0;
  }
  private openStatMenu() {
    if (this.mode !== 'STAT') return;
    const two = statIs2(this.statType);
    const ins = (t: string) => () => this.put([t]);
    const list = (toks: string[]) => toks.map((t, i) => ({ label: `${i + 1}:${t === 'rA' ? 'A' : t === 'rB' ? 'B' : t === 'rC' ? 'C' : t === 'rr' ? 'r' : t}`, run: ins(t) }));
    const sub = (title: string, toks: string[]) => () => this.openMenu(title, [list(toks)], { cols: toks.length > 4 ? 2 : 1 });
    const items: MenuItem[] = [
      { label: '1:Type', run: () => this.openStatType() },
      { label: '2:Data', run: () => this.openStatGrid() },
      { label: '3:Sum', run: sub('Sum', two ? ['Σx²', 'Σx', 'Σy²', 'Σy', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴'] : ['Σx²', 'Σx']) },
      { label: '4:Var', run: sub('Var', two ? ['n', 'x̄', 'σx', 'sx', 'ȳ', 'σy', 'sy'] : ['n', 'x̄', 'σx', 'sx']) },
      { label: '5:MinMax', run: sub('MinMax', two ? ['minX', 'maxX', 'minY', 'maxY'] : ['minX', 'maxX']) },
    ];
    if (two) {
      const quad = this.statType === 'quad';
      items.push({
        label: '6:Reg', run: () => this.openMenu('Reg', [[
          { label: '1:A', run: ins('rA') }, { label: '2:B', run: ins('rB') },
          ...(quad ? [{ label: '3:C', run: ins('rC') }, { label: '4:x̂', run: ins('x̂(') }, { label: '5:ŷ', run: ins('ŷ(') }]
            : [{ label: '3:r', run: ins('rr') }, { label: '4:x̂', run: ins('x̂(') }, { label: '5:ŷ', run: ins('ŷ(') }]),
        ]]),
      });
    }
    if (this.screen.k === 'grid') this.screen = { k: 'calc' };
    this.openMenu('STAT', [items]);
  }

  // ---- MATRIX / VECTOR
  private openMatMenu(vec: boolean) {
    if (this.mode !== (vec ? 'VECTOR' : 'MATRIX')) return;
    const p = vec ? 'Vct' : 'Mat';
    const names = ['A', 'B', 'C'].map((x) => p + x);
    const ins = (t: string) => () => this.put([t]);
    const items: MenuItem[] = [
      { label: '1:Dim', run: () => this.openMatChooser(vec, 'dim') },
      { label: '2:Data', run: () => this.openMatChooser(vec, 'data') },
      ...names.map((n, i) => ({ label: `${i + 3}:${n}`, run: ins(n) })),
      { label: '6:' + p + 'Ans', run: ins(p + 'Ans') },
      ...(vec ? [{ label: '7:Dot', run: ins('·') }] : [{ label: '7:det', run: ins('det(') }, { label: '8:Trn', run: ins('Trn(') }, { label: '9:Ide', run: ins('Ide(') }]),
    ];
    this.openMenu(vec ? 'VECTOR' : 'MATRIX', [items]);
  }
  private openMatChooser(vec: boolean, what: 'dim' | 'data' = 'dim') {
    const p = vec ? 'Vct' : 'Mat';
    const items = ['A', 'B', 'C'].map((x, i) => ({
      label: `${i + 1}:${p}${x}`,
      run: () => {
        const name = p + x;
        const cur = this.mats[name];
        if (what === 'data' && cur) this.openMatGrid(name, vec);
        else this.askDims(name, vec);
      },
    }));
    this.openMenu(vec ? 'Vector' : 'Matrix', [items]);
  }
  private askDims(name: string, vec: boolean) {
    const cur = this.mats[name];
    const mk = (r: number, c: number) => {
      const old = this.mats[name];
      const m = Mat.zeros(r, c, vec);
      if (old) for (let i = 0; i < Math.min(r, old.r); i++) for (let j = 0; j < Math.min(c, old.c); j++) m.a[i][j] = old.a[i][j];
      this.mats[name] = m;
    };
    const chk = (n: number, lo: number) => { if (!Number.isInteger(n) || n < lo || n > 3) throw argErr(); return n; };
    this.screen = { k: 'calc' };
    if (vec) {
      this.pushInput(`${name} dim?`, cur ? [String(cur.c)] : ['3'], (tk) => {
        const n = chk(this.evalNumber(tk), 2);
        this.endInput(); mk(1, n); this.openMatGrid(name, vec);
      });
    } else {
      this.pushInput(`${name} rows?`, cur ? [String(cur.r)] : ['3'], (tk) => {
        const r = chk(this.evalNumber(tk), 1);
        this.pushInput(`${name} cols?`, cur ? [String(cur.c)] : ['3'], (tk2) => {
          const c = chk(this.evalNumber(tk2), 1);
          this.endInput(); mk(r, c); this.openMatGrid(name, vec);
        });
      });
    }
  }
  private openMatGrid(name: string, vec: boolean) {
    const m = this.mats[name]!;
    const grid: Grid = {
      kind: vec ? 'vec' : 'mat', title: name, ncols: m.c, nrows: () => m.r,
      colHead: Array.from({ length: m.c }, (_, i) => String(i + 1)),
      rowHead: (r) => String(r + 1),
      get: (r, c) => m.a[r][c],
      set: (r, c, v) => { m.a[r][c] = v ?? 0; },
      growable: false, cr: 0, cc: 0, top: 0,
    };
    this.screen = { k: 'grid', g: grid, editing: false };
    this.tk = []; this.cur = 0;
  }

  // ---- EQN
  private openEqnType() {
    this.openMenu('EQN', [[
      { label: '1:anX+bnY=cn', run: () => this.openEqnGrid(1) },
      { label: '2:anX+bnY+cnZ=dn', run: () => this.openEqnGrid(2) },
      { label: '3:aX²+bX+c=0', run: () => this.openEqnGrid(3) },
      { label: '4:aX³+bX²+cX+d=0', run: () => this.openEqnGrid(4) },
    ]], { visible: 4 });
  }
  private openEqnGrid(type: number) {
    this.eqnType = type;
    const rows = type === 1 ? 2 : type === 2 ? 3 : 1;
    const cols = type === 1 ? 3 : type === 2 ? 4 : type === 3 ? 3 : 4;
    this.eqnCoef = Array.from({ length: rows }, () => Array(cols).fill(0));
    const letters = ['a', 'b', 'c', 'd'];
    const grid: Grid = {
      kind: 'eqn', title: 'EQN', ncols: cols, nrows: () => rows,
      colHead: letters.slice(0, cols), rowHead: (r) => (rows > 1 ? String(r + 1) : ''),
      get: (r, c) => this.eqnCoef[r][c], set: (r, c, v) => { this.eqnCoef[r][c] = v ?? 0; },
      growable: false, cr: 0, cc: 0, top: 0,
    };
    this.screen = { k: 'grid', g: grid, editing: false };
    this.tk = []; this.cur = 0;
  }
  private solveEqn() {
    const t = this.eqnType, M = this.eqnCoef;
    const fmtv = (v: Val) => {
      const cc = newCtx();
      const d = formatVal(v, cc, { fmt: this.setup.fmt, io: 'math', mixed: this.setup.frac === 'mixed', angle: 'deg', cmplxPolar: false });
      return d.kind === 'math' ? d.tokens : ['0'];
    };
    let rows: { label: string; tokens: string[] }[] = [];
    if (t === 1 || t === 2) {
      const n = t === 1 ? 2 : 3;
      const sol = solveLinear(M.map((r) => r.slice(0, n)), M.map((r) => r[n]));
      rows = sol.map((v, i) => ({ label: ['X', 'Y', 'Z'][i] + '=', tokens: fmtv(v) }));
    } else {
      const roots = t === 3 ? quadRoots(M[0][0], M[0][1], M[0][2]) : cubicRoots(M[0][0], M[0][1], M[0][2], M[0][3]);
      rows = roots.map((r, i) => ({
        label: roots.length === 1 ? 'X=' : `X${i + 1}=`,
        tokens: fmtv(r instanceof Cx ? r : r),
      }));
    }
    this.screen = { k: 'eqn', rows, idx: 0 };
    this.fire({ type: 'result', score: 6, long: false });
  }
  private eqnKey(s: { k: 'eqn'; rows: { label: string; tokens: string[] }[]; idx: number }, id: string) {
    if (id === 'down' && s.idx < s.rows.length - 1) s.idx++;
    else if (id === 'up' && s.idx > 0) s.idx--;
    else if (id === 'ac' || id === 'exe') this.openEqnGridKeep();
  }
  private openEqnGridKeep() {
    const saved = this.eqnCoef.map((r) => r.slice());
    this.openEqnGrid(this.eqnType);
    this.eqnCoef = saved;
  }

  // ---- generic grid key handling
  private gridKey(s: { k: 'grid'; g: Grid; editing: boolean }, id: string, shift: boolean, alpha: boolean) {
    const g = s.g;
    const rows = g.nrows();
    const scroll = () => { if (g.cr < g.top) g.top = g.cr; if (g.cr >= g.top + 3) g.top = g.cr - 2; };
    const advance = () => {
      if (g.kind === 'stat') { g.cr = Math.min(g.cr + 1, g.nrows() - 1); }
      else if (g.kind === 'vec') { g.cc = Math.min(g.cc + 1, g.ncols - 1); }
      else if (g.cc < g.ncols - 1) g.cc++;
      else if (g.cr < rows - 1) { g.cr++; g.cc = 0; }
      scroll();
    };
    switch (id) {
      case 'ac':
        if (s.editing) { s.editing = false; this.tk = []; this.cur = 0; return; }
        if (g.kind === 'eqn') { for (let r = 0; r < rows; r++) for (let c = 0; c < g.ncols; c++) g.set(r, c, 0); return; }
        this.screen = { k: 'calc' }; this.tk = []; this.cur = 0; this.fire({ type: 'ac' });
        return;
      case 'exe': {
        if (s.editing || this.tk.length) {
          const v = this.evalNumber(this.tk);
          g.set(g.cr, g.cc, v);
          s.editing = false; this.tk = []; this.cur = 0;
        }
        const last = g.cr === rows - 1 && g.cc === g.ncols - 1;
        if (g.kind === 'eqn' && last) { this.solveEqn(); return; }
        advance();
        this.fire({ type: 'key' });
        return;
      }
      case 'del':
        if (s.editing) { del(this.ed); if (!this.tk.length) s.editing = false; return; }
        if (g.kind === 'stat' && g.delRow) g.delRow(g.cr);
        else if (!shift) g.set(g.cr, g.cc, 0);
        g.cr = Math.min(g.cr, g.nrows() - 1);
        return;
      case 'left':
        if (s.editing) { if (this.cur > 0) this.cur--; return; }
        if (g.cc > 0) g.cc--; else if (g.kind !== 'stat' && g.cr > 0) { g.cr--; g.cc = g.ncols - 1; }
        scroll();
        return;
      case 'right':
        if (s.editing) { if (this.cur < this.tk.length) this.cur++; return; }
        if (g.cc < g.ncols - 1) g.cc++; else if (g.kind !== 'stat' && g.cr < rows - 1) { g.cr++; g.cc = 0; }
        scroll();
        return;
      case 'up':
        if (s.editing) { s.editing = false; this.tk = []; this.cur = 0; }
        if (g.cr > 0) g.cr--;
        scroll();
        return;
      case 'down':
        if (s.editing) { s.editing = false; this.tk = []; this.cur = 0; }
        if (g.cr < g.nrows() - 1) g.cr++;
        scroll();
        return;
    }
    if (shift && id === 'd1' && g.kind === 'stat') { this.openStatMenu(); return; }
    if ((shift && /^d\d$/.test(id)) || (shift && id === 'ans')) return;
    // typing a value
    const before = this.tk.length;
    const prevScreen = this.screen;
    this.screen = { k: 'input', label: '', onSubmit: () => undefined, fresh: false };
    try { this.typeKey(id, shift, alpha); } finally { if (this.screen.k === 'input') this.screen = prevScreen; }
    if (this.tk.length > before || this.tk.length > 0) s.editing = true;
  }

  // ---- TABLE
  private startTable() {
    this.pushInput('f(X)=', this.tableF, (tk) => {
      if (!tk.length) throw syntaxErr();
      this.tableF = tk;
      if (this.setup.table === 'fg') {
        this.pushInput('g(X)=', this.tableG, (t2) => {
          if (!t2.length) throw syntaxErr();
          this.tableG = t2;
          this.tableParams();
        });
      } else this.tableParams();
    });
  }
  private tableParams() {
    const P = this.tableP;
    const ask = (label: string, key: 'start' | 'end' | 'step', next: () => void) =>
      this.pushInput(label, plainNumTokens(P[key]), (tk) => { P[key] = this.evalNumber(tk); next(); });
    ask('Start?', 'start', () => ask('End?', 'end', () => ask('Step?', 'step', () => this.buildTable())));
  }
  private buildTable() {
    const { start, end, step } = this.tableP;
    const hasG = this.setup.table === 'fg';
    if (step === 0 || (end - start) / step < 0 || start > end && step > 0) throw argErr();
    const n = Math.floor((end - start) / step + 1e-9) + 1;
    if (n > (hasG ? 20 : 30)) throw argErr();
    const rows: TableRow[] = [];
    const ctx = this.makeCtx();
    const calc = (tk: string[], x: number): number | null => {
      try { ctx.vars.X = x; const v = evalTokens(tk, ctx); return typeof v === 'number' ? v : null; } catch { return null; }
    };
    const savedX = this.vars.X;
    for (let i = 0; i < n; i++) {
      const x = Number((start + i * step).toPrecision(14));
      rows.push({ x, f: calc(this.tableF, x), g: hasG ? calc(this.tableG, x) : null });
    }
    this.vars.X = savedX;
    this.stash = null;
    this.tk = []; this.cur = 0;
    this.screen = { k: 'table', rows, top: 0, hasG };
    this.fire({ type: 'result', score: 6, long: false });
  }
  private tableKey(s: { k: 'table'; rows: TableRow[]; top: number; hasG: boolean }, id: string) {
    if (id === 'down' && s.top < s.rows.length - 1) s.top++;
    else if (id === 'up' && s.top > 0) s.top--;
    else if (id === 'ac') { this.screen = { k: 'calc' }; this.startTable(); }
  }

  // ---------------------------------------------------------------- misc info for UI
  get indicators() {
    return {
      shift: this.shift, alpha: this.alpha,
      M: typeof this.vars.M === 'number' ? this.vars.M !== 0 : true,
      sto: this.sto, rcl: this.rcl,
      stat: this.mode === 'STAT', cmplx: this.mode === 'CMPLX',
      mat: this.mode === 'MATRIX', vct: this.mode === 'VECTOR',
      angle: this.setup.angle, fix: this.setup.fmt.kind === 'fix', sci: this.setup.fmt.kind === 'sci',
      math: this.setup.io === 'math', hyp: this.hyp,
      base: this.mode === 'BASE' ? this.baseSel : 0,
    };
  }
}
