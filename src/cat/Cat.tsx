import { useEffect, useSyncExternalStore } from 'react';
import { CatBrain, CatView, PANEL_H, PANEL_W } from './brain';

const FUR = '#f4a259';
const FUR_D = '#d9822b';
const BELLY = '#ffe9cf';
const OUT = '#a85a1a';
const INK = '#2a1a12';

function Eye({ side, v }: { side: -1 | 1; v: CatView }) {
  const lx = v.lookX * 1.1, ly = v.lookY * 0.9;
  const kind = v.blink && (v.eyes === 'open' || v.eyes === 'half') ? 'closed' : v.eyes;
  const cx = side * 3.4;
  const g = (children: React.ReactNode) => <g transform={`translate(${cx} -19.3)`}>{children}</g>;
  switch (kind) {
    case 'closed':
      return g(<path d="M-2.2 0 Q0 1.7 2.2 0" fill="none" stroke={INK} strokeWidth="0.7" strokeLinecap="round" />);
    case 'happy':
      return g(<path d="M-2.3 0.8 Q0 -2.2 2.3 0.8" fill="none" stroke={INK} strokeWidth="0.8" strokeLinecap="round" />);
    case 'wide':
      return g(<>
        <ellipse rx="2.8" ry="3.1" fill="#fff" stroke={INK} strokeWidth="0.3" />
        <circle cx={lx} cy={ly} r="1" fill={INK} />
      </>);
    case 'half':
      return g(<>
        <ellipse rx="2.3" ry="2.5" fill="#fff" />
        <circle cx={lx} cy={ly + 0.4} r="1.4" fill={INK} />
        <path d="M-2.6 -0.2 L2.6 -0.2 L2.6 -3 L-2.6 -3 Z" fill={FUR} />
        <path d="M-2.4 -0.2 L2.4 -0.2" stroke={INK} strokeWidth="0.5" />
      </>);
    case 'spiral':
      return g(<g className="spin-eye">
        <circle r="2.4" fill="#fff" stroke={INK} strokeWidth="0.4" />
        <path d="M0 0 m0.2 0 a0.6 0.6 0 1 1 -0.6 0.6 a1.2 1.2 0 1 1 1.4 -1.4 a1.9 1.9 0 1 1 -2.2 2.2" fill="none" stroke={INK} strokeWidth="0.45" />
      </g>);
    case 'sad':
      return g(<>
        <ellipse rx="2.2" ry="2.5" fill="#fff" />
        <circle cx={lx * 0.5} cy={ly * 0.5 + 0.5} r="1.5" fill={INK} />
        <circle cx={lx * 0.5 - 0.4} cy={ly * 0.5 - 0.1} r="0.5" fill="#fff" />
        <path d={side === -1 ? 'M-3 -3.4 L1.8 -2.4' : 'M3 -3.4 L-1.8 -2.4'} stroke={INK} strokeWidth="0.6" strokeLinecap="round" />
      </>);
    case 'sparkle':
      return g(<path className="twinkle" d="M0 -3.2 L0.9 -0.9 L3.2 0 L0.9 0.9 L0 3.2 L-0.9 0.9 L-3.2 0 L-0.9 -0.9Z" fill="#fff4a8" stroke="#e0a000" strokeWidth="0.3" />);
    default:
      return g(<>
        <ellipse rx="2.3" ry="2.7" fill="#fff" />
        <circle cx={lx} cy={ly} r="1.5" fill={INK} />
        <circle cx={lx - 0.5} cy={ly - 0.7} r="0.55" fill="#fff" />
      </>);
  }
}

function Mouth({ m }: { m: CatView['mouth'] }) {
  const s = { fill: 'none', stroke: INK, strokeWidth: 0.55, strokeLinecap: 'round' as const };
  switch (m) {
    case 'o': return <ellipse cx="0" cy="-14.4" rx="0.9" ry="1.1" fill={INK} />;
    case 'flat': return <path d="M-1.5 -14.7 L1.5 -14.7" {...s} />;
    case 'frown': return <path d="M-1.8 -13.9 Q0 -15.4 1.8 -13.9" {...s} />;
    case 'open': return <g><path d="M-2 -15.1 Q0 -11.8 2 -15.1 Z" fill="#7a2230" /><path d="M-0.9 -13.2 Q0 -12.4 0.9 -13.2" fill="#ff8a9c" /></g>;
    case 'tongue': return <g><path d="M-1.9 -15.1 Q-0.9 -13.9 0 -15.1 Q0.9 -13.9 1.9 -15.1" {...s} /><path d="M-0.8 -14.3 L-0.8 -12.9 Q0 -12.2 0.8 -12.9 L0.8 -14.3Z" fill="#ff7f95" /></g>;
    default: return <path d="M-1.9 -15.1 Q-0.9 -13.8 0 -15.1 Q0.9 -13.8 1.9 -15.1" {...s} />;
  }
}

