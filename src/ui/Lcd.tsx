import { Fragment, ReactNode, useLayoutEffect, useRef } from 'react';
import type { Machine, Menu, Grid } from '../calc/machine';
import { OPENERS } from '../engine/parse';
import { CONSTS } from '../engine/tables';
import { decTokens } from '../engine/format';

/* ------------------------------------------------------------------ token display */
const FN_DISP: Record<string, string> = {
  'asin(': 'sin⁻¹(', 'acos(': 'cos⁻¹(', 'atan(': 'tan⁻¹(', 'asinh(': 'sinh⁻¹(', 'acosh(': 'cosh⁻¹(', 'atanh(': 'tanh⁻¹(',
};
export function dispTok(t: string): string {
  switch (t) {
    case '-': return '−';
    case 'D°': return '°';
    case 'rA': return 'A';
    case 'rB': return 'B';
    case 'rC': return 'C';
    case 'rr': return 'r';
    case 'RanInt(': return 'RanInt#(';
    case 'Ran#': return 'Ran#';
    case '=': return '=';
    case ':': return ':';
  }
  if (FN_DISP[t]) return FN_DISP[t];
  if (/^K\d\d$/.test(t)) return CONSTS[parseInt(t.slice(1), 10) - 1]?.sym ?? t;
  if (/^Cv\d\d$/.test(t)) return `Conv(${t.slice(2)})`;
  return t;
}

export function tokText(tokens: string[]): string {
  let s = '';
  for (const t of tokens) {
    if (t === 'POW') s += '^';
    else if (t === 'END' || t === 'SEP') s += t === 'SEP' ? '/' : '';
    else s += dispTok(t);
  }
  return s;
}

/* ------------------------------------------------------------------ tree */
type RN =
  | { t: 'tok'; s: string; i: number }
  | { t: 'st'; op: string; i: number; secs: Sec[]; end: number };
interface Sec { nodes: RN[]; start: number; end: number }

function parseSeq(tk: string[], i: number): { nodes: RN[]; next: number } {
  const nodes: RN[] = [];
  while (i < tk.length) {
    const t = tk[i];
    if (t === 'SEP' || t === 'END') break;
    if (OPENERS.has(t)) {
      const secs: Sec[] = [];
      let j = i + 1;
      let endIdx = tk.length;
      for (;;) {
        const r = parseSeq(tk, j);
        secs.push({ nodes: r.nodes, start: j, end: r.next });
        if (tk[r.next] === 'SEP') { j = r.next + 1; continue; }
        endIdx = r.next;
        break;
      }
      nodes.push({ t: 'st', op: t, i, secs, end: endIdx });
      i = endIdx + 1;
      continue;
    }
    nodes.push({ t: 'tok', s: t, i });
    i++;
  }
  return { nodes, next: i };
}

const LIN: Record<string, [string, string, string]> = {
  FRAC: ['', '⌟', ''], MIX: ['', '⌟', ''], SQRT: ['√(', '', ')'], CBRT: ['³√(', '', ')'], ROOT: ['', 'ˣ√(', ')'],
  POW: ['^(', '', ')'], LOGB: ['log(', ',', ')'], ABS: ['Abs(', '', ')'], INT: ['∫(', ',', ')'], DER: ['d/dx(', ',', ')'], SIG: ['Σ(', ',', ')'],
};

function Cursor({ ovw }: { ovw?: boolean }) {
  return <span className={'lcd-cur' + (ovw ? ' ovw' : '')} />;
}

function Box() {
  return <span className="lcd-box" />;
}

function SeqView({ sec, cur, ovw, top = false }: { sec: Sec; cur: number; ovw: boolean; top?: boolean }) {
  const out: ReactNode[] = [];
  let drawn = false;
  for (const n of sec.nodes) {
    if (n.i === cur) { out.push(<Cursor key={'c' + n.i} ovw={ovw} />); drawn = true; }
    out.push(<NodeView key={n.i} n={n} cur={cur} ovw={ovw} />);
  }
  if (!drawn && cur === sec.end) out.push(<Cursor key="ce" ovw={ovw} />);
  if (sec.nodes.length === 0 && !top) out.push(<Box key="box" />);
  return <span className="mrow">{out}</span>;
}

