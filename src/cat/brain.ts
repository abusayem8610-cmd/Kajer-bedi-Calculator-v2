// Event-driven behaviour controller for the virtual cat that lives in the calculator's top panel.
import type { CatEvent } from '../calc/machine';

export type CatState =
  | 'IDLE' | 'CURIOUS' | 'THINKING' | 'CONFUSED' | 'EXCITED' | 'CELEBRATING'
  | 'DISAPPOINTED' | 'SLEEPING' | 'GREETING' | 'PLAYING' | 'GENIUS' | 'EMBARRASSED'
  | 'SURPRISED' | 'PROUD';
export type ReactionIntensity = 'LOW' | 'MEDIUM' | 'HIGH';
export type Pose =
  | 'sit' | 'sleep' | 'lie' | 'walk' | 'jump' | 'bigjump' | 'wave' | 'stretch' | 'think' | 'scratch' | 'confused'
  | 'cheer' | 'dance' | 'cover' | 'ball' | 'tail' | 'spin' | 'nod' | 'sad' | 'groom';
export type Eyes = 'open' | 'closed' | 'happy' | 'wide' | 'half' | 'spiral' | 'sad' | 'sparkle';
export type Mouth = 'smile' | 'o' | 'flat' | 'tongue' | 'frown' | 'open';
export type Extra = 'none' | 'confetti' | 'hearts' | 'zzz' | 'question' | 'exclaim' | 'sweat' | 'sparkles' | 'ball';

export interface CatView {
  state: CatState;
  pose: Pose;
  eyes: Eyes;
  mouth: Mouth;
  extra: Extra;
  blink: boolean;
  lookX: number;
  lookY: number;
  tilt: number;
  x: number;
  dir: 1 | -1;
  moveMs: number;
  animKey: number;
  intensity: ReactionIntensity;
  bubble: { text: string; id: number } | null;
}

export const PANEL_W = 180;
export const PANEL_H = 44;
const MIN_X = 22;
const MAX_X = PANEL_W - 22;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface ExpressionProfile {
  score: number;
  length: number;
  operands: number;
  operators: number;
  functions: number;
  nesting: number;
  category: 'simple' | 'moderate' | 'complex' | 'extreme';
}

