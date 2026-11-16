import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Machine } from '../calc/machine';
import { CatBrain } from '../cat/brain';
import Cat from '../cat/Cat';
import Lcd from './Lcd';
import { buttonSounds, SoundCategory } from '../audio/buttonSounds';

export const W = 340;
export const H = 704;

type Kind = 'fn' | 'num' | 'orange' | 'mode';
interface KeyDef { id: string; main: string; shift?: string; alpha?: string; kind: Kind; cls?: string }

/* ---------------------------------------------------------------- legends */
function Lab({ s }: { s: string }): ReactNode {
  const parts = s.split(/(\^\{[^}]*\}|_\{[^}]*\}|~\{[^}]*\}|@\w+|▯)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('^{')) return <sup key={i}>{p.slice(2, -1) === '▯' ? <span className="gl-box" /> : p.slice(2, -1)}</sup>;
        if (p.startsWith('_{')) return <sub key={i}>{p.slice(2, -1)}</sub>;
        if (p.startsWith('~{')) return <span key={i} className="ovl">{p.slice(2, -1)}</span>;
        if (p === '▯') return <span key={i} className="gl-box" />;
        if (p === '@frac') return <span key={i} className="gl-frac"><i /><i /></span>;
        if (p === '@mix') return <span key={i} className="gl-mix"><b /><span className="gl-frac"><i /><i /></span></span>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}


const K = {
  shift: { id: 'shift', main: 'SHIFT', kind: 'mode', cls: 'k-shift' } as KeyDef,
  alpha: { id: 'alpha', main: 'ALPHA', kind: 'mode', cls: 'k-alpha' } as KeyDef,
  mode: { id: 'mode', main: 'MODE', shift: 'SETUP', kind: 'mode', cls: 'k-mode' } as KeyDef,
  on: { id: 'on', main: 'ON', kind: 'mode', cls: 'k-on' } as KeyDef,
  calc: { id: 'calc', main: 'CALC', shift: 'SOLVE', alpha: '=', kind: 'fn' } as KeyDef,
  integral: { id: 'integral', main: '∫▯dx', shift: 'd/dx', alpha: ':', kind: 'fn' } as KeyDef,
  inv: { id: 'inv', main: 'x^{-1}', shift: 'x!', kind: 'fn' } as KeyDef,
  logab: { id: 'logab', main: 'log_{▯}▯', shift: 'Σ▯', kind: 'fn' } as KeyDef,
};