function NodeView({ n, cur, ovw }: { n: RN; cur: number; ovw: boolean }) {
  if (n.t === 'tok') {
    const d = dispTok(n.s);
    return <span className={'mt' + (/^[0-9.]$/.test(n.s) ? ' dg' : '')}>{d}</span>;
  }
  const S = (k: number) => <SeqView sec={n.secs[k]} cur={cur} ovw={ovw} />;
  switch (n.op) {
    case 'FRAC':
      return <span className="frac"><span className="fn">{S(0)}</span><span className="fd">{S(1)}</span></span>;
    case 'MIX':
      return <span className="mix">{S(0)}<span className="frac"><span className="fn">{S(1)}</span><span className="fd">{S(2)}</span></span></span>;
    case 'SQRT': return <Sqrt>{S(0)}</Sqrt>;
    case 'CBRT': return <span className="rt"><span className="rtidx">3</span><Sqrt>{S(0)}</Sqrt></span>;
    case 'ROOT': return <span className="rt"><span className="rtidx">{S(0)}</span><Sqrt>{S(1)}</Sqrt></span>;
    case 'POW': return <span className="pw">{S(0)}</span>;
    case 'LOGB': return <span className="mrow"><span className="mt">log</span><span className="sb">{S(0)}</span><span className="mt">(</span>{S(1)}<span className="mt">)</span></span>;
    case 'ABS': return <span className="abs">{S(0)}</span>;
    case 'INT':
      return (
        <span className="mrow">
          <span className="ints"><span className="il">{S(2)}</span><span className="isym">∫</span><span className="il">{S(1)}</span></span>
          {S(0)}<span className="mt">dx</span>
        </span>
      );
    case 'DER':
      return (
        <span className="mrow">
          <span className="frac"><span className="fn"><span className="mt">d</span></span><span className="fd"><span className="mt">dx</span></span></span>
          <span className="mt">(</span>{S(0)}<span className="mt">)</span>
          <span className="sb"><span className="mt">x=</span>{S(1)}</span>
        </span>
      );
    case 'SIG':
      return (
        <span className="mrow">
          <span className="ints sig"><span className="il">{S(2)}</span><span className="isym">Σ</span><span className="il"><span className="mt">X=</span>{S(1)}</span></span>
          {S(0)}
        </span>
      );
  }
  return null;
}

function Sqrt({ children }: { children: ReactNode }) {
  return (
    <span className="sqrt">
      <svg className="rad" viewBox="0 0 8 20" preserveAspectRatio="none">
        <path d="M0.4 11.5 L1.8 10.2 L4 18.2 L7.4 1 L8 1" fill="none" stroke="currentColor" strokeWidth="1.3" vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
      </svg>
      <span className="rb">{children}</span>
    </span>
  );
}

function linearView(tk: string[], cur: number | null, ovw: boolean): ReactNode {
  const out: ReactNode[] = [];
  const stack: string[] = [];
  for (let i = 0; i <= tk.length; i++) {
    if (cur === i) out.push(<Cursor key={'c' + i} ovw={ovw} />);
    if (i === tk.length) break;
    const t = tk[i];
    let s: string;
    if (OPENERS.has(t)) { stack.push(t); s = LIN[t][0]; }
    else if (t === 'SEP') s = stack.length ? LIN[stack[stack.length - 1]][1] : '';
    else if (t === 'END') { const o = stack.pop(); s = o ? LIN[o][2] : ''; }
    else s = dispTok(t);
    out.push(<span className="mt lin" key={i}>{s}</span>);
  }
  return <span className="lin-wrap">{out}</span>;
}

export function MathView({ tokens, cur = null, linear = false, ovw = false }: { tokens: string[]; cur?: number | null; linear?: boolean; ovw?: boolean }) {
  if (linear) return <>{linearView(tokens, cur, ovw)}</>;
  const root = parseSeq(tokens, 0);
  const sec: Sec = { nodes: root.nodes, start: 0, end: tokens.length };
  return <SeqView sec={sec} cur={cur === null ? -1 : cur} ovw={ovw} top />;
}

/* ------------------------------------------------------------------ LCD */
function Ind({ on, children, cls = '' }: { on: boolean; children: ReactNode; cls?: string }) {
  return <span className={'ind ' + cls + (on ? ' on' : '')}>{children}</span>;
}