const FUNCTIONS = /^(?:a?(?:sin|cos|tan)h?|a?(?:sin|cos|tan)|log|ln|sqrt|cbrt|root|abs|int|der|sig|pol|rec|rnd|ranint|det|trn|ide|arg|conjg|re|im|x̂|ŷ)\($/i;
const OP_TOKENS = new Set(['+', '-', '×', '÷', 'nPr', 'nCr', '∠', 'and', 'or', 'xor', 'xnor']);

export function analyzeExpression(tokens: readonly string[], fallbackScore = 0): ExpressionProfile {
  let operands = 0;
  let operators = 0;
  let functions = 0;
  let nesting = 0;
  let maxNesting = 0;
  let score = 0;
  let inNumber = false;
  const variable = /^(?:[A-F]|[XYM]|Ans|π|e|i|K\d\d|Cv\d\d|Mat\w+|Vct\w+|Σ\w+|[a-z]̄|σ\w+|s\w+)$/;

  for (const token of tokens) {
    const number = /^[0-9.]$/.test(token);
    if (number && !inNumber) operands++;
    if (number || token === '°' || token === "'" || token === '"') inNumber = true;
    else inNumber = false;

    if (variable.test(token)) operands++;
    if (OP_TOKENS.has(token) || token === '!' || token === '%') {
      operators++;
      score += token === 'nPr' || token === 'nCr' || token === '!' ? 1.7 : 1.1;
    }
    if (/^(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|asinh|acosh|atanh|log|ln)/i.test(token) && token.endsWith('(')) {
      functions++;
      score += 2.1;
    } else if (FUNCTIONS.test(token)) {
      functions++;
      score += 1.7;
    }
    if (token === 'POW' || token === 'ROOT' || token === 'LOGB' || token === 'SQRT' || token === 'CBRT') score += 2.2;
    else if (token === 'FRAC' || token === 'MIX' || token === 'ABS') score += 1.4;

    if (token === '(' || token === 'FRAC' || token === 'MIX' || token === 'SQRT' || token === 'CBRT' || token === 'ROOT' || token === 'POW' || token === 'LOGB' || token === 'ABS' || token === 'INT' || token === 'DER' || token === 'SIG' || token.endsWith('(')) {
      nesting++;
      maxNesting = Math.max(maxNesting, nesting);
      if (token === 'INT' || token === 'DER' || token === 'SIG') score += 4.5;
    } else if (token === ')' || token === 'END') {
      nesting = Math.max(0, nesting - 1);
    }
  }

  score += tokens.length * 0.13 + operands * 0.9 + operators * 0.35 + maxNesting * 0.8;
  if (!tokens.length) score = fallbackScore;
  const extreme = score >= 24 || tokens.length >= 55 || maxNesting >= 5;
  const category = extreme ? 'extreme' : score >= 13 ? 'complex' : score >= 5 ? 'moderate' : 'simple';
  return { score: Math.max(score, fallbackScore * 0.3), length: tokens.length, operands, operators, functions, nesting: maxNesting, category };
}

const THINK_FIRST = ['Hmm...', 'Let me think!', "That's interesting...", 'Working it out...'];
const THINK_MID = ['I think I know this one!', 'Working it out...', 'Hmm...', "That's interesting..."];
const THINK_HARD = ['Wait, what?', 'A little complicated!', 'Let me think!', 'I can work this out.'];
const GENIUS_LINES = ['Big brain moment!', "I'm smarter than I look!", 'Easy for me!'];
const PROUD_LINES = ['We nailed it!', 'Proud of us!', 'That was clever!'];
const SURPRISE_LINES = ['That was a big one!', 'I did not expect that!', 'Whoa, look at that!'];
const SLEEP_LINES = ['Zzz...', 'So cozy...', 'Wake me for math.'];
const IDLE_LINES = ['Still here!', 'Take your time.', 'Ready when you are.'];
const CELEBRATE = [
  'We got it!', 'Easy for me!', 'I knew it!', 'Look at that!', 'Math is fun!',
  'Mission accomplished!', 'Purr-fect answer!', 'That was clever!', 'We nailed it!',
];
const ERRORS = ['Oops!', "Let's try again!", "Hmm... that's not right.", 'We can fix this!', 'One more try?'];
const RESETS = ['Starting fresh!', 'Clean slate!', "Let's try something else!"];
const GREETS = ['Hi there!', "Let's do some math!", "I'm here!", 'Still calculating?'];

export class CatBrain {
  view: CatView = {
    state: 'IDLE', pose: 'sit', eyes: 'open', mouth: 'smile', extra: 'none', blink: false, lookX: 0, lookY: 0, tilt: 0,
    x: 100, dir: 1, moveMs: 0, animKey: 0, intensity: 'LOW', bubble: null,
  };
  private subs = new Set<() => void>();
  private timers = new Set<number>();
  private seq = 0;
  private lastInteract = Date.now();
  private lastBubbleAt = 0;
  private bubbleId = 0;
  private bubbleTimer = 0;
  private settleTimer = 0;
  private blinkTimer = 0;
  private blinkEndTimer = 0;
  private level: 'none' | 'simple' | 'moderate' | 'complex' | 'extreme' = 'none';
  private lastAct = '';
  private started = false;
  private lastPhrase = '';
  private previousReaction: CatState = 'IDLE';
  private previousInteractionAt = Date.now();
  private consecutiveSuccesses = 0;
  private consecutiveErrors = 0;
  private successfulCalculations = 0;
  private complexCalculations = 0;
  private lastFiveSuccessMilestone = 0;
  private lastComplexMilestone = 0;
  private lastGeniusAt = 0;
  private lastPlayAt = 0;

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  getSnapshot = () => this.view;

  start() {
    if (this.started) return;
    this.started = true;
    const blink = () => {
      const v = this.view;
      if (v.state !== 'SLEEPING' && (v.eyes === 'open' || v.eyes === 'half')) {
        this.set({ blink: true });
        clearTimeout(this.blinkEndTimer);
        this.blinkEndTimer = window.setTimeout(() => this.set({ blink: false }), 130);
      }
      this.blinkTimer = window.setTimeout(blink, rand(2000, 5200));
    };
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reducedMotion) this.blinkTimer = window.setTimeout(blink, 1800);
    this.actGreet();
  }

  stop() {
    this.started = false;
    this.cancel();
    clearTimeout(this.blinkTimer); clearTimeout(this.blinkEndTimer); clearTimeout(this.settleTimer); clearTimeout(this.bubbleTimer);
  }

  // ------------------------------------------------------------ helpers
  private set(p: Partial<CatView>) {
    if (p.state && p.state !== this.view.state) this.previousReaction = this.view.state;
    this.view = { ...this.view, ...p };
    this.subs.forEach((f) => f());
  }
  private pose(p: Pose, patch: Partial<CatView> = {}) {
    this.set({ pose: p, animKey: this.view.animKey + 1, ...patch });
  }
  private later(ms: number, fn: () => void) {
    const tok = this.seq;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (tok === this.seq) fn();
    }, ms);
    this.timers.add(id);
  }
  private cancel() {
    this.seq++;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }
  private say(text: string, ms = 2400, force = false) {
    if (!force && !this.canSpeak()) return;
    if (text === this.lastPhrase) return;
    this.lastPhrase = text;
    this.lastBubbleAt = Date.now();
    this.bubbleId++;
    clearTimeout(this.bubbleTimer);
    this.set({ bubble: { text, id: this.bubbleId } });
    this.bubbleTimer = window.setTimeout(() => this.set({ bubble: null }), ms);
  }
  private sayChoice(phrases: string[], ms = 2400, force = false) {
    const available = phrases.filter((phrase) => phrase !== this.lastPhrase);
    this.say(pick(available.length ? available : phrases), ms, force);
  }
  private dismissBubble() {
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = 0;
    if (this.view.bubble) this.set({ bubble: null });
  }
  private canSpeak(gapMs = 3800) { return Date.now() - this.lastBubbleAt > gapMs; }
  private rest() {
    this.set({ state: 'IDLE', pose: 'sit', eyes: 'open', mouth: 'smile', lookX: 0, lookY: 0, tilt: 0, extra: 'none', moveMs: 0, intensity: 'LOW' });
  }
  private scheduleIdle(delay = rand(2200, 5200)) { this.later(delay, () => this.pickIdle()); }
  private endAct(ms: number) { this.later(ms, () => { this.rest(); this.scheduleIdle(); }); }
  private sleeping() { return this.view.state === 'SLEEPING'; }

  // ------------------------------------------------------------ idle behaviour
  private pickIdle() {
    const idle = (Date.now() - this.lastInteract) / 1000;
    if (idle > 52) return this.lieThenSleep();
    if (idle > 24 && Date.now() - this.lastPlayAt > 65000 && Math.random() < 0.12) {
      this.lastPlayAt = Date.now();
      return pick([() => this.actPlay(), () => this.actJump(), () => this.actTail(), () => this.actBig(), () => this.actFunny()])();
    }
    if (idle > 16) return Math.random() < 0.55 ? this.lieThenSleep(false) : this.actLook();
    const opts: [string, number, () => void][] = [
      ['look', 24, () => this.actLook()],
      ['walk', 20, () => this.actWalk()],
      ['sit', 12, () => this.actSit()],
      ['stretch', 8, () => this.actStretch()],
      ['greet', 5 + Math.min(10, idle / 5), () => this.actGreet()],
      ['groom', 5, () => this.actGroom()],
      ['user', 7, () => this.actUser()],
      ['lie', 5, () => this.lieThenSleep(false)],
      ['wave', 3, () => this.actWave()],
    ];
    const pool = opts.filter((o) => o[0] !== this.lastAct);
    let r = Math.random() * pool.reduce((s, o) => s + o[1], 0);
    for (const o of pool) { r -= o[1]; if (r <= 0) { this.lastAct = o[0]; o[2](); return; } }
    this.actSit();
  }

  private actLook() {
    const d = pick([-1, 1]);
    this.set({ state: 'IDLE', pose: 'sit', eyes: 'open', mouth: 'smile', lookX: d, lookY: rand(-0.2, 0.2) });
    this.later(1100, () => this.set({ lookX: -d }));
    this.later(2300, () => this.set({ lookX: 0, lookY: -0.8 }));
    this.later(3300, () => this.set({ lookY: 0 }));
    this.endAct(3900);
  }
  private actSit() {
    this.set({ state: 'IDLE', pose: 'sit', eyes: 'open', mouth: 'smile', lookX: rand(-0.5, 0.5), lookY: 0 });
    if (Math.random() < 0.16 && this.canSpeak()) this.sayChoice(IDLE_LINES);
    this.endAct(rand(2200, 4000));
  }
  private actWalk() {
    let target = this.view.x + pick([-1, 1]) * rand(40, 110);
    if (target < MIN_X || target > MAX_X) target = this.view.x - (target - this.view.x);
    target = clamp(target, MIN_X, MAX_X);
    if (Math.abs(target - this.view.x) < 25) target = this.view.x < PANEL_W / 2 ? MAX_X - rand(0, 30) : MIN_X + rand(0, 30);
    const dist = Math.abs(target - this.view.x);
    const ms = (dist / 24) * 1000;
    const dir: 1 | -1 = target > this.view.x ? 1 : -1;
    this.set({ state: 'IDLE', dir, eyes: 'open', mouth: 'smile', lookX: dir * 0.5, lookY: 0, tilt: 0 });
    this.pose('walk', { x: target, moveMs: ms });
    this.later(ms + 80, () => { this.set({ moveMs: 0 }); this.rest(); this.scheduleIdle(); });
  }
  private actJump() {
    const n = 1 + Math.floor(Math.random() * 3);
    this.set({ state: 'PLAYING', eyes: 'happy', mouth: 'open' });
    for (let i = 0; i < n; i++) this.later(i * 720, () => this.pose('jump', { dir: Math.random() < 0.3 ? (-this.view.dir as 1 | -1) : this.view.dir }));
    this.endAct(n * 720 + 200);
  }
  private actStretch() {
    this.set({ state: 'IDLE', eyes: 'happy', mouth: 'o', lookX: 0, lookY: 0 });
    this.pose('stretch');
    this.endAct(2500);
  }
  private actGreet() {
    this.set({ state: 'GREETING', eyes: 'happy', mouth: 'smile', lookX: 0, lookY: 0, intensity: 'MEDIUM' });
    this.pose('wave');
    this.sayChoice(GREETS, 2400, true);
    this.endAct(2600);
  }
  private actWave() {
    this.set({ state: 'GREETING', eyes: 'happy', mouth: 'smile', lookX: 0, lookY: 0 });
    this.pose('wave');
    if (Math.random() < 0.5) this.say('Hi!');
    this.endAct(2200);
  }
  private actGroom() {
    this.set({ state: 'IDLE', eyes: 'closed', mouth: 'flat' });
    this.pose('groom');
    this.endAct(2300);
  }
  private actUser() {
    this.set({ state: 'CURIOUS', eyes: 'open', mouth: 'smile', lookX: 0, lookY: 0.05, pose: 'sit' });
    if (Math.random() < 0.3 && this.canSpeak()) this.sayChoice(GREETS);
    this.endAct(2000);
  }
  private actPlay() {
    this.set({ state: 'PLAYING', eyes: 'open', mouth: 'smile', lookX: 0.6, lookY: 0.5, extra: 'ball' });
    this.pose('ball');
    this.endAct(3800);
  }
  private actTail() {
    this.set({ state: 'PLAYING', eyes: 'happy', mouth: 'open' });
    this.pose('tail');
    this.endAct(3000);
  }
  private actBig() {
    this.set({ state: 'PLAYING', eyes: 'sparkle', mouth: 'open', extra: 'sparkles' });
    this.pose('bigjump');
    this.endAct(1500);
  }
  private actFunny() {
    this.set({ state: 'PLAYING', eyes: pick<Eyes>(['spiral', 'half']), mouth: 'tongue', lookX: 0, lookY: 0, tilt: pick([-10, 10]) });
    this.pose('sit');
    this.endAct(1700);
  }
  private lieThenSleep(sleep = true) {
    this.set({ state: 'IDLE', eyes: 'half', mouth: 'flat', lookX: 0, lookY: 0 });
    this.pose('lie');
    if (sleep) {
      this.later(2200, () => this.fallAsleep());
    } else this.endAct(rand(3000, 5000));
  }
  private fallAsleep() {
    this.set({ state: 'SLEEPING', eyes: 'closed', mouth: 'flat', extra: 'zzz', lookX: 0, lookY: 0, tilt: 0, intensity: 'LOW' });
    this.pose('sleep');
    this.sayChoice(SLEEP_LINES, 2200, true);
  }
  private startleWake(then: () => void) {
    this.cancel();
    this.set({ state: 'EXCITED', eyes: 'wide', mouth: 'o', extra: 'exclaim', lookX: 0, lookY: 0.4, intensity: 'MEDIUM' });
    this.pose('jump');
    this.later(520, then);
  }

  // ------------------------------------------------------------ active expression timeout
  private settle() {
    this.level = 'none';
    this.cancel();
    this.rest();
    this.scheduleIdle(rand(1500, 3000));
  }
  private armSettle() {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      const s = this.view.state;
      if (s === 'THINKING' || s === 'CURIOUS' || s === 'CONFUSED') this.settle();
    }, 7000);
  }

  // ------------------------------------------------------------ calculator events
  notify(e: CatEvent) {
    const now = Date.now();
    this.previousInteractionAt = this.lastInteract;
    const returned = now - this.previousInteractionAt > 30000;
    this.lastInteract = now;
    this.cancel();
    clearTimeout(this.settleTimer);
    this.dismissBubble();
    switch (e.type) {
      case 'type': return this.onType(e, returned);
      case 'result': return this.onResult(e);
      case 'error': return this.onError();
      case 'del': return this.onDel(e, returned);
      case 'ac': return this.onAc(returned);
      case 'mode':
      case 'key': return this.onKey(returned);
    }
  }

  private onKey(returned: boolean) {
    if (this.sleeping()) return this.startleWake(() => { this.rest(); this.scheduleIdle(); });
    const s = this.view.state;
    if (this.level !== 'none' && (s === 'CURIOUS' || s === 'THINKING' || s === 'CONFUSED')) {
      this.set({ lookY: 0.9, extra: 'none', moveMs: 0 });
      this.armSettle();
      return;
    }
    if (s !== 'IDLE' || this.previousReaction === 'PLAYING' || returned) {
      this.set({ state: returned ? 'GREETING' : 'CURIOUS', pose: 'sit', eyes: returned ? 'happy' : 'open', mouth: 'smile', lookX: 0, lookY: 0.9, tilt: 0, extra: 'none', moveMs: 0, intensity: 'LOW' });
      if (returned && this.canSpeak(0)) this.say('You\'re back!', 2400, true);
      this.endAct(2300);
    }
  }

  private onType(e: Extract<CatEvent, { type: 'type' }>, returned: boolean) {
    const profile = analyzeExpression(e.tokens, e.score);
    const lvl = profile.category;
    const lookX = clamp(e.pos * 1.7 - 0.85, -1, 1);
    const s = this.view.state;
    if (this.sleeping()) {
      this.startleWake(() => this.beginTyping(lvl, lookX, true, profile, returned));
      this.armSettle();
      return;
    }
    const idleish = ['IDLE', 'GREETING', 'PLAYING', 'CELEBRATING', 'EXCITED', 'DISAPPOINTED', 'GENIUS', 'PROUD', 'SURPRISED', 'EMBARRASSED'].includes(s);
    if (idleish || lvl !== this.level) this.beginTyping(lvl, lookX, idleish, profile, returned);
    else {
      this.set({ lookX, lookY: 0.9 });
      if (Math.random() < 0.07) this.set({ tilt: pick([-10, -6, 6, 10]) });
      if ((this.level === 'complex' || this.level === 'extreme') && Math.random() < 0.05) this.pose(pick<Pose>(['scratch', 'confused']));
      if (Math.random() < 0.05 && this.canSpeak(6000)) this.sayChoice(this.level === 'extreme' || this.level === 'complex' ? THINK_HARD : this.level === 'moderate' ? THINK_MID : THINK_FIRST);
      if (returned && this.canSpeak(0)) this.say('You\'re back!', 2400, true);
    }
    this.armSettle();
  }

  private beginTyping(lvl: ExpressionProfile['category'], lookX: number, first: boolean, profile: ExpressionProfile, returned = false) {
    this.cancel();
    this.dismissBubble();
    this.level = lvl;
    if (lvl === 'simple') {
      this.pose(pick<Pose>(['sit', 'nod', 'nod']), { state: 'CURIOUS', eyes: 'open', mouth: 'smile', tilt: 0, extra: 'none', lookX, lookY: 0.9, moveMs: 0, intensity: 'LOW' });
    } else if (lvl === 'moderate') {
      this.pose(pick<Pose>(['think', 'think', 'nod']), { state: 'CURIOUS', eyes: 'open', mouth: 'flat', tilt: pick([-7, 7]), extra: 'none', lookX, lookY: 0.9, moveMs: 0, intensity: 'MEDIUM' });
    } else if (lvl === 'complex') {
      this.pose(pick<Pose>(['think', 'scratch']), { state: 'THINKING', eyes: 'half', mouth: 'flat', tilt: pick([-5, 5]), extra: 'none', lookX, lookY: 0.9, moveMs: 0, intensity: 'HIGH' });
    } else if (Math.random() < 0.22) {
      this.pose('jump', { state: 'SURPRISED', eyes: 'wide', mouth: 'o', tilt: 0, extra: 'exclaim', lookX, lookY: 0.7, moveMs: 0, intensity: 'HIGH' });
    } else {
      this.pose(pick<Pose>(['scratch', 'confused']), {
        state: 'CONFUSED', eyes: pick<Eyes>(['wide', 'spiral', 'open']), mouth: pick<Mouth>(['o', 'flat']), tilt: pick([-9, 9]),
        extra: pick<Extra>(['question', 'question', 'sweat']), lookX, lookY: 0.7, moveMs: 0, intensity: 'HIGH',
      });
    }
    const p = first ? 0.62 : 0.3;
    if (returned) {
      this.say('You\'re back!', 2400, true);
    } else if (Math.random() < p && this.canSpeak(2500)) {
      this.sayChoice(lvl === 'extreme' || lvl === 'complex' ? THINK_HARD : lvl === 'moderate' ? (first ? THINK_FIRST : THINK_MID) : THINK_FIRST);
    }
    if (profile.score > 0 && Math.random() < 0.18) {
      this.later(rand(1700, 2800), () => { if (this.level === lvl) this.set({ tilt: pick([-6, 0, 6]) }); });
    }
  }

  private onResult(e: Extract<CatEvent, { type: 'result' }>) {
    clearTimeout(this.settleTimer);
    this.level = 'none';
    const profile = analyzeExpression(e.tokens ?? [], e.score);
    const priorErrors = this.consecutiveErrors;
    this.successfulCalculations++;
    this.consecutiveSuccesses++;
    this.consecutiveErrors = 0;
    if (profile.score >= 13) this.complexCalculations++;

    let state: 'CELEBRATING' | 'GENIUS' | 'PROUD' | 'SURPRISED' = 'CELEBRATING';
    let phrase: string | undefined;
    const streakMilestone = Math.floor(this.consecutiveSuccesses / 5);
    if (streakMilestone > this.lastFiveSuccessMilestone) {
      this.lastFiveSuccessMilestone = streakMilestone;
      phrase = "You're on fire!";
    } else if (priorErrors > 0) {
      phrase = 'See? We did it!';
    } else if (profile.category === 'extreme' && profile.score >= 24 && Date.now() - this.lastGeniusAt > 90000 && Math.random() < 0.12) {
      state = 'GENIUS';
      phrase = pick(GENIUS_LINES);
      this.lastGeniusAt = Date.now();
    } else {
      const complexMilestone = Math.floor(this.complexCalculations / 3);
      if (complexMilestone > 0 && complexMilestone > this.lastComplexMilestone) {
        this.lastComplexMilestone = complexMilestone;
        state = 'PROUD';
        phrase = pick(PROUD_LINES);
      } else if (this.successfulCalculations > 1 && profile.category === 'extreme' && Math.random() < 0.18) {
        state = 'SURPRISED';
        phrase = pick(SURPRISE_LINES);
      }
    }
    this.celebrate(e.long || profile.category === 'extreme', state, phrase);
  }

  private celebrate(long: boolean, state: 'CELEBRATING' | 'GENIUS' | 'PROUD' | 'SURPRISED' = 'CELEBRATING', phrase?: string) {
    const kinds = state === 'GENIUS' ? ['big'] : state === 'PROUD' ? ['nod', 'cheer'] : long ? ['big', 'cheer', 'spin'] : ['jump', 'cheer', 'dance', 'spin', 'jump'];
    const k = pick(kinds);
    this.set({ state, lookX: 0, lookY: 0.2, tilt: 0, intensity: state === 'GENIUS' || state === 'SURPRISED' || long ? 'HIGH' : state === 'PROUD' ? 'MEDIUM' : 'LOW' });
    if (state === 'GENIUS') {
      this.pose('bigjump', { eyes: 'sparkle', mouth: 'open', extra: 'sparkles' });
    } else if (state === 'PROUD') {
      this.pose(k === 'nod' ? 'nod' : 'cheer', { eyes: 'happy', mouth: 'smile', extra: 'sparkles' });
    } else if (state === 'SURPRISED') {
      this.pose('jump', { eyes: 'wide', mouth: 'o', extra: 'exclaim' });
    } else switch (k) {
      case 'jump': this.pose('jump', { eyes: 'happy', mouth: 'open', extra: 'sparkles' }); break;
      case 'cheer': this.pose('cheer', { eyes: 'happy', mouth: 'open', extra: 'confetti' }); break;
      case 'dance': this.pose('dance', { eyes: 'happy', mouth: 'smile', extra: 'hearts' }); break;
      case 'spin': this.pose('spin', { eyes: 'sparkle', mouth: 'open', extra: 'hearts' }); break;
      case 'nod': this.pose('nod', { eyes: 'happy', mouth: 'smile', extra: 'sparkles' }); break;
      default: this.pose('bigjump', { eyes: 'sparkle', mouth: 'open', extra: 'confetti' });
    }
    if (phrase) this.say(phrase, 2600, true);
    else this.sayChoice(long && Math.random() < 0.7 ? ['Mission accomplished!'] : CELEBRATE, 2600, true);
    this.later(2700, () => {
      this.set({ state: 'EXCITED', eyes: 'happy', mouth: 'smile', extra: 'none', pose: 'sit', intensity: 'MEDIUM' });
      this.later(1300, () => { this.rest(); this.scheduleIdle(rand(2500, 4500)); });
    });
  }

  private onError() {
    clearTimeout(this.settleTimer);
    this.level = 'none';
    this.consecutiveErrors++;
    this.consecutiveSuccesses = 0;
    this.lastFiveSuccessMilestone = 0;
    const embarrassed = this.consecutiveErrors >= 3;
    this.set({ state: embarrassed ? 'EMBARRASSED' : 'DISAPPOINTED', lookX: 0, lookY: 0.4, moveMs: 0, intensity: embarrassed ? 'MEDIUM' : 'LOW' });
    if (embarrassed) this.pose('cover', { eyes: 'closed', mouth: 'flat', extra: 'sweat', tilt: 0 });
    else {
      const k = pick(['cover', 'confused', 'sad']);
      if (k === 'cover') this.pose('cover', { eyes: 'closed', mouth: 'flat', extra: 'sweat', tilt: 0 });
      else if (k === 'confused') this.pose('confused', { eyes: 'sad', mouth: 'flat', extra: 'question', tilt: pick([-9, 9]) });
      else this.pose('sad', { eyes: 'sad', mouth: 'frown', extra: 'none', tilt: 0 });
    }
    if (embarrassed) this.sayChoice(['We can fix this!', 'Take a breath, we can try again.', 'No worries, one step at a time.'], 2800, true);
    else if (this.consecutiveErrors >= 2) this.sayChoice(['We can fix this!', 'One more try?', 'No worries, we can try again.'], 2800, true);
    else this.sayChoice(ERRORS, 2800, true);
    this.later(2400, () => {
      this.set({ state: 'CONFUSED', eyes: 'open', mouth: 'flat', extra: 'none', pose: 'sit', tilt: 4, intensity: 'LOW' });
      this.later(1300, () => { this.rest(); this.scheduleIdle(); });
    });
  }

  private onDel(e: Extract<CatEvent, { type: 'del' }>, returned: boolean) {
    const profile = analyzeExpression(e.tokens, e.score);
    if (this.sleeping()) {
      return this.startleWake(() => {
        if (e.tokens.length) this.beginTyping(profile.category, 0, false, profile, returned);
        else { this.rest(); this.scheduleIdle(); }
      });
    }
    if (e.tokens.length) this.beginTyping(profile.category, 0, false, profile, returned);
    else {
      this.level = 'none';
      this.set({ state: returned ? 'GREETING' : 'CURIOUS', pose: 'sit', eyes: returned ? 'happy' : 'open', mouth: 'flat', lookX: 0, lookY: 1, tilt: 7, extra: 'none', moveMs: 0, intensity: 'LOW' });
      if (returned) this.say('You\'re back!', 2400, true);
      this.later(900, () => this.set({ tilt: 0 }));
      this.armSettle();
    }
  }

  private onAc(returned: boolean) {
    clearTimeout(this.settleTimer);
    this.level = 'none';
    const wasSleeping = this.sleeping();
    if (wasSleeping) { this.startleWake(() => { this.rest(); this.scheduleIdle(); }); return; }
    this.set({ state: returned ? 'GREETING' : 'IDLE', eyes: 'happy', mouth: 'o', lookX: 0, lookY: 0, tilt: 0, extra: 'none', moveMs: 0, intensity: 'LOW' });
    this.pose(Math.random() < 0.5 ? 'stretch' : 'sit');
    if (returned) this.say('You\'re back!', 2400, true);
    else if (Math.random() < 0.85) this.sayChoice(RESETS, 2400, true);
    this.endAct(2200);
  }
}