function Extras({ v }: { v: CatView }) {
  switch (v.extra) {
    case 'zzz':
      return <g className="zzz" fill="#a9c8ff" fontFamily="Arial" fontWeight="bold">
        <text x="9" y="-24" fontSize="5">z</text><text x="13" y="-29" fontSize="6.5">z</text><text x="18" y="-34" fontSize="8">Z</text>
      </g>;
    case 'question': return <text className="mark" x="-3" y="-31" fontSize="10" fontWeight="bold" fontFamily="Arial" fill="#ffd95a" stroke="#a87800" strokeWidth="0.3">?</text>;
    case 'exclaim': return <text className="mark" x="-2" y="-31" fontSize="11" fontWeight="bold" fontFamily="Arial" fill="#ff6b5a" stroke="#8a1c10" strokeWidth="0.3">!</text>;
    case 'sweat': return <path className="sweat" d="M10 -26 q-2 3 0 4.4 q2 -1.4 0 -4.4z" fill="#7cc4ff" />;
    case 'hearts':
      return <g className="hearts" fill="#ff5d7a" fontSize="7" fontFamily="Arial">
        <text className="h1" x="-20" y="-14">♥</text><text className="h2" x="14" y="-18">♥</text><text className="h3" x="-4" y="-30">♥</text>
      </g>;
    case 'sparkles':
      return <g className="sparks" fill="#fff4a8" stroke="#e0a000" strokeWidth="0.3">
        {[[-14, -26, 1], [15, -22, 0.8], [-18, -10, 0.7], [18, -9, 0.9]].map(([x, y, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}><path className={'sp sp' + i} d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8Z" /></g>
        ))}
      </g>;
    case 'confetti': {
      const cols = ['#ff5d7a', '#ffd95a', '#5ad1ff', '#7dff9a', '#c07dff', '#ff9a4a'];
      return <g className="confetti">
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={i} className="cf" x={-34 + i * 5} y="-36" width="2.2" height="3.2" fill={cols[i % cols.length]}
            style={{ animationDelay: `${(i % 5) * 0.16}s`, animationDuration: `${1.1 + (i % 4) * 0.2}s` }} />
        ))}
      </g>;
    }
    case 'ball':
      return <g className="ball"><circle cx="14" cy="-3" r="3" fill="#e9455a" stroke="#8a1c2a" strokeWidth="0.4" /><path d="M11.4 -4 Q14 -2 16.6 -4" fill="none" stroke="#fff" strokeWidth="0.5" /></g>;
  }
  return null;
}

function Sprite({ v }: { v: CatView }) {
  const S = 1;
  return (
    <g style={{ transform: `translate(${v.x}px, 41px)`, transition: v.moveMs ? `transform ${v.moveMs}ms linear` : 'none' }}>
      <g style={{ transform: `scale(${S * v.dir}, ${S})`, transition: 'transform 0.25s' }}>
         <g className={`pose pose-${v.pose} state-${v.state.toLowerCase()} intensity-${v.intensity.toLowerCase()}`} key={v.pose + v.animKey}>
          <g className="whole">
            <g className="tail"><path d="M5.5 -4.5 C13 -4 15.5 -10 12.5 -15.5" fill="none" stroke={FUR} strokeWidth="3.2" strokeLinecap="round" /><path d="M12.9 -13.2 L12.4 -15.6" stroke={FUR_D} strokeWidth="3.2" strokeLinecap="round" /></g>
            <g className="body">
              <ellipse cx="0" cy="-6.4" rx="7.2" ry="6.6" fill={FUR} stroke={OUT} strokeWidth="0.5" />
              <ellipse cx="0" cy="-5.4" rx="4" ry="4.8" fill={BELLY} />
              <path d="M-6.6 -8 L-4.6 -7.4 M-6.8 -5.2 L-4.8 -5 M6.6 -8 L4.6 -7.4 M6.8 -5.2 L4.8 -5" stroke={FUR_D} strokeWidth="0.8" strokeLinecap="round" />
            </g>
            <ellipse className="foot footL" cx="-4" cy="-1" rx="3" ry="1.7" fill={FUR} stroke={OUT} strokeWidth="0.4" />
            <ellipse className="foot footR" cx="4" cy="-1" rx="3" ry="1.7" fill={FUR} stroke={OUT} strokeWidth="0.4" />
            <g style={{ transform: `rotate(${v.tilt}deg)`, transformOrigin: '0px -12px', transition: 'transform 0.45s ease' }}>
              <g className="head">
                {/* ears */}
                <g className="ear earL"><path d="M-7.6 -22 L-6.6 -30.2 L-1.4 -25.6 Z" fill={FUR} stroke={OUT} strokeWidth="0.5" strokeLinejoin="round" /><path d="M-6.4 -23.4 L-6 -28 L-3.2 -25.4 Z" fill="#f6a5b5" /></g>
                <g className="ear earR"><path d="M7.6 -22 L6.6 -30.2 L1.4 -25.6 Z" fill={FUR} stroke={OUT} strokeWidth="0.5" strokeLinejoin="round" /><path d="M6.4 -23.4 L6 -28 L3.2 -25.4 Z" fill="#f6a5b5" /></g>
                <ellipse cx="0" cy="-18.4" rx="8.3" ry="7.2" fill={FUR} stroke={OUT} strokeWidth="0.5" />
                <path d="M-2.2 -25.2 L-1.6 -23 M0 -25.5 L0 -23.2 M2.2 -25.2 L1.6 -23" stroke={FUR_D} strokeWidth="0.9" strokeLinecap="round" />
                <ellipse cx="-5.4" cy="-16" rx="1.6" ry="1" fill="#ff8fa3" opacity="0.55" />
                <ellipse cx="5.4" cy="-16" rx="1.6" ry="1" fill="#ff8fa3" opacity="0.55" />
                <Eye side={-1} v={v} />
                <Eye side={1} v={v} />
                <path d="M-1 -16.9 L1 -16.9 L0 -15.8Z" fill="#e5798f" />
                <Mouth m={v.mouth} />
                <path d="M-5.2 -16.4 L-10.5 -17.4 M-5.2 -15.6 L-10.3 -15.1 M5.2 -16.4 L10.5 -17.4 M5.2 -15.6 L10.3 -15.1" stroke="#fff" strokeWidth="0.35" opacity="0.8" />
              </g>
            </g>
            <g transform="translate(-4.6 -10)"><g className="arm armL"><rect x="-1.5" y="0" width="3" height="7" rx="1.5" fill={FUR} stroke={OUT} strokeWidth="0.4" /><ellipse cx="0" cy="7" rx="2" ry="1.5" fill={BELLY} stroke={OUT} strokeWidth="0.3" /></g></g>
            <g transform="translate(4.6 -10)"><g className="arm armR"><rect x="-1.5" y="0" width="3" height="7" rx="1.5" fill={FUR} stroke={OUT} strokeWidth="0.4" /><ellipse cx="0" cy="7" rx="2" ry="1.5" fill={BELLY} stroke={OUT} strokeWidth="0.3" /></g></g>
          </g>
        </g>
      </g>
      <g style={{ transform: 'scale(1)' }}><Extras v={v} /></g>
    </g>
  );
}