function MenuView({ m }: { m: Menu }) {
  const items = m.pages[m.page];
  const shown = items.slice(m.top, m.top + (m.cols === 2 ? 4 : m.visible));
  const more = m.cols === 2 ? m.top + 4 < items.length : m.top + m.visible < items.length || m.page < m.pages.length - 1;
  const up = m.top > 0 || m.page > 0;
  return (
    <div className={'lcd-menu cols' + m.cols}>
      {shown.map((it, i) => {
        const gi = m.top + i;
        const sel = m.multi && gi === m.sel;
        return (
          <div key={gi} className={'mi' + (sel ? ' sel' : '')}>
            <span>{it.label}</span>
            {m.multi && sel && it.detail && <span className="mdetail">{it.detail}</span>}
          </div>
        );
      })}
      {m.multi && m.buf && <div className="mbuf">{m.buf}_</div>}
      {more && <span className="marrow dn">▼</span>}
      {up && <span className="marrow up">▲</span>}
    </div>
  );
}

function GridView({ g, editing, m }: { g: Grid; editing: boolean; m: Machine }) {
  const rows = g.nrows();
  const vis: number[] = [];
  for (let r = g.top; r < Math.min(rows, g.top + 3); r++) vis.push(r);
  const cellTxt = (v: number | null) => (v === null ? '' : tokText(decTokens(v, { kind: 'norm1', n: 0 })));
  const cur = g.get(g.cr, g.cc);
  return (
    <div className="lcd-grid">
      <div className="gh">
        <span className="gt">{g.title}</span>
        {g.colHead.map((h, i) => <span key={i} className="gc">{h}</span>)}
      </div>
      {vis.map((r) => (
        <div key={r} className="gr">
          <span className="gt rh">{g.rowHead(r)}</span>
          {Array.from({ length: g.ncols }, (_, c) => (
            <span key={c} className={'gc' + (r === g.cr && c === g.cc ? ' sel' : '')}>{cellTxt(g.get(r, c))}</span>
          ))}
        </div>
      ))}
      <div className="gf">
        {editing ? <MathView tokens={m.tk} cur={m.cur} linear /> : <span>{cur === null ? '' : tokText(decTokens(cur, { kind: 'norm1', n: 0 }))}</span>}
      </div>
    </div>
  );
}

function ResultView({ m }: { m: Machine }) {
  const d = m.disp;
  if (!d) return null;
  const linear = m.setup.io === 'line';
  switch (d.kind) {
    case 'math': return <div className="lcd-res"><MathView tokens={d.tokens} linear={linear} /></div>;
    case 'text': return <div className="lcd-res text">{d.lines.map((l, i) => <div key={i}>{l}</div>)}</div>;
    case 'lines':
      return (
        <div className="lcd-lines">
          {d.rows.map((r, i) => (
            <div key={i} className="ll"><span className="lab">{r.label}</span><span className="val"><MathView tokens={r.tokens} linear={linear} /></span></div>
          ))}
        </div>
      );
    case 'mat':
      return (
        <div className="lcd-mat">
          <div className="mbr">
            {d.cells.map((row, i) => (
              <div key={i} className="mr">{row.map((c, j) => <span key={j} className="mc"><MathView tokens={c} /></span>)}</div>
            ))}
          </div>
        </div>
      );
  }
  return null;
}