const ROW3: KeyDef[] = [
  { id: 'frac', main: '@frac', shift: '@mix', kind: 'fn' },
  { id: 'sqrt', main: '√~{▯}', shift: '^{3}√~{▯}', kind: 'fn' },
  { id: 'square', main: 'x^{2}', shift: 'x^{3}', kind: 'fn' },
  { id: 'power', main: 'x^{▯}', shift: '^{▯}√~{▯}', kind: 'fn' },
  { id: 'log', main: 'log', shift: '10^{▯}', kind: 'fn' },
  { id: 'ln', main: 'ln', shift: 'e^{▯}', kind: 'fn' },
];
const ROW4: KeyDef[] = [
  { id: 'neg', main: '(−)', shift: '∠', alpha: 'A', kind: 'fn' },
  { id: 'dms', main: '° ′ ″', shift: '←DMS', alpha: 'B', kind: 'fn' },
  { id: 'hyp', main: 'hyp', shift: 'Abs', alpha: 'C', kind: 'fn' },
  { id: 'sin', main: 'sin', shift: 'sin^{-1}', alpha: 'D', kind: 'fn' },
  { id: 'cos', main: 'cos', shift: 'cos^{-1}', alpha: 'E', kind: 'fn' },
  { id: 'tan', main: 'tan', shift: 'tan^{-1}', alpha: 'F', kind: 'fn' },
];
const ROW5: KeyDef[] = [
  { id: 'rcl', main: 'RCL', shift: 'STO', kind: 'fn' },
  { id: 'eng', main: 'ENG', shift: '←', alpha: 'i', kind: 'fn' },
  { id: 'lparen', main: '(', shift: '%', kind: 'fn' },
  { id: 'rparen', main: ')', shift: ',', alpha: 'X', kind: 'fn' },
  { id: 'sd', main: 'S⇔D', shift: 'ab/c⇔d/c', alpha: 'Y', kind: 'fn' },
  { id: 'mplus', main: 'M+', shift: 'M−', alpha: 'M', kind: 'fn' },
];
const NUM_ROWS: KeyDef[][] = [
  [
    { id: 'd7', main: '7', shift: 'CONST', kind: 'num' }, { id: 'd8', main: '8', shift: 'CONV', kind: 'num' },
    { id: 'd9', main: '9', shift: 'CLR', kind: 'num' }, { id: 'del', main: 'DEL', shift: 'INS', kind: 'orange' },
    { id: 'ac', main: 'AC', shift: 'OFF', kind: 'orange' },
  ],
  [
    { id: 'd4', main: '4', shift: 'MATRIX', kind: 'num' }, { id: 'd5', main: '5', shift: 'VECTOR', kind: 'num' },
    { id: 'd6', main: '6', kind: 'num' }, { id: 'mul', main: '×', shift: 'nPr', kind: 'num' }, { id: 'div', main: '÷', shift: 'nCr', kind: 'num' },
  ],
  [
    { id: 'd1', main: '1', shift: 'STAT', kind: 'num' }, { id: 'd2', main: '2', shift: 'CMPLX', kind: 'num' },
    { id: 'd3', main: '3', shift: 'BASE', kind: 'num' }, { id: 'add', main: '+', shift: 'Pol', kind: 'num' }, { id: 'sub', main: '−', shift: 'Rec', kind: 'num' },
  ],
  [
    { id: 'd0', main: '0', shift: 'Rnd', kind: 'num' }, { id: 'dot', main: '•', shift: 'Ran#', alpha: 'RanInt', kind: 'num' },
    { id: 'exp', main: '×10^{x}', shift: 'π', alpha: 'e', kind: 'num' }, { id: 'ans', main: 'Ans', shift: 'DRG▸', kind: 'num' },
    { id: 'exe', main: '=', kind: 'num', cls: 'k-exe' },
  ],
];

/* ---------------------------------------------------------------- layout */
const KX = 22;
const KW = 296;
const Y0 = 206;
const FR = 48; // function row block height
const NR = 60; // number row block height

interface Placed { def: KeyDef; left: number; top: number; w: number; h: number }
function layout(): Placed[] {
  const out: Placed[] = [];
  const g6 = 7, w6 = (KW - g6 * 5) / 6;
  const x6 = (c: number) => KX + c * (w6 + g6);
  const row6 = (r: number, defs: (KeyDef | null)[]) =>
    defs.forEach((d, c) => d && out.push({ def: d, left: x6(c), top: Y0 + FR * r, w: w6, h: 25 }));
  row6(0, [K.shift, K.alpha, null, null, K.mode, K.on]);
  row6(1, [K.calc, K.integral, null, null, K.inv, K.logab]);
  row6(2, ROW3); row6(3, ROW4); row6(4, ROW5);
  const g5 = 9, w5 = (KW - g5 * 4) / 5;
  NUM_ROWS.forEach((row, r) => row.forEach((d, c) => out.push({ def: d, left: KX + c * (w5 + g5), top: Y0 + FR * 5 + NR * r, w: w5, h: 38 })));
  return out;
}
const PLACED = layout();