function Bubble({ v }: { v: CatView }) {
  if (!v.bubble) return null;
  const text = v.bubble.text;
  const w = Math.min(92, Math.max(44, 12 + text.length * 4.2));
  const left = v.x < PANEL_W / 2;
  const style: React.CSSProperties = left
    ? { left: Math.min(v.x + 13, PANEL_W - w - 3), maxWidth: 92 }
    : { right: Math.min(PANEL_W - v.x + 13, PANEL_W - w - 3), maxWidth: 92 };
  return (
    <div key={v.bubble.id} className={'cat-bubble ' + (left ? 'to-right' : 'to-left')} style={style}>
      {text}
    </div>
  );
}

export default function Cat({ brain }: { brain: CatBrain }) {
  const v = useSyncExternalStore(brain.subscribe, brain.getSnapshot);
  useEffect(() => {
    brain.start();
    return () => brain.stop();
  }, [brain]);
  return (
    <div className="cat-panel" aria-label="Solar panel with a tiny virtual cat" style={{ width: PANEL_W, height: PANEL_H }}>
      <svg viewBox={`0 0 ${PANEL_W} ${PANEL_H}`} width={PANEL_W} height={PANEL_H} className="cat-svg">
        <defs>
          <linearGradient id="solarBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b1d27" />
            <stop offset="0.5" stopColor="#0d0e14" />
            <stop offset="1" stopColor="#07080b" />
          </linearGradient>
          <clipPath id="panelClip"><rect width={PANEL_W} height={PANEL_H} rx="3" /></clipPath>
        </defs>
        <g clipPath="url(#panelClip)">
          <rect width={PANEL_W} height={PANEL_H} fill="url(#solarBg)" />
          {[1, 2, 3, 4].map((i) => <line key={i} x1={(PANEL_W / 5) * i} y1="0" x2={(PANEL_W / 5) * i} y2={PANEL_H} stroke="#2a2f3f" strokeWidth="0.6" />)}
          <line x1="0" y1={PANEL_H - 5} x2={PANEL_W} y2={PANEL_H - 5} stroke="#242838" strokeWidth="0.6" />
          <ellipse cx="0" cy="0" rx="9" ry="1.5" fill="#000" opacity="0.5" style={{ transform: `translate(${v.x}px, 41.6px)`, transition: v.moveMs ? `transform ${v.moveMs}ms linear` : 'none' }} />
          <Sprite v={v} />
        </g>
      </svg>
      <Bubble v={v} />
      <div className="cat-gloss" />
    </div>
  );
}