export default function Lcd({ m }: { m: Machine }) {
  const exprRef = useRef<HTMLDivElement>(null);
  const ind = m.indicators;
  const s = m.screen;
  const linear = m.setup.io === 'line';

  useLayoutEffect(() => {
    const box = exprRef.current;
    if (!box) return;
    const c = box.querySelector('.lcd-cur') as HTMLElement | null;
    if (!c) { box.scrollLeft = 0; return; }
    const k = box.getBoundingClientRect().width / box.offsetWidth || 1;
    const br = box.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const left = (cr.left - br.left) / k, right = (cr.right - br.left) / k;
    if (right > box.clientWidth - 6) box.scrollLeft += right - box.clientWidth + 14;
    else if (left < 4) box.scrollLeft += left - 14;
    const top = (cr.top - br.top) / k, bottom = (cr.bottom - br.top) / k;
    if (bottom > box.clientHeight) box.scrollTop += bottom - box.clientHeight + 2;
    else if (top < 0) box.scrollTop += top - 2;
  });

  let body: ReactNode = null;
  if (m.off) body = null;
  else if (m.err) {
    body = (
      <div className="lcd-err">
        <div className="em">{m.err}</div>
        <div className="eh">[AC] :Cancel</div>
        <div className="eh">[◄][►]:Goto</div>
      </div>
    );
  } else if (s.k === 'menu') body = <MenuView m={s} />;
  else if (s.k === 'digit') body = <div className="lcd-msg">{s.text}</div>;
  else if (s.k === 'confirm') body = <div className="lcd-msg">{s.text}<div className="eh">[=]:Yes [AC]:Cancel</div></div>;
  else if (s.k === 'grid') body = <GridView g={s.g} editing={s.editing} m={m} />;
  else if (s.k === 'table') {
    const rows = s.rows.slice(s.top, s.top + 3);
    const t = (v: number | null) => (v === null ? 'ERROR' : tokText(decTokens(v, m.setup.fmt)));
    body = (
      <div className="lcd-grid table">
        <div className="gh"><span className="gt">{''}</span><span className="gc">X</span><span className="gc">F(X)</span>{s.hasG && <span className="gc">G(X)</span>}</div>
        {rows.map((r, i) => (
          <div key={i} className="gr"><span className="gt rh">{s.top + i + 1}</span><span className="gc">{t(r.x)}</span><span className="gc">{t(r.f)}</span>{s.hasG && <span className="gc">{t(r.g)}</span>}</div>
        ))}
      </div>
    );
  } else if (s.k === 'eqn') {
    const r = s.rows[s.idx];
    body = (
      <div className="lcd-eqn">
        <div className="lab">{r.label}</div>
        <div className="lcd-res"><MathView tokens={r.tokens} /></div>
        {s.idx < s.rows.length - 1 && <span className="marrow dn">▼</span>}
        {s.idx > 0 && <span className="marrow up">▲</span>}
      </div>
    );
  } else {
    const showRes = !!m.disp && m.disp.kind !== 'err';
    body = (
      <>
        {s.k === 'input' && <div className="lcd-label">{s.label}</div>}
        <div className={'lcd-expr' + (linear ? ' linear' : '') + (s.k === 'input' ? ' with-label' : '')} ref={exprRef}>
          <MathView tokens={m.tk} cur={m.done ? null : m.cur} linear={linear} ovw={m.ovw} />
        </div>
        {showRes && <ResultView m={m} />}
        {!m.done && m.tk.length === 0 && !showRes && null}
      </>
    );
  }

  const canUp = m.hist.length > 0 && (m.histIdx === null || m.histIdx > 0) && s.k === 'calc';
  const canDown = m.histIdx !== null;
  const bases: Record<number, string> = { 2: 'b', 8: 'o', 10: 'd', 16: 'h' };
  return (
    <div className={'lcd' + (m.off ? ' off' : '')}>
      <div className="lcd-status">
        <Ind on={ind.shift}>S</Ind><Ind on={ind.alpha}>A</Ind><Ind on={ind.M}>M</Ind>
        <Ind on={ind.sto}>▶STO</Ind><Ind on={ind.rcl}>RCL</Ind>
        <Ind on={ind.stat}>STAT</Ind><Ind on={ind.cmplx}>CMPLX</Ind><Ind on={ind.mat}>MAT</Ind><Ind on={ind.vct}>VCT</Ind>
        <Ind on={ind.hyp}>hyp</Ind>
        {ind.base > 0 && <Ind on>{bases[ind.base]}</Ind>}
        <Ind on={ind.angle === 'deg'}>D</Ind><Ind on={ind.angle === 'rad'}>R</Ind><Ind on={ind.angle === 'gra'}>G</Ind>
        <Ind on={ind.fix}>FIX</Ind><Ind on={ind.sci}>SCI</Ind>
        <Ind on={ind.math} cls="math">Math</Ind>
        <span className="sp" />
        <Ind on={canUp}>▲</Ind><Ind on={canDown}>▼</Ind>
        <Ind on={m.ovw}>INS</Ind>
      </div>
      <div className="lcd-main">
        <Fragment>{body}</Fragment>
      </div>
      <div className="lcd-grid-overlay" />
    </div>
  );
}
