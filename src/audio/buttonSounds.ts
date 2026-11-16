export type SoundCategory = 'number' | 'operator' | 'delete' | 'clear' | 'equals' | 'mode' | 'navigation';

interface TonePreset {
  start: number;
  end: number;
  level: number;
  decay: number;
}

interface Voice {
  gains: GainNode[];
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  ended: number;
}

const PRESETS: Record<SoundCategory, TonePreset> = {
  number: { start: 174, end: 122, level: 0.12, decay: 0.095 },
  operator: { start: 146, end: 103, level: 0.14, decay: 0.105 },
  delete: { start: 160, end: 112, level: 0.13, decay: 0.095 },
  clear: { start: 138, end: 94, level: 0.15, decay: 0.13 },
  equals: { start: 204, end: 151, level: 0.16, decay: 0.14 },
  mode: { start: 190, end: 148, level: 0.085, decay: 0.075 },
  navigation: { start: 176, end: 132, level: 0.075, decay: 0.07 },
};

/** Small original synth voice for low-latency tactile key feedback. */
class ButtonSoundSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  enabled = true;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      try { this.silence(); } catch { /* audio may be interrupted by the browser */ }
    }
  }

  play(category: SoundCategory) {
    if (!this.enabled || typeof window === 'undefined') return;
    try { this.playTone(category); }
    catch {
      try { this.silence(); } catch { /* input remains independent of audio state */ }
    }
  }

  private playTone(category: SoundCategory) {
    const context = this.getContext();
    if (!context || !this.master) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);

    if (this.voices.size >= 5) this.fadeVoice(this.voices.values().next().value, context.currentTime);

    const preset = PRESETS[category];
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(preset.level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + preset.decay);
    gain.connect(this.master);

    const tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(preset.start, now);
    tone.frequency.exponentialRampToValueAtTime(preset.end, now + Math.min(0.055, preset.decay * 0.7));
    tone.connect(gain);

    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(preset.start * 2.2, now);
    overtone.frequency.exponentialRampToValueAtTime(preset.end * 1.8, now + Math.min(0.04, preset.decay * 0.6));
    overtoneGain.gain.value = 0.075;
    overtone.connect(overtoneGain);
    overtoneGain.connect(gain);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(760, now);
    filter.Q.value = 0.65;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(preset.level * 0.055, now + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);
    const noise = context.createBufferSource();
    noise.buffer = this.getNoiseBuffer(context);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.master);

    const voice: Voice = {
      gains: [gain, noiseGain],
      nodes: [gain, tone, overtone, overtoneGain, filter, noiseGain, noise],
      sources: [tone, overtone, noise],
      ended: 0,
    };
    this.voices.add(voice);
    for (const source of voice.sources) {
      source.onended = () => this.releaseEndedVoice(voice);
      source.start(now);
      source.stop(now + (source === noise ? 0.032 : preset.decay + 0.02));
    }
  }

  private getContext() {
    if (this.context) return this.context;
    const windowWithWebKit = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = window.AudioContext ?? windowWithWebKit.webkitAudioContext;
    if (!AudioContextCtor) return null;

    try {
      this.context = new AudioContextCtor({ latencyHint: 'interactive' });
    } catch {
      try { this.context = new AudioContextCtor(); } catch { return null; }
    }
    this.master = this.context.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.context.destination);
    return this.context;
  }

  private releaseEndedVoice(voice: Voice) {
    voice.ended++;
    if (voice.ended < voice.sources.length) return;
    this.voices.delete(voice);
    voice.nodes.forEach((node) => node.disconnect());
  }

  private fadeVoice(voice: Voice | undefined, now: number) {
    if (!voice) return;
    voice.gains.forEach((gain) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.003);
    });
    voice.sources.forEach((source) => {
      try { source.stop(now + 0.015); } catch { /* a voice can already be ending */ }
    });
  }

  private silence() {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      voice.gains.forEach((gain) => {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
      });
      voice.sources.forEach((source) => {
        try { source.stop(now); } catch { /* a voice can already be ending */ }
      });
    }
  }

  private getNoiseBuffer(context: AudioContext) {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.ceil(context.sampleRate * 0.032);
    this.noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const fade = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    return this.noiseBuffer;
  }
}

export const buttonSounds = new ButtonSoundSystem();