/* ---------------------------------------------------------------- keyboard map */
type KeySeq = string[];
function mapKey(e: KeyboardEvent, mode: string): KeySeq | null {
  const k = e.key;
  if (/^[0-9]$/.test(k)) return ['d' + k];
  const base: Record<string, KeySeq> = {
    '.': ['dot'], ',': ['shift', 'rparen'], '+': ['add'], '-': ['sub'], '*': ['mul'], '/': ['div'], '(': ['lparen'], ')': ['rparen'],
    Enter: ['exe'], '=': ['exe'], Backspace: ['del'], Delete: ['del'], Escape: ['ac'],
    ArrowLeft: ['left'], ArrowRight: ['right'], ArrowUp: ['up'], ArrowDown: ['down'],
    '^': ['power'], '!': ['shift', 'inv'], '%': ['shift', 'lparen'],
    s: ['sin'], c: ['cos'], t: ['tan'], l: ['log'], n: ['ln'], r: ['sqrt'], q: ['square'], p: ['shift', 'exp'], e: ['alpha', 'exp'],
    a: ['ans'], x: ['alpha', 'rparen'], y: ['alpha', 'sd'], i: ['eng'], f: ['frac'], h: ['hyp'], v: ['inv'], E: ['exp'],
    k: ['calc'], m: ['mplus'], u: ['sd'], g: ['logab'], d: ['integral'], o: ['mode'], w: ['shift', 'mode'],
  };
  if (mode === 'BASE' && /^[A-F]$/.test(k)) return [({ A: 'neg', B: 'dms', C: 'hyp', D: 'sin', E: 'cos', F: 'tan' } as Record<string, string>)[k]];
  if (/^[A-F]$/.test(k) && k !== 'E') return ['alpha', ({ A: 'neg', B: 'dms', C: 'hyp', D: 'sin', F: 'tan' } as Record<string, string>)[k]];
  if (k === 'M') return ['alpha', 'mplus'];
  return base[k] ?? null;
}

