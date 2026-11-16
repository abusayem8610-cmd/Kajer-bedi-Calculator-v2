// Token-stream editor used for the Natural-V.P.A.M. input line.
import { OPENERS, readGroup } from '../engine/parse';

export interface Ed {
  tk: string[];
  cur: number;
}

export const TEMPLATE_SECTIONS: Record<string, number> = {
  FRAC: 2, MIX: 3, SQRT: 1, CBRT: 1, ROOT: 2, POW: 1, LOGB: 2, ABS: 1, INT: 3, DER: 2, SIG: 3,
};

export function template(op: string): string[] {
  const n = TEMPLATE_SECTIONS[op];
  const out = [op];
  for (let i = 1; i < n; i++) out.push('SEP');
  out.push('END');
  return out;
}

export function insert(ed: Ed, toks: string[], curOffset?: number, overwrite = false) {
  if (overwrite && toks.length === 1 && ed.cur < ed.tk.length) {
    const nx = ed.tk[ed.cur];
    if (!OPENERS.has(nx) && nx !== 'END' && nx !== 'SEP') {
      ed.tk.splice(ed.cur, 1, toks[0]);
      ed.cur += 1;
      return;
    }
  }
  ed.tk.splice(ed.cur, 0, ...toks);
  ed.cur += curOffset === undefined ? toks.length : curOffset;
}

export function chain(tk: string[], cur: number): number[] {
  const stack: number[] = [];
  for (let i = 0; i < cur && i < tk.length; i++) {
    const t = tk[i];
    if (OPENERS.has(t)) stack.push(i);
    else if (t === 'END') stack.pop();
  }
  return stack;
}

function bounds(tk: string[], o: number) {
  const starts = [o + 1];
  const ends: number[] = [];
  let depth = 0;
  for (let j = o + 1; j < tk.length; j++) {
    const t = tk[j];
    if (OPENERS.has(t)) depth++;
    else if (t === 'END') {
      if (depth === 0) { ends.push(j); break; }
      depth--;
    } else if (t === 'SEP' && depth === 0) { ends.push(j); starts.push(j + 1); }
  }
  if (ends.length < starts.length) ends.push(tk.length);
  return { starts, ends };
}

/** Move cursor vertically inside fractions / integral limits etc. */
export function vertical(ed: Ed, dir: 'up' | 'down'): boolean {
  const ch = chain(ed.tk, ed.cur);
  for (let k = ch.length - 1; k >= 0; k--) {
    const o = ch[k];
    const kind = ed.tk[o];
    const { starts, ends } = bounds(ed.tk, o);
    let sec = 0;
    for (let s = 0; s < starts.length; s++) if (starts[s] <= ed.cur && ed.cur <= ends[s]) sec = s;
    let target = -1;
    if (kind === 'FRAC') target = dir === 'down' ? (sec === 0 ? 1 : -1) : sec === 1 ? 0 : -1;
    else if (kind === 'MIX') target = dir === 'down' ? (sec === 1 ? 2 : -1) : sec === 2 ? 1 : -1;
    else if (kind === 'INT' || kind === 'SIG') {
      if (dir === 'up') target = sec === 0 ? 2 : sec === 1 ? 0 : -1;
      else target = sec === 0 ? 1 : sec === 2 ? 0 : -1;
    }
    if (target >= 0 && target < starts.length) {
      const off = ed.cur - starts[sec];
      ed.cur = starts[target] + Math.min(off, ends[target] - starts[target]);
      return true;
    }
  }
  return false;
}

export function del(ed: Ed): boolean {
  if (ed.cur === 0) return false;
  const t = ed.tk[ed.cur - 1];
  if (t === 'END' || t === 'SEP') { ed.cur--; return true; }
  if (OPENERS.has(t)) {
    const g = readGroup(ed.tk, ed.cur - 1);
    if (g.secs.every((s) => s.length === 0)) {
      ed.tk.splice(ed.cur - 1, g.next - (ed.cur - 1));
      ed.cur--;
    } else ed.cur--;
    return true;
  }
  ed.tk.splice(ed.cur - 1, 1);
  ed.cur--;
  return true;
}

const SIMPLE_CAPTURE = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M', 'π', 'e', 'Ans', 'i']);
/** Remove and return the number / variable directly before the cursor (used by the fraction key). */
export function captureBefore(ed: Ed): string[] {
  let j = ed.cur;
  while (j > 0 && /^[0-9.]$/.test(ed.tk[j - 1])) j--;
  if (j < ed.cur) {
    const cap = ed.tk.splice(j, ed.cur - j);
    ed.cur = j;
    return cap;
  }
  if (ed.cur > 0 && SIMPLE_CAPTURE.has(ed.tk[ed.cur - 1])) {
    const cap = ed.tk.splice(ed.cur - 1, 1);
    ed.cur--;
    return cap;
  }
  return [];
}

export function splitTop(tk: string[], sep: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let depth = 0;
  for (const t of tk) {
    if (OPENERS.has(t)) depth++;
    else if (t === 'END') depth--;
    if (depth === 0 && t === sep) { out.push(cur); cur = []; } else cur.push(t);
  }
  out.push(cur);
  return out;
}

export function complexity(tk: string[]): number {
  let s = tk.length * 0.6;
  for (const t of tk) {
    if (t === 'INT' || t === 'DER' || t === 'SIG') s += 4;
    else if (/^(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|log|ln)/.test(t) && t.endsWith('(')) s += 1.5;
    else if (t === 'FRAC' || t === 'SQRT' || t === 'POW' || t === 'ROOT' || t === 'LOGB' || t === 'MIX') s += 1.2;
    else if (t === 'nPr' || t === 'nCr' || t === '!') s += 1;
  }
  return s;
}