/* ---------------------------------------------------------------- pad */
function polar(cx: number, cy: number, r: number, a: number) {
  const t = (a * Math.PI) / 180;
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
}
function wedge(a0: number, a1: number, r0: number, r1: number) {
  const [x0, y0] = polar(40, 40, r1, a0), [x1, y1] = polar(40, 40, r1, a1);
  const [x2, y2] = polar(40, 40, r0, a1), [x3, y3] = polar(40, 40, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}
const PAD: { id: string; a0: number; a1: number; tri: string }[] = [
  { id: 'up', a0: 227, a1: 313, tri: 'M40 12 L46 21 L34 21 Z' },
  { id: 'right', a0: -43, a1: 43, tri: 'M68 40 L59 34 L59 46 Z' },
  { id: 'down', a0: 47, a1: 133, tri: 'M40 68 L34 59 L46 59 Z' },
  { id: 'left', a0: 137, a1: 223, tri: 'M12 40 L21 34 L21 46 Z' },
];

function Pad({
  pressed, onDown, onUp,
}: { pressed: Set<string>; onDown: (id: string, pointerId: number, target: SVGGElement) => void; onUp: (id: string, pointerId: number) => void }) {
  return (
    <svg className="pad" viewBox="0 0 80 80" width="82" height="82" style={{ left: 129, top: Y0 + 8 }} onContextMenu={(e) => e.preventDefault()}>
      <defs>
        <radialGradient id="padRing" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stopColor="#f2f2f2" /><stop offset="0.55" stopColor="#b9bbc0" /><stop offset="1" stopColor="#8c8f96" /></radialGradient>
        <radialGradient id="padDisc" cx="0.45" cy="0.35" r="0.85"><stop offset="0" stopColor="#4d5057" /><stop offset="1" stopColor="#25272b" /></radialGradient>
        <radialGradient id="padDome" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stopColor="#e9e9ea" /><stop offset="1" stopColor="#a4a7ad" /></radialGradient>
      </defs>
      <circle cx="40" cy="40" r="39" fill="#101114" opacity="0.5" transform="translate(0 1.6)" />
      <circle cx="40" cy="40" r="39" fill="url(#padRing)" />
      <circle cx="40" cy="40" r="35.5" fill="url(#padDisc)" stroke="#16171a" strokeWidth="0.6" />
      {PAD.map((p) => (
        <g
          key={p.id}
          className={'pad-key' + (pressed.has(p.id) ? ' down' : '')}
          onPointerDown={(e) => { e.preventDefault(); onDown(p.id, e.pointerId, e.currentTarget as SVGGElement); }}
          onPointerUp={(e) => onUp(p.id, e.pointerId)}
          onPointerCancel={(e) => onUp(p.id, e.pointerId)}
          onPointerLeave={(e) => onUp(p.id, e.pointerId)}
          onLostPointerCapture={(e) => onUp(p.id, e.pointerId)}
        >
          <path d={wedge(p.a0, p.a1, 16.5, 35)} fill="rgba(255,255,255,0.001)" />
          <path className="pad-tri" d={p.tri} fill="#f4f4f4" />
        </g>
      ))}
      <circle cx="40" cy="40" r="16" fill="url(#padDome)" stroke="#7d8087" strokeWidth="0.6" />
      <circle cx="40" cy="40" r="12.8" fill="none" stroke="#fff" strokeWidth="0.5" opacity="0.6" />
      <text x="40" y="42" textAnchor="middle" fontSize="5.6" fontFamily="Arial, sans-serif" fontWeight="700" fill="#2b2d31" letterSpacing="0.2">REPLAY</text>
    </svg>
  );
}

const SOUND_PREFERENCE_KEY = 'kajer-bedi-sound-enabled';

function readSoundPreference() {
  try { return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'off'; }
  catch { return true; }
}

function soundCategory(id: string): SoundCategory {
  if (id === 'exe') return 'equals';
  if (id === 'del') return 'delete';
  if (id === 'ac') return 'clear';
  if (id === 'shift' || id === 'alpha' || id === 'mode' || id === 'on') return 'mode';
  if (id === 'left' || id === 'right' || id === 'up' || id === 'down') return 'navigation';
  if (/^d\d$/.test(id) || id === 'dot' || id === 'exp' || id === 'ans') return 'number';
  if (id === 'add' || id === 'sub' || id === 'mul' || id === 'div' || id === 'lparen' || id === 'rparen') return 'operator';
  return 'mode';
}

function ContactIcon({ name }: { name: 'facebook' | 'instagram' | 'whatsapp' }) {
  if (name === 'facebook') return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 21v-8.2h2.8l.4-3.2h-3.2V7.5c0-.9.3-1.5 1.6-1.5H17V3.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.7v3.2h2.7V21h3.2Z" fill="currentColor" /></svg>
  );
  if (name === 'instagram') return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.4" cy="6.8" r="1.1" fill="currentColor" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4a8.3 8.3 0 0 0-7.1 12.6l-1 4 4.1-1a8.3 8.3 0 1 0 4-15.6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 8.3c-.2-.4-.4-.4-.7-.4h-.6c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.9 4.4 3.9 2.2.9 2.6.7 3.1.7.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.6-.4l-1.8-.9c-.2-.1-.4-.1-.6.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5L9 8.3Z" fill="currentColor" /></svg>
  );
}

function ExternalArrow() {
  return <svg className="contact-external" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4h9v9M16 4 8 12M14 11v4H4V5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/* ---------------------------------------------------------------- calculator */
export default function Calculator() {
  const m = useMemo(() => new Machine(), []);
  const brain = useMemo(() => new CatBrain(), []);
  useSyncExternalStore(m.subscribe, m.getVersion);
  useEffect(() => {
    m.onEvent = (e) => {
      try { brain.notify(e); }
      catch { /* Cat reactions must never interfere with calculator input. */ }
    };
    return () => { m.onEvent = null; };
  }, [m, brain]);

  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [scale, setScale] = useState(1);
  const [infoOpen, setInfoOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(readSoundPreference);
  const modeRef = useRef(m.mode);
  const infoOpenRef = useRef(false);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contactDialogRef = useRef<HTMLElement>(null);
  const openedInfoRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const repeatRef = useRef<{ id: string; delay?: number; timer?: number } | null>(null);
  const keyboardTimersRef = useRef(new Set<number>());
  modeRef.current = m.mode;

  const activate = useCallback((id: string) => {
    if (infoOpenRef.current) return;
    buttonSounds.play(soundCategory(id));
    m.press(id);
  }, [m]);

  const stopArrowRepeat = useCallback(() => {
    const held = repeatRef.current;
    if (!held) return;
    if (held.delay !== undefined) window.clearTimeout(held.delay);
    if (held.timer !== undefined) window.clearTimeout(held.timer);
    repeatRef.current = null;
  }, []);

  const startArrowRepeat = useCallback((id: string) => {
    stopArrowRepeat();
    const held: { id: string; delay?: number; timer?: number } = { id };
    repeatRef.current = held;
    const repeat = () => {
      if (repeatRef.current !== held || infoOpenRef.current) return;
      activate(id);
      held.timer = window.setTimeout(repeat, 78);
    };
    held.delay = window.setTimeout(repeat, 340);
  }, [activate, stopArrowRepeat]);

  const down = useCallback((id: string, pointerId: number) => {
    if (infoOpenRef.current || activePointerRef.current !== null) return;
    activePointerRef.current = pointerId;
    setPressed((p) => { if (p.has(id)) return p; const n = new Set(p); n.add(id); return n; });
    activate(id);
    if (id === 'left' || id === 'right') startArrowRepeat(id);
  }, [activate, startArrowRepeat]);

  const up = useCallback((id: string, pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    stopArrowRepeat();
    setPressed((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }, [stopArrowRepeat]);

  const scheduleKey = useCallback((ms: number, callback: () => void) => {
    const timer = window.setTimeout(() => {
      keyboardTimersRef.current.delete(timer);
      callback();
    }, ms);
    keyboardTimersRef.current.add(timer);
  }, []);

  const closeInfo = useCallback(() => {
    infoOpenRef.current = false;
    setInfoOpen(false);
  }, []);

  const openInfo = useCallback(() => {
    infoOpenRef.current = true;
    activePointerRef.current = null;
    stopArrowRepeat();
    setPressed(new Set());
    setInfoOpen(true);
  }, [stopArrowRepeat]);

  const toggleSound = () => {
    const next = !soundOn;
    buttonSounds.setEnabled(next);
    setSoundOn(next);
    try { window.localStorage.setItem(SOUND_PREFERENCE_KEY, next ? 'on' : 'off'); }
    catch { /* sound preference remains available for this session */ }
  };

  // never leave a key stuck
  useEffect(() => {
    const clear = () => {
      activePointerRef.current = null;
      stopArrowRepeat();
      setPressed((p) => (p.size ? new Set() : p));
    };
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, [stopArrowRepeat]);

  useLayoutEffect(() => {
    buttonSounds.setEnabled(soundOn);
    return () => buttonSounds.setEnabled(false);
  }, []);

  useEffect(() => {
    if (infoOpen) {
      openedInfoRef.current = true;
      closeButtonRef.current?.focus();
    } else if (openedInfoRef.current) {
      openedInfoRef.current = false;
      infoButtonRef.current?.focus();
    }
  }, [infoOpen]);

  // physical keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (infoOpenRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeInfo();
        } else if (e.key === 'Tab') {
          const controls = contactDialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
          if (controls?.length) {
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        return;
      }
      if (e.target === infoButtonRef.current && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const seq = mapKey(e, modeRef.current);
      if (!seq) return;
      e.preventDefault();
      seq.forEach((id, i) => {
        scheduleKey(i * 30, () => {
          if (infoOpenRef.current) return;
          setPressed((p) => { const n = new Set(p); n.add(id); return n; });
          activate(id);
          scheduleKey(110, () => setPressed((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; }));
        });
      });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      keyboardTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      keyboardTimersRef.current.clear();
    };
  }, [activate, closeInfo, scheduleKey]);

  useEffect(() => () => stopArrowRepeat(), [stopArrowRepeat]);

  // fit to viewport, keep the aspect ratio
  useLayoutEffect(() => {
    const fit = () => {
      const vv = window.visualViewport;
      const w = vv?.width ?? window.innerWidth, h = vv?.height ?? window.innerHeight;
      setScale(Math.max(0.25, Math.min((w - 14) / W, (h - 14) / H, 2.4)));
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div className="stage">
      <div style={{ width: W * scale, height: H * scale }} className="stage-box">
        <div className="calc" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <div className="calc-sheen" />
          {/* header */}
          <div className="brand">CASIO</div>
          <div className="twp">TWO WAY POWER</div>
          <div className="cat-slot"><Cat brain={brain} /></div>
          <div className="model"><b>fx-991ES PLUS</b><i>Kajer Bedi Edition</i></div>
          <div className="vpam">NATURAL-V.P.A.M.</div>
          <button ref={infoButtonRef} type="button" className="info-button" aria-label="Contact information" title="Need help?" onClick={openInfo}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.1" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M10 9v4.1M10 6.5h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          {/* LCD */}
          <div className="lcd-frame"><Lcd m={m} /></div>
          {/* keys */}
          {PLACED.map(({ def, left, top, w, h }) => (
            <div key={def.id} className="kcell" style={{ left, top, width: w, height: h + 15 }}>
              <div className="legend">
                <span className="lg-s"><Lab s={def.shift ?? ''} /></span>
                <span className="lg-a"><Lab s={def.alpha ?? ''} /></span>
              </div>
              <button
                type="button"
                tabIndex={-1}
                aria-label={def.main}
                className={`key k-${def.kind} ${def.cls ?? ''} k-${def.id}` + (pressed.has(def.id) ? ' down' : '') + (def.id === 'shift' && m.shift ? ' lit' : '') + (def.id === 'alpha' && m.alpha ? ' lit' : '')}
                style={{ height: h }}
                onPointerDown={(e) => { e.preventDefault(); if (activePointerRef.current !== null) return; (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId); down(def.id, e.pointerId); }}
                onPointerUp={(e) => up(def.id, e.pointerId)}
                onPointerCancel={(e) => up(def.id, e.pointerId)}
                onPointerLeave={(e) => up(def.id, e.pointerId)}
                onLostPointerCapture={(e) => up(def.id, e.pointerId)}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span className="cap"><Lab s={def.main} /></span>
              </button>
            </div>
          ))}
          <Pad pressed={pressed} onDown={(id, pointerId, target) => {
            if (activePointerRef.current !== null) return;
            target.setPointerCapture?.(pointerId);
            down(id, pointerId);
          }} onUp={up} />
        </div>
      </div>
      {infoOpen && (
        <div className="contact-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeInfo(); }}>
          <section ref={contactDialogRef} className="contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-title">
            <div className="contact-header">
              <div>
                <div className="contact-kicker">KAJER BEDI EDITION</div>
                <h2 id="contact-title">Need help?</h2>
                <p>Choose a social channel to get in touch.</p>
              </div>
              <button ref={closeButtonRef} type="button" className="contact-close" aria-label="Close contact popup" onClick={closeInfo}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="contact-links">
              <a className="contact-link facebook" href="https://www.facebook.com/sayem861096" target="_blank" rel="noopener noreferrer">
                <span className="contact-icon"><ContactIcon name="facebook" /></span><span className="contact-copy"><strong>Facebook</strong><small>Message Sayem</small></span><ExternalArrow />
              </a>
              <a className="contact-link instagram" href="https://www.instagram.com/_pervy__sayem_/" target="_blank" rel="noopener noreferrer">
                <span className="contact-icon"><ContactIcon name="instagram" /></span><span className="contact-copy"><strong>Instagram</strong><small>Follow or message</small></span><ExternalArrow />
              </a>
              <a className="contact-link whatsapp" href="https://wa.me/8801870517830" target="_blank" rel="noopener noreferrer">
                <span className="contact-icon"><ContactIcon name="whatsapp" /></span><span className="contact-copy"><strong>WhatsApp</strong><small>Start a conversation</small></span><ExternalArrow />
              </a>
            </div>
            <div className="sound-setting">
              <div><strong>Button sounds</strong><span>Soft tactile key feedback</span></div>
              <button type="button" role="switch" aria-checked={soundOn} aria-label={soundOn ? 'Turn button sounds off' : 'Turn button sounds on'} className={'sound-toggle' + (soundOn ? ' enabled' : '')} onClick={toggleSound}>
                <span />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
