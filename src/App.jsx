import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import * as Tone from 'tone';

// ============================================================================
// STORAGE SHIM — polyfills window.storage with localStorage when running
// outside Claude.ai (Vercel, GitHub Pages, native Capacitor wrap, etc.)
// The game's storageGet/storageSet helpers expect this API.
// ============================================================================
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    get: async (key) => {
      try {
        const v = localStorage.getItem(key);
        return v !== null ? { key, value: v, shared: false } : null;
      } catch { return null; }
    },
    set: async (key, value) => {
      try { localStorage.setItem(key, String(value)); return { key, value, shared: false }; }
      catch { return null; }
    },
    delete: async (key) => {
      try { localStorage.removeItem(key); return { key, deleted: true, shared: false }; }
      catch { return null; }
    },
    list: async (prefix) => {
      try {
        const keys = Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix));
        return { keys, prefix, shared: false };
      } catch { return { keys: [], prefix, shared: false }; }
    },
  };
}


const sound = {
  initialized: false, enabled: true, synth: null, shimmer: null, ambientSynth: null, ambientInterval: null, ambientLevel: null,
  async init() {
    if (this.initialized) return;
    try {
      await Tone.start();
      this.synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.18, sustain: 0.2, release: 0.4 } }).toDestination();
      this.synth.volume.value = -10;
      this.shimmer = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.4, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).toDestination();
      this.shimmer.volume.value = -28;
      // Ambient pad: soft sines for subtle background
      this.ambientSynth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.6, decay: 1.2, sustain: 0.5, release: 2.2 } }).toDestination();
      this.ambientSynth.volume.value = -34;
      this.initialized = true;
    } catch (e) {}
  },
  async collect(index) {
    if (!this.enabled) return; await this.init(); if (!this.synth) return;
    const notes = ['C5','D5','E5','F5','G5','A5','B5','C6','D6','E6'];
    try { this.synth.triggerAttackRelease(notes[Math.min(index, notes.length-1)], '8n'); } catch {}
  },
  async sparkle() { if (!this.enabled) return; await this.init(); if (!this.shimmer) return; try { this.shimmer.triggerAttackRelease('C7','32n'); } catch {} },
  async pop() { if (!this.enabled) return; await this.init(); if (!this.synth) return; try { this.synth.triggerAttackRelease('A5','32n'); } catch {} },
  async win() {
    if (!this.enabled) return; await this.init(); if (!this.synth) return;
    try {
      const now = Tone.now();
      this.synth.triggerAttackRelease('C5','8n', now);
      this.synth.triggerAttackRelease('E5','8n', now+0.14);
      this.synth.triggerAttackRelease('G5','8n', now+0.28);
      this.synth.triggerAttackRelease(['C6','E6','G6'],'2n', now+0.42);
    } catch {}
  },
  async startAmbient(level) {
    if (!this.enabled) return;
    if (this.ambientLevel === level) return; // already playing this level
    this.stopAmbient();
    await this.init();
    if (!this.ambientSynth) return;
    // Different chord per level (mood-matched)
    const chords = {
      1: ['C5', 'E5', 'G5'],     // sunny C-major
      2: ['A4', 'C5', 'E5'],     // mysterious A-minor
      3: ['F4', 'A4', 'C5'],     // cheerful F-major
      4: ['G4', 'B4', 'D5'],     // bright G-major
      5: ['D5', 'F#5', 'A5'],    // hopeful D-major
      6: ['E4', 'G4', 'B4'],     // gentle E-minor
    };
    const chord = chords[level];
    if (!chord) return;
    this.ambientLevel = level;
    const playOnce = () => {
      if (!this.enabled || !this.ambientSynth) return;
      try { this.ambientSynth.triggerAttackRelease(chord, '2n'); } catch {}
    };
    playOnce();
    this.ambientInterval = setInterval(playOnce, 6500);
  },
  stopAmbient() {
    if (this.ambientInterval) { clearInterval(this.ambientInterval); this.ambientInterval = null; }
    this.ambientLevel = null;
    if (this.ambientSynth) { try { this.ambientSynth.releaseAll(); } catch {} }
  },
};

async function storageGet(key, fallback) {
  try { if (!window.storage) return fallback; const r = await window.storage.get(key); return r?.value !== undefined ? JSON.parse(r.value) : fallback; } catch { return fallback; }
}
async function storageSet(key, value) {
  try { if (!window.storage) return; await window.storage.set(key, JSON.stringify(value)); } catch {}
}

// ============================================================================
// SPEECH SYNTHESIS — read-aloud for early learners (free via Web Speech API)
// ============================================================================
const speech = {
  enabled: true,
  lang: 'en-US',
  cachedVoices: null,
  getVoice() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    if (!this.cachedVoices || this.cachedVoices.length === 0) {
      this.cachedVoices = window.speechSynthesis.getVoices();
    }
    if (!this.cachedVoices || this.cachedVoices.length === 0) return null;
    const prefix = this.lang.slice(0, 2).toLowerCase();
    return this.cachedVoices.find((v) => v.lang.toLowerCase().startsWith(prefix) && /female|child|kid|samantha|karen|monica|paulina|allison|google.*female/i.test(v.name))
        || this.cachedVoices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  },
  setLang(lang) { this.lang = lang; this.cachedVoices = null; },
  speak(text) {
    if (!this.enabled || !text) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.lang;
      const v = this.getVoice();
      if (v) u.voice = v;
      u.rate = 0.95;
      u.pitch = 1.1;
      window.speechSynthesis.speak(u);
    } catch {}
  },
  cancel() { try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch {} },
};
if (typeof window !== 'undefined' && window.speechSynthesis) {
  try { window.speechSynthesis.addEventListener('voiceschanged', () => { speech.cachedVoices = null; }); } catch {}
}

const NUM_WORDS_EN = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
const NUM_WORDS_ES = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez'];
function numToWord(n, lang) {
  const arr = (lang || '').startsWith('es') ? NUM_WORDS_ES : NUM_WORDS_EN;
  return arr[n] !== undefined ? arr[n] : String(n);
}
function buildEquationSpeech(config, lang) {
  const isEs = (lang || '').startsWith('es');
  const plus = isEs ? 'más' : 'plus';
  const equals = isEs ? 'es igual a' : 'equals';
  const nums = config.groups.map((g) => numToWord(g.count, lang));
  return `${nums.join(' ' + plus + ' ')} ${equals} ${numToWord(config.total, lang)}`;
}
function buildGreatJobSpeech(name, lang) {
  const isEs = (lang || '').startsWith('es');
  if (isEs) return name ? `¡Excelente trabajo, ${name}!` : '¡Excelente trabajo!';
  return name ? `Great job, ${name}!` : 'Great job!';
}

// Spoken narration that mirrors the text speech bubbles for non-readers
function buildIntroSpeech(level, lang) {
  const isEs = (lang || '').startsWith('es');
  const phrases = {
    2: isEs ? '¡Trae mangos para nosotros!' : 'Get mangoes for us!',
    3: isEs ? '¡Vamos de compras!' : "Let's go shopping!",
    4: isEs ? '¡Trae uvas para nosotros!' : 'Get grapes for us!',
    5: isEs ? '¡Recoge muchas frutas!' : 'Pick lots of fruits!',
    6: isEs ? '¡Muu! ¿Puedo comer una?' : 'Moo! Can I have some?',
  };
  return phrases[level] || '';
}

// Simple tap instruction spoken at the start of each level
function buildTapHintSpeech(level, lang) {
  const isEs = (lang || '').startsWith('es');
  const phrases = {
    1: isEs ? '¡Toca una fresa!' : 'Tap a strawberry!',
    2: isEs ? '¡Toca un mango!' : 'Tap a mango!',
    3: isEs ? '¡Toca una fruta!' : 'Tap a fruit!',
    4: isEs ? '¡Toca una uva!' : 'Tap a grape!',
    5: isEs ? '¡Toca una fruta!' : 'Tap a fruit!',
    6: isEs ? '¡Alimenta a la vaca!' : 'Feed the cow!',
  };
  return phrases[level] || '';
}

// Unique ID generator (avoids collision when multiple events fire in same ms)
let _idCounter = 0;
function uid() { return `id-${Date.now()}-${++_idCounter}`; }

// Haptic feedback for mobile (iOS supports navigator.vibrate, falls back gracefully)
function haptic(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

const LILI_COLOR_PRESETS = {
  purple: { accent: '#a855f7', accentLight: '#c084fc', accentDeep: '#7e22ce', hoof: '#581c87' },
  pink:   { accent: '#ec4899', accentLight: '#f9a8d4', accentDeep: '#9d174d', hoof: '#831843' },
  blue:   { accent: '#3b82f6', accentLight: '#93c5fd', accentDeep: '#1d4ed8', hoof: '#1e3a8a' },
  green:  { accent: '#22c55e', accentLight: '#86efac', accentDeep: '#15803d', hoof: '#14532d' },
  orange: { accent: '#f97316', accentLight: '#fdba74', accentDeep: '#c2410c', hoof: '#7c2d12' },
  rainbow:{ accent: '#ec4899', accentLight: '#fbbf24', accentDeep: '#a855f7', hoof: '#581c87' },
};

function Lili({ facing = 'right', happy = false, level = 1, colorPreset = null }) {
  // Color override: if preset is selected, use it; otherwise level default
  const presetColors = colorPreset && LILI_COLOR_PRESETS[colorPreset];
  const baseColors = level === 2
    ? { body:'#fbcfe8', bodyDeep:'#f472b6', bodyShade:'#fce7f3', accent:'#22c55e', accentLight:'#86efac', accentDeep:'#15803d', hoof:'#14532d' }
    : { body:'#fbcfe8', bodyDeep:'#f472b6', bodyShade:'#fce7f3', accent:'#a855f7', accentLight:'#c084fc', accentDeep:'#7e22ce', hoof:'#581c87' };
  const colors = presetColors ? { ...baseColors, ...presetColors } : baseColors;
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      <path d="M 18 48 Q 4 38 8 52 Q -2 58 10 62 Q 6 56 18 58" fill={colors.accent} stroke={colors.accentDeep} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M 8 52 Q 2 50 4 56" stroke={colors.accentLight} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <rect x="30" y="62" width="8" height="22" rx="3" fill={colors.bodyDeep} />
      <rect x="68" y="62" width="8" height="22" rx="3" fill={colors.bodyDeep} />
      <rect x="30" y="80" width="8" height="4" rx="1.5" fill={colors.hoof} />
      <rect x="68" y="80" width="8" height="4" rx="1.5" fill={colors.hoof} />
      <ellipse cx="52" cy="52" rx="32" ry="20" fill={colors.body} />
      <ellipse cx="52" cy="48" rx="28" ry="14" fill={colors.bodyShade} opacity="0.7" />
      <rect x="40" y="62" width="8" height="22" rx="3" fill={colors.body} />
      <rect x="58" y="62" width="8" height="22" rx="3" fill={colors.body} />
      <rect x="40" y="80" width="8" height="4" rx="1.5" fill={colors.accentDeep} />
      <rect x="58" y="80" width="8" height="4" rx="1.5" fill={colors.accentDeep} />
      <path d="M 76 48 Q 82 38 92 32 L 100 40 Q 92 48 84 52 Z" fill={colors.body} />
      <path d="M 78 35 Q 72 28 74 20 Q 80 24 82 28 Q 84 22 88 20 Q 88 28 92 32 Q 86 36 80 38 Z" fill={colors.accent} />
      <path d="M 80 26 Q 82 22 84 24" stroke={colors.accentLight} strokeWidth="1" fill="none" />
      <ellipse cx="98" cy="34" rx="13" ry="11" fill={colors.body} />
      <path d="M 92 24 L 95 14 L 100 22 Z" fill={colors.accent} />
      <path d="M 94 22 L 96 18 L 98 22 Z" fill={colors.body} opacity="0.6" />
      <path d="M 90 28 Q 94 18 99 24 Q 96 28 92 30 Z" fill={colors.accent} />
      <ellipse cx="107" cy="38" rx="6" ry="4.5" fill={colors.bodyDeep} opacity="0.6" />
      <circle cx="103" cy="37" r="2.2" fill="#fb7185" opacity="0.45" />
      <ellipse cx="100" cy="32" rx="2.2" ry={happy?1:2.6} fill="#2d1b4e" />
      {!happy && <circle cx="101" cy="31" r="0.9" fill="white" />}
      <path d="M 97 30 L 96 28" stroke="#2d1b4e" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M 98 29 L 97 27" stroke="#2d1b4e" strokeWidth="0.8" strokeLinecap="round" />
      <ellipse cx="109" cy="39" rx="0.9" ry="1.1" fill="#9d174d" />
      <path d={happy?'M 104 41 Q 108 45 111 41':'M 105 41 Q 108 43 110 41'} stroke="#9d174d" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <g transform="translate(88, 22)">
        <circle cx="0" cy="0" r="1.8" fill="#fde047" />
        <circle cx="-2" cy="-1" r="1.5" fill="#fef3c7" />
        <circle cx="2" cy="-1" r="1.5" fill="#fef3c7" />
        <circle cx="-1" cy="2" r="1.5" fill="#fef3c7" />
        <circle cx="1" cy="2" r="1.5" fill="#fef3c7" />
      </g>
    </svg>
  );
}

function Unicorn({ facing = 'left', level = 1 }) {
  const isLevel2 = level === 2;
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      {isLevel2 ? (
        <>
          <path d="M 18 50 Q 4 40 10 55" stroke="#ec4899" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 16 52 Q 2 48 8 60" stroke="#f9a8d4" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 18 54 Q 4 56 12 64" stroke="#ec4899" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 20 56 Q 8 60 16 66" stroke="#fbcfe8" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M 18 50 Q 4 40 10 55" stroke="#ef4444" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 16 52 Q 2 48 8 60" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 18 54 Q 4 56 12 64" stroke="#facc15" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 20 56 Q 8 60 16 66" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 22 58 Q 12 64 20 68" stroke="#3b82f6" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      )}
      <rect x="30" y="62" width="8" height="22" rx="3" fill="#f5f5f4" />
      <rect x="68" y="62" width="8" height="22" rx="3" fill="#f5f5f4" />
      <rect x="30" y="80" width="8" height="4" rx="1.5" fill={isLevel2?'#ec4899':'#a78bfa'} />
      <rect x="68" y="80" width="8" height="4" rx="1.5" fill={isLevel2?'#ec4899':'#a78bfa'} />
      <ellipse cx="52" cy="52" rx="32" ry="20" fill="#ffffff" />
      <ellipse cx="52" cy="48" rx="28" ry="14" fill="#fafafa" opacity="0.9" />
      <rect x="40" y="62" width="8" height="22" rx="3" fill="#ffffff" />
      <rect x="58" y="62" width="8" height="22" rx="3" fill="#ffffff" />
      <rect x="40" y="80" width="8" height="4" rx="1.5" fill={isLevel2?'#ec4899':'#a78bfa'} />
      <rect x="58" y="80" width="8" height="4" rx="1.5" fill={isLevel2?'#ec4899':'#a78bfa'} />
      <path d="M 76 48 Q 82 38 92 32 L 100 40 Q 92 48 84 52 Z" fill="#ffffff" />
      {isLevel2 ? (
        <>
          <path d="M 76 38 Q 70 34 73 28" stroke="#ec4899" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 79 36 Q 74 30 78 24" stroke="#f9a8d4" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 82 34 Q 80 26 84 22" stroke="#ec4899" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 86 32 Q 86 24 90 22" stroke="#fbcfe8" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 90 32 Q 92 26 96 26" stroke="#ec4899" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M 76 38 Q 70 34 73 28" stroke="#ef4444" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 79 36 Q 74 30 78 24" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 82 34 Q 80 26 84 22" stroke="#facc15" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 86 32 Q 86 24 90 22" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M 90 32 Q 92 26 96 26" stroke="#3b82f6" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      )}
      <ellipse cx="98" cy="34" rx="13" ry="11" fill="#ffffff" />
      <path d="M 92 24 L 95 14 L 100 22 Z" fill="#ffffff" stroke="#e9d5ff" strokeWidth="0.5" />
      <path d="M 94 22 L 96 18 L 98 22 Z" fill="#fce7f3" />
      <path d="M 96 22 L 99 6 L 102 22 Z" fill="#fbbf24" />
      <path d="M 97 18 L 101 18" stroke="#f59e0b" strokeWidth="0.8" />
      <path d="M 97.5 14 L 100.5 14" stroke="#f59e0b" strokeWidth="0.8" />
      <path d="M 98 10 L 100 10" stroke="#f59e0b" strokeWidth="0.8" />
      <circle cx="103" cy="8" r="1.2" fill="#fef3c7" />
      <circle cx="105" cy="11" r="0.7" fill="#fef3c7" />
      <path d="M 92 28 Q 95 20 100 26" stroke="#ec4899" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M 93 30 Q 97 24 101 28" stroke={isLevel2?'#fbcfe8':'#a855f7'} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="107" cy="38" rx="6" ry="4.5" fill="#fce7f3" />
      <circle cx="103" cy="37" r="2.2" fill="#fb7185" opacity="0.4" />
      <ellipse cx="100" cy="32" rx="2.2" ry="2.6" fill="#2d1b4e" />
      <circle cx="101" cy="31" r="0.9" fill="white" />
      <path d="M 97 30 L 96 28" stroke="#2d1b4e" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M 98 29 L 97 26" stroke="#2d1b4e" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M 100 29 L 100 26" stroke="#2d1b4e" strokeWidth="0.8" strokeLinecap="round" />
      <ellipse cx="109" cy="39" rx="0.9" ry="1.1" fill="#9d174d" />
      <path d="M 105 41 Q 108 43 110 41" stroke="#9d174d" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Dog({ facing = 'right' }) {
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      <path d="M 20 48 Q 8 44 10 32 Q 16 26 22 32 Q 20 38 24 42" fill="#d97706" stroke="#92400e" strokeWidth="1" strokeLinejoin="round" />
      <rect x="30" y="62" width="8" height="22" rx="3" fill="#d97706" />
      <rect x="68" y="62" width="8" height="22" rx="3" fill="#d97706" />
      <rect x="30" y="80" width="8" height="4" rx="1.5" fill="#7c2d12" />
      <rect x="68" y="80" width="8" height="4" rx="1.5" fill="#7c2d12" />
      <ellipse cx="52" cy="52" rx="32" ry="20" fill="#fbbf24" />
      <ellipse cx="52" cy="48" rx="28" ry="14" fill="#fde68a" opacity="0.7" />
      <ellipse cx="42" cy="44" rx="5" ry="3" fill="#d97706" opacity="0.5" />
      <ellipse cx="62" cy="46" rx="4" ry="3" fill="#d97706" opacity="0.5" />
      <rect x="40" y="62" width="8" height="22" rx="3" fill="#fbbf24" />
      <rect x="58" y="62" width="8" height="22" rx="3" fill="#fbbf24" />
      <rect x="40" y="80" width="8" height="4" rx="1.5" fill="#7c2d12" />
      <rect x="58" y="80" width="8" height="4" rx="1.5" fill="#7c2d12" />
      <path d="M 76 48 Q 82 38 92 32 L 100 40 Q 92 48 84 52 Z" fill="#fbbf24" />
      <ellipse cx="98" cy="34" rx="14" ry="12" fill="#fbbf24" />
      <ellipse cx="89" cy="38" rx="5" ry="11" fill="#d97706" stroke="#92400e" strokeWidth="0.5" transform="rotate(-15 89 38)" />
      <ellipse cx="100" cy="28" rx="5" ry="3" fill="#d97706" opacity="0.5" />
      <ellipse cx="108" cy="40" rx="7" ry="5" fill="#fde68a" />
      <ellipse cx="113" cy="38" rx="2.2" ry="1.8" fill="#1e293b" />
      <circle cx="112.5" cy="37.5" r="0.7" fill="white" />
      <circle cx="100" cy="32" r="2.5" fill="#1e293b" />
      <circle cx="101" cy="31" r="1" fill="white" />
      <path d="M 96 28 Q 99 27 102 28" stroke="#92400e" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M 108 43 Q 112 47 116 42" stroke="#9d174d" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <ellipse cx="111" cy="46" rx="2.2" ry="2.8" fill="#fb7185" />
      <ellipse cx="111" cy="46" rx="0.5" ry="2" fill="#be123c" />
      <circle cx="103" cy="38" r="2" fill="#fb7185" opacity="0.3" />
    </svg>
  );
}

function Cat({ facing = 'right' }) {
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      <path d="M 18 50 Q 4 36 4 18" stroke="#fb923c" strokeWidth="6.5" fill="none" strokeLinecap="round" />
      <path d="M 4 18 Q 4 14 6 12" stroke="#ea580c" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="32" y="62" width="7" height="22" rx="3" fill="#fb923c" />
      <rect x="66" y="62" width="7" height="22" rx="3" fill="#fb923c" />
      <ellipse cx="35.5" cy="83" rx="5" ry="2" fill="#ea580c" />
      <ellipse cx="69.5" cy="83" rx="5" ry="2" fill="#ea580c" />
      <ellipse cx="52" cy="54" rx="30" ry="18" fill="#fb923c" />
      <ellipse cx="52" cy="50" rx="26" ry="13" fill="#fed7aa" opacity="0.7" />
      <path d="M 38 46 Q 40 44 42 46" stroke="#ea580c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 50 42 Q 52 40 54 42" stroke="#ea580c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 62 46 Q 64 44 66 46" stroke="#ea580c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 70 50 Q 72 48 74 50" stroke="#ea580c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="40" y="62" width="7" height="22" rx="3" fill="#fb923c" />
      <rect x="58" y="62" width="7" height="22" rx="3" fill="#fb923c" />
      <ellipse cx="43.5" cy="83" rx="5" ry="2" fill="#ea580c" />
      <ellipse cx="61.5" cy="83" rx="5" ry="2" fill="#ea580c" />
      <path d="M 76 50 Q 82 40 92 34 L 100 42 Q 92 50 84 54 Z" fill="#fb923c" />
      <ellipse cx="98" cy="36" rx="13" ry="11" fill="#fb923c" />
      <path d="M 88 28 L 92 14 L 96 26 Z" fill="#fb923c" />
      <path d="M 100 26 L 104 12 L 108 24 Z" fill="#fb923c" />
      <path d="M 90 26 L 92 18 L 95 25 Z" fill="#fce7f3" />
      <path d="M 102 24 L 104 17 L 107 23 Z" fill="#fce7f3" />
      <path d="M 105 38 L 116 36" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 105 40 L 116 41" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 91 38 L 80 36" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 91 40 L 80 41" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <ellipse cx="93" cy="34" rx="2.2" ry="3" fill="#22c55e" />
      <ellipse cx="103" cy="34" rx="2.2" ry="3" fill="#22c55e" />
      <ellipse cx="93" cy="34" rx="0.7" ry="2.5" fill="#1e293b" />
      <ellipse cx="103" cy="34" rx="0.7" ry="2.5" fill="#1e293b" />
      <circle cx="93.5" cy="33" r="0.5" fill="white" />
      <circle cx="103.5" cy="33" r="0.5" fill="white" />
      <path d="M 96 39 L 100 39 L 98 41.5 Z" fill="#fb7185" />
      <path d="M 98 41.5 L 96 43 M 98 41.5 L 100 43" stroke="#9d174d" strokeWidth="1" fill="none" strokeLinecap="round" />
      <circle cx="89" cy="38" r="1.6" fill="#fb7185" opacity="0.4" />
      <circle cx="107" cy="38" r="1.6" fill="#fb7185" opacity="0.4" />
    </svg>
  );
}

function Cow({ facing = 'right' }) {
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      {/* Tail with tuft */}
      <path d="M 18 50 Q 4 44 8 30" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="6" cy="28" rx="3" ry="4" fill="#1e293b" />
      {/* Back legs */}
      <rect x="30" y="62" width="8" height="22" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" />
      <rect x="68" y="62" width="8" height="22" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" />
      <rect x="30" y="80" width="8" height="4" rx="1.5" fill="#1e293b" />
      <rect x="68" y="80" width="8" height="4" rx="1.5" fill="#1e293b" />
      {/* Body — white with black spots */}
      <ellipse cx="52" cy="52" rx="32" ry="20" fill="#ffffff" />
      <ellipse cx="52" cy="48" rx="28" ry="14" fill="#fafafa" opacity="0.9" />
      {/* Spots — random blob shapes */}
      <path d="M 38 44 Q 34 42 32 46 Q 32 50 36 50 Q 40 48 38 44 Z" fill="#1e293b" />
      <path d="M 56 42 Q 52 40 50 44 Q 50 48 54 47 Q 58 46 56 42 Z" fill="#1e293b" />
      <path d="M 68 50 Q 64 48 62 52 Q 62 56 66 56 Q 70 54 68 50 Z" fill="#1e293b" />
      <path d="M 44 56 Q 40 54 38 58 Q 38 62 42 62 Q 46 60 44 56 Z" fill="#1e293b" />
      {/* Front legs */}
      <rect x="40" y="62" width="8" height="22" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" />
      <rect x="58" y="62" width="8" height="22" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" />
      <rect x="40" y="80" width="8" height="4" rx="1.5" fill="#1e293b" />
      <rect x="58" y="80" width="8" height="4" rx="1.5" fill="#1e293b" />
      {/* Pink udder hint (small, cute) */}
      <ellipse cx="52" cy="68" rx="4" ry="2.5" fill="#fb7185" opacity="0.6" />
      {/* Neck */}
      <path d="M 76 48 Q 82 38 92 32 L 100 40 Q 92 48 84 52 Z" fill="#ffffff" />
      {/* Head */}
      <ellipse cx="98" cy="34" rx="14" ry="11" fill="#ffffff" />
      {/* Black spot on head */}
      <path d="M 92 28 Q 88 26 86 30 Q 86 34 90 34 Q 94 32 92 28 Z" fill="#1e293b" />
      {/* Snout — pink, prominent (signature cow look) */}
      <ellipse cx="108" cy="40" rx="9" ry="7" fill="#fda4af" stroke="#fb7185" strokeWidth="0.5" />
      <ellipse cx="108" cy="38" rx="7" ry="5" fill="#fecdd3" />
      {/* Nostrils */}
      <ellipse cx="105" cy="40" rx="0.8" ry="1.4" fill="#9d174d" />
      <ellipse cx="111" cy="40" rx="0.8" ry="1.4" fill="#9d174d" />
      {/* Mouth */}
      <path d="M 104 45 Q 108 47 112 45" stroke="#9d174d" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* Ears — sticking out sides */}
      <ellipse cx="86" cy="30" rx="5" ry="3.5" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" transform="rotate(-30 86 30)" />
      <ellipse cx="86" cy="30" rx="3" ry="2" fill="#fda4af" transform="rotate(-30 86 30)" />
      <ellipse cx="110" cy="28" rx="5" ry="3.5" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.5" transform="rotate(30 110 28)" />
      <ellipse cx="110" cy="28" rx="3" ry="2" fill="#fda4af" transform="rotate(30 110 28)" />
      {/* Horns — small, white/cream */}
      <path d="M 92 22 Q 90 17 91 15 Q 93 18 94 22" fill="#fef3c7" stroke="#a16207" strokeWidth="0.5" />
      <path d="M 104 22 Q 106 17 105 15 Q 103 18 102 22" fill="#fef3c7" stroke="#a16207" strokeWidth="0.5" />
      {/* Eyes — big and friendly */}
      <ellipse cx="96" cy="32" rx="2.2" ry="2.6" fill="#1e293b" />
      <ellipse cx="104" cy="32" rx="2.2" ry="2.6" fill="#1e293b" />
      <circle cx="96.5" cy="31" r="0.9" fill="white" />
      <circle cx="104.5" cy="31" r="0.9" fill="white" />
      {/* Long lashes for sweetness */}
      <path d="M 94 30 L 93 28" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 95 29 L 94.5 27" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 102 29 L 102.5 27" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 104 30 L 105 28" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      {/* Cheek blush */}
      <circle cx="93" cy="38" r="1.8" fill="#fb7185" opacity="0.4" />
    </svg>
  );
}

function Catalino({ facing = 'right' }) {
  return (
    <svg viewBox="0 0 130 100" style={{ transform: facing==='left'?'scaleX(-1)':'none', overflow:'visible', width:'100%', height:'100%' }}>
      {/* Rainbow tail — multi-stroke arch */}
      <path d="M 18 50 Q 2 36 2 16" stroke="#ef4444" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M 20 51 Q 6 38 6 18" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 22 52 Q 10 40 10 20" stroke="#fde047" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 24 53 Q 14 42 14 22" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 26 54 Q 18 44 18 24" stroke="#3b82f6" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 28 55 Q 22 46 22 26" stroke="#a855f7" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Back legs */}
      <rect x="32" y="62" width="7" height="22" rx="3" fill="#ffffff" stroke="#e9d5ff" strokeWidth="0.5" />
      <rect x="66" y="62" width="7" height="22" rx="3" fill="#ffffff" stroke="#e9d5ff" strokeWidth="0.5" />
      <ellipse cx="35.5" cy="83" rx="5" ry="2" fill="#fce7f3" />
      <ellipse cx="69.5" cy="83" rx="5" ry="2" fill="#fce7f3" />
      {/* Body — white with rainbow stripes */}
      <ellipse cx="52" cy="54" rx="30" ry="18" fill="#ffffff" />
      <ellipse cx="52" cy="50" rx="26" ry="13" fill="#fafafa" opacity="0.9" />
      <path d="M 36 46 Q 40 42 44 46" stroke="#ef4444" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 46 44 Q 50 40 54 44" stroke="#fde047" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 56 46 Q 60 42 64 46" stroke="#22c55e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 66 48 Q 70 44 74 48" stroke="#3b82f6" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* Front legs */}
      <rect x="40" y="62" width="7" height="22" rx="3" fill="#ffffff" stroke="#e9d5ff" strokeWidth="0.5" />
      <rect x="58" y="62" width="7" height="22" rx="3" fill="#ffffff" stroke="#e9d5ff" strokeWidth="0.5" />
      <ellipse cx="43.5" cy="83" rx="5" ry="2" fill="#fce7f3" />
      <ellipse cx="61.5" cy="83" rx="5" ry="2" fill="#fce7f3" />
      {/* Neck */}
      <path d="M 76 50 Q 82 40 92 34 L 100 42 Q 92 50 84 54 Z" fill="#ffffff" />
      {/* Head */}
      <ellipse cx="98" cy="36" rx="13" ry="11" fill="#ffffff" />
      {/* Pointy ears with rainbow tips */}
      <path d="M 88 28 L 92 14 L 96 26 Z" fill="#ffffff" />
      <path d="M 100 26 L 104 12 L 108 24 Z" fill="#ffffff" />
      <path d="M 90 26 L 92 18 L 95 25 Z" fill="#ec4899" />
      <path d="M 102 24 L 104 17 L 107 23 Z" fill="#a855f7" />
      {/* Sparkles */}
      <circle cx="86" cy="20" r="1.4" fill="#fde047">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="112" cy="22" r="1.2" fill="#fde047">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="118" cy="40" r="1" fill="#ec4899">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="1.8s" repeatCount="indefinite" />
      </circle>
      {/* Whiskers */}
      <path d="M 105 38 L 116 36" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 105 40 L 116 41" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 91 38 L 80 36" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M 91 40 L 80 41" stroke="#1e293b" strokeWidth="0.7" strokeLinecap="round" />
      {/* Eyes — sparkly purple */}
      <ellipse cx="93" cy="34" rx="2.2" ry="3" fill="#a855f7" />
      <ellipse cx="103" cy="34" rx="2.2" ry="3" fill="#a855f7" />
      <ellipse cx="93" cy="34" rx="0.7" ry="2.5" fill="#1e293b" />
      <ellipse cx="103" cy="34" rx="0.7" ry="2.5" fill="#1e293b" />
      <circle cx="93.5" cy="33" r="0.5" fill="white" />
      <circle cx="103.5" cy="33" r="0.5" fill="white" />
      {/* Pink nose */}
      <path d="M 96 39 L 100 39 L 98 41.5 Z" fill="#fb7185" />
      {/* Smile */}
      <path d="M 98 41.5 L 96 43 M 98 41.5 L 100 43" stroke="#9d174d" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* Cheek blush — rainbow vibe */}
      <circle cx="89" cy="38" r="1.6" fill="#fb7185" opacity="0.4" />
      <circle cx="107" cy="38" r="1.6" fill="#fb7185" opacity="0.4" />
    </svg>
  );
}

const NPC_COMPONENTS = { unicorn: Unicorn, dog: Dog, cat: Cat, catalino: Catalino, cow: Cow };

function Strawberry() {
  return (
    <svg viewBox="0 0 40 50" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <path d="M 20 8 L 12 4 L 14 12 Z" fill="#16a34a" />
      <path d="M 20 8 L 28 4 L 26 12 Z" fill="#16a34a" />
      <path d="M 20 6 L 16 0 L 22 4 Z" fill="#22c55e" />
      <path d="M 20 6 L 24 0 L 18 4 Z" fill="#22c55e" />
      <path d="M 20 12 Q 6 14 8 28 Q 10 44 20 46 Q 30 44 32 28 Q 34 14 20 12 Z" fill="#ef4444" />
      <path d="M 20 14 Q 10 16 12 24" stroke="#fca5a5" strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx="14" cy="22" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(-20 14 22)" />
      <ellipse cx="20" cy="20" rx="0.9" ry="1.5" fill="#fef3c7" />
      <ellipse cx="26" cy="22" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(20 26 22)" />
      <ellipse cx="12" cy="30" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(-15 12 30)" />
      <ellipse cx="18" cy="30" rx="0.9" ry="1.5" fill="#fef3c7" />
      <ellipse cx="24" cy="30" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(15 24 30)" />
      <ellipse cx="30" cy="30" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(20 30 30)" />
      <ellipse cx="16" cy="38" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(-10 16 38)" />
      <ellipse cx="22" cy="38" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(10 22 38)" />
      <ellipse cx="28" cy="38" rx="0.9" ry="1.5" fill="#fef3c7" transform="rotate(20 28 38)" />
    </svg>
  );
}

function Mango() {
  return (
    <svg viewBox="0 0 40 50" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <defs>
        <linearGradient id="mangoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" /><stop offset="50%" stopColor="#fb923c" /><stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <rect x="19" y="8" width="2.5" height="5" rx="1" fill="#65a30d" />
      <path d="M 21 10 Q 32 6 33 14 Q 26 17 21 12 Z" fill="#22c55e" />
      <path d="M 22 11 Q 28 10 30 14" stroke="#16a34a" strokeWidth="0.6" fill="none" />
      <ellipse cx="20" cy="30" rx="14" ry="17" fill="url(#mangoGrad)" />
      <ellipse cx="14" cy="24" rx="3" ry="5" fill="#fef9c3" opacity="0.6" />
      <ellipse cx="13" cy="23" rx="1.5" ry="2.5" fill="#ffffff" opacity="0.7" />
      <ellipse cx="27" cy="35" rx="3" ry="4" fill="#dc2626" opacity="0.3" />
    </svg>
  );
}

function Banana() {
  return (
    <svg viewBox="0 0 50 50" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <defs>
        <linearGradient id="bananaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" /><stop offset="60%" stopColor="#fde047" /><stop offset="100%" stopColor="#facc15" />
        </linearGradient>
      </defs>
      <path d="M 12 12 Q 6 28 14 42 L 22 44 Q 36 32 40 12 L 32 9 Q 22 14 12 12 Z" fill="url(#bananaGrad)" stroke="#a16207" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M 33 9 L 36 4 L 39 9 Z" fill="#65a30d" />
      <rect x="34" y="6" width="4" height="5" rx="1" fill="#65a30d" />
      <path d="M 14 40 Q 16 44 22 44" stroke="#a16207" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 18 16 Q 14 28 20 38" stroke="#fef3c7" strokeWidth="1.2" fill="none" opacity="0.7" />
      <path d="M 28 14 Q 26 26 30 38" stroke="#a16207" strokeWidth="0.5" fill="none" opacity="0.5" />
    </svg>
  );
}

function Grapes() {
  return (
    <svg viewBox="0 0 40 50" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="19" y="4" width="2" height="6" fill="#65a30d" />
      <path d="M 21 8 Q 32 4 33 12 Q 26 14 21 10 Z" fill="#22c55e" />
      <path d="M 22 9 Q 28 8 30 11" stroke="#16a34a" strokeWidth="0.5" fill="none" />
      <circle cx="20" cy="15" r="4" fill="#7e22ce" />
      <circle cx="14" cy="20" r="4" fill="#9333ea" />
      <circle cx="20" cy="20" r="4" fill="#a855f7" />
      <circle cx="26" cy="20" r="4" fill="#7e22ce" />
      <circle cx="11" cy="26" r="4" fill="#a855f7" />
      <circle cx="17" cy="27" r="4" fill="#7e22ce" />
      <circle cx="23" cy="27" r="4" fill="#9333ea" />
      <circle cx="29" cy="26" r="4" fill="#a855f7" />
      <circle cx="14" cy="33" r="4" fill="#7e22ce" />
      <circle cx="20" cy="34" r="4" fill="#9333ea" />
      <circle cx="26" cy="33" r="4" fill="#a855f7" />
      <circle cx="20" cy="40" r="4" fill="#7e22ce" />
      <circle cx="19" cy="13" r="1.2" fill="#e9d5ff" />
      <circle cx="13" cy="18" r="1" fill="#e9d5ff" />
      <circle cx="19" cy="18" r="1" fill="#e9d5ff" />
      <circle cx="16" cy="25" r="0.9" fill="#e9d5ff" />
      <circle cx="22" cy="25" r="0.9" fill="#e9d5ff" />
    </svg>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 40 40" style={{ width:'100%', height:'100%' }}>
      <path d="M 20 4 L 22 18 L 36 20 L 22 22 L 20 36 L 18 22 L 4 20 L 18 18 Z" fill="#fde047" />
      <path d="M 20 8 L 21 19 L 32 20 L 21 21 L 20 32 L 19 21 L 8 20 L 19 19 Z" fill="#fef08a" />
      <circle cx="20" cy="20" r="3" fill="white" />
    </svg>
  );
}

const ITEM_COMPONENTS = { strawberry: Strawberry, mango: Mango, banana: Banana, grapes: Grapes };

function ShoppingCart({ items = [] }) {
  const bananas = items.filter((i) => i.type === 'banana').length;
  const strawberries = items.filter((i) => i.type === 'strawberry').length;
  const grapes = items.filter((i) => i.type === 'grapes').length;
  return (
    <svg viewBox="0 0 80 70" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <path d="M 6 12 L 6 36" stroke="#475569" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M 6 12 L 14 12" stroke="#475569" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M 8 18 L 70 18 L 64 45 L 16 45 Z" fill="rgba(241, 245, 249, 0.4)" stroke="#475569" strokeWidth="2.5" strokeLinejoin="round" />
      <line x1="22" y1="20" x2="23" y2="44" stroke="#64748b" strokeWidth="1" />
      <line x1="34" y1="20" x2="34" y2="44" stroke="#64748b" strokeWidth="1" />
      <line x1="46" y1="20" x2="45" y2="44" stroke="#64748b" strokeWidth="1" />
      <line x1="58" y1="20" x2="56" y2="44" stroke="#64748b" strokeWidth="1" />
      {/* Bananas — bigger and more curved for visibility */}
      {Array.from({ length: Math.min(bananas, 4) }).map((_, i) => {
        const x = 18 + (i % 2) * 11; const y = 26 + Math.floor(i / 2) * 9;
        return (
          <g key={`b${i}`} transform={`translate(${x}, ${y}) rotate(-22)`} style={{ filter:'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}>
            <ellipse cx="0" cy="0" rx="9" ry="3.6" fill="#fde047" stroke="#a16207" strokeWidth="0.7" />
            <ellipse cx="-2" cy="-1" rx="6" ry="1.6" fill="#fef08a" opacity="0.9" />
            <circle cx="-8" cy="0" r="0.8" fill="#a16207" />
            <circle cx="8" cy="0" r="0.8" fill="#a16207" />
          </g>
        );
      })}
      {/* Strawberries — bigger, with leaves and seeds */}
      {Array.from({ length: Math.min(strawberries, 4) }).map((_, i) => {
        const x = 44 + (i % 2) * 10; const y = 28 + Math.floor(i / 2) * 9;
        return (
          <g key={`s${i}`} transform={`translate(${x}, ${y})`} style={{ filter:'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}>
            <path d="M -4.5 -1 Q -5.5 6 0 7 Q 5.5 6 4.5 -1 Q 0 -2.5 -4.5 -1 Z" fill="#ef4444" />
            <path d="M -3 0 Q -3.5 4 0 5" stroke="#dc2626" strokeWidth="0.4" fill="none" opacity="0.6" />
            <path d="M -2 -3 L -4 -5.5 L 0 -5 L 4 -5.5 L 2 -3 Z" fill="#22c55e" />
            <circle cx="-1.5" cy="2" r="0.5" fill="#fde047" />
            <circle cx="1.5" cy="3" r="0.5" fill="#fde047" />
            <circle cx="0" cy="0.5" r="0.5" fill="#fde047" />
          </g>
        );
      })}
      {/* Grapes — bigger clusters */}
      {Array.from({ length: Math.min(grapes, 10) }).map((_, i) => {
        const x = 14 + (i % 5) * 11.5; const y = 26 + Math.floor(i / 5) * 9.5;
        return (
          <g key={`g${i}`} transform={`translate(${x}, ${y})`} style={{ filter:'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}>
            <circle cx="0" cy="0" r="3" fill="#7e22ce" />
            <circle cx="3.5" cy="2.5" r="2.7" fill="#a855f7" />
            <circle cx="-2.5" cy="2.5" r="2.7" fill="#9333ea" />
            <circle cx="-1" cy="-1" r="0.9" fill="white" opacity="0.6" />
          </g>
        );
      })}
      <line x1="20" y1="46" x2="22" y2="52" stroke="#475569" strokeWidth="2" />
      <line x1="60" y1="46" x2="58" y2="52" stroke="#475569" strokeWidth="2" />
      <circle cx="22" cy="56" r="6" fill="#1e293b" />
      <circle cx="22" cy="56" r="2.5" fill="#94a3b8" />
      <circle cx="58" cy="56" r="6" fill="#1e293b" />
      <circle cx="58" cy="56" r="2.5" fill="#94a3b8" />
    </svg>
  );
}

function Cloud({ x, y, size = 1, opacity = 1 }) {
  return (
    <div style={{ position:'absolute', left:`${x}%`, top:`${y}%`, width:`${size*14}%`, opacity, filter:'drop-shadow(0 4px 6px rgba(124, 58, 237, 0.08))' }}>
      <svg viewBox="0 0 100 50" style={{ width:'100%' }}>
        <ellipse cx="25" cy="32" rx="22" ry="16" fill="white" />
        <ellipse cx="50" cy="25" rx="28" ry="20" fill="white" />
        <ellipse cx="75" cy="32" rx="22" ry="16" fill="white" />
        <ellipse cx="40" cy="35" rx="20" ry="13" fill="white" />
        <ellipse cx="60" cy="35" rx="20" ry="13" fill="white" />
      </svg>
    </div>
  );
}

function Flower({ color = '#f472b6' }) {
  return (
    <svg viewBox="0 0 30 30" style={{ width:'100%', height:'100%' }}>
      <circle cx="15" cy="9" r="5" fill={color} />
      <circle cx="9" cy="15" r="5" fill={color} />
      <circle cx="21" cy="15" r="5" fill={color} />
      <circle cx="15" cy="21" r="5" fill={color} />
      <circle cx="15" cy="15" r="3.5" fill="#fde047" />
    </svg>
  );
}

function Fence() {
  return (
    <svg viewBox="0 0 400 60" preserveAspectRatio="none" style={{ width:'100%', height:'100%' }}>
      <rect x="0" y="30" width="400" height="6" fill="#fef3c7" stroke="#fbbf24" strokeWidth="1" />
      <rect x="0" y="44" width="400" height="6" fill="#fef3c7" stroke="#fbbf24" strokeWidth="1" />
      {Array.from({ length: 14 }).map((_, i) => (
        <g key={i}>
          <rect x={i*30+4} y="20" width="8" height="40" fill="#fef9c3" stroke="#fbbf24" strokeWidth="1" rx="1" />
          <path d={`M ${i*30+4} 20 L ${i*30+8} 14 L ${i*30+12} 20 Z`} fill="#fde68a" stroke="#fbbf24" strokeWidth="1" />
        </g>
      ))}
    </svg>
  );
}

function ZooSign() {
  return (
    <svg viewBox="0 0 100 60" style={{ width:'100%', height:'100%' }}>
      <rect x="44" y="35" width="3" height="25" fill="#92400e" />
      <rect x="53" y="35" width="3" height="25" fill="#92400e" />
      <rect x="20" y="10" width="60" height="32" rx="4" fill="#fef3c7" stroke="#92400e" strokeWidth="2" />
      <text x="50" y="32" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="20" fill="#9d174d">ZOO</text>
      <path d="M 26 18 Q 24 16 22 18 Q 22 21 26 23 Q 30 21 30 18 Q 28 16 26 18 Z" fill="#ec4899" />
      <path d="M 74 18 Q 72 16 70 18 Q 70 21 74 23 Q 78 21 78 18 Q 76 16 74 18 Z" fill="#ec4899" />
    </svg>
  );
}

function Star({ x, y, size = 1 }) {
  return (
    <div style={{ position:'absolute', left:`${x}%`, top:`${y}%`, width:`${size*1.4}%`, height:`${size*2.4}%`, animation:`twinkle ${2+(x%3)}s ease-in-out infinite ${(y%5)*0.3}s` }}>
      <svg viewBox="0 0 20 20" style={{ width:'100%', height:'100%' }}>
        <path d="M 10 2 L 12 8 L 18 10 L 12 12 L 10 18 L 8 12 L 2 10 L 8 8 Z" fill="#fef9c3" />
      </svg>
    </div>
  );
}

function CrescentMoon() {
  return (
    <svg viewBox="0 0 60 60" style={{ width:'100%', height:'100%' }}>
      <circle cx="30" cy="30" r="22" fill="#fef9c3" />
      <circle cx="38" cy="26" r="20" fill="#3730a3" />
      <circle cx="18" cy="22" r="1.5" fill="#fde68a" />
      <circle cx="22" cy="36" r="1" fill="#fde68a" />
    </svg>
  );
}

function MushroomHouse({ capColor = '#ef4444', spotColor = '#fef3c7' }) {
  return (
    <svg viewBox="0 0 100 130" style={{ width:'100%', height:'100%' }}>
      <path d="M 28 65 Q 26 110 32 122 L 68 122 Q 74 110 72 65 Z" fill="#fef3c7" stroke="#fbbf24" strokeWidth="2" />
      <path d="M 42 95 Q 42 80 50 80 Q 58 80 58 95 L 58 122 L 42 122 Z" fill="#92400e" />
      <path d="M 50 80 L 50 122" stroke="#7c2d12" strokeWidth="1" />
      <circle cx="55" cy="103" r="1.5" fill="#fbbf24" />
      <circle cx="38" cy="82" r="5" fill="#fef9c3" stroke="#fbbf24" strokeWidth="1.5" />
      <path d="M 33 82 L 43 82 M 38 77 L 38 87" stroke="#fbbf24" strokeWidth="1" />
      <ellipse cx="50" cy="55" rx="45" ry="30" fill={capColor} />
      <ellipse cx="50" cy="48" rx="40" ry="22" fill={capColor} />
      <ellipse cx="35" cy="40" rx="12" ry="6" fill="white" opacity="0.3" />
      <circle cx="30" cy="50" r="4.5" fill={spotColor} />
      <circle cx="55" cy="42" r="3.5" fill={spotColor} />
      <circle cx="68" cy="55" r="4" fill={spotColor} />
      <circle cx="42" cy="62" r="3" fill={spotColor} />
      <circle cx="20" cy="60" r="3" fill={spotColor} />
    </svg>
  );
}

function MagicFountain() {
  return (
    <svg viewBox="0 0 120 120" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <ellipse cx="60" cy="110" rx="50" ry="6" fill="#000" opacity="0.15" />
      <path d="M 12 100 Q 12 75 25 70 L 95 70 Q 108 75 108 100 Q 60 115 12 100 Z" fill="#cbd5e1" />
      <ellipse cx="60" cy="72" rx="42" ry="6" fill="#94a3b8" />
      <ellipse cx="60" cy="72" rx="38" ry="4" fill="#7dd3fc" />
      <rect x="55" y="55" width="10" height="22" fill="#cbd5e1" />
      <ellipse cx="60" cy="55" rx="20" ry="6" fill="#94a3b8" />
      <ellipse cx="60" cy="55" rx="17" ry="4" fill="#7dd3fc" />
      <path d="M 60 55 Q 56 35 60 25 Q 64 35 60 55" fill="#7dd3fc" opacity="0.7" />
      <path d="M 60 30 Q 58 22 60 18 Q 62 22 60 30" fill="#bae6fd" />
      <circle cx="50" cy="40" r="2" fill="#7dd3fc" />
      <circle cx="70" cy="42" r="2" fill="#7dd3fc" />
      <circle cx="60" cy="20" r="2" fill="#fde047" />
    </svg>
  );
}

function SparkleTree() {
  return (
    <svg viewBox="0 0 80 120" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <path d="M 36 70 L 32 115 L 48 115 L 44 70 Z" fill="#92400e" />
      <path d="M 38 80 L 36 110" stroke="#7c2d12" strokeWidth="1" />
      <circle cx="40" cy="40" r="22" fill="#a855f7" />
      <circle cx="22" cy="50" r="18" fill="#c084fc" />
      <circle cx="58" cy="50" r="18" fill="#c084fc" />
      <circle cx="40" cy="60" r="20" fill="#a855f7" />
      <path d="M 40 30 L 41 34 L 45 35 L 41 36 L 40 40 L 39 36 L 35 35 L 39 34 Z" fill="#fde047" />
    </svg>
  );
}

function MagicChest({ open }) {
  return (
    <svg viewBox="0 0 80 70" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="10" y="35" width="60" height="30" rx="4" fill="#92400e" stroke="#7c2d12" strokeWidth="2" />
      <rect x="10" y="38" width="60" height="4" fill="#fbbf24" />
      <rect x="10" y="55" width="60" height="4" fill="#fbbf24" />
      <rect x="36" y="44" width="8" height="8" rx="1" fill="#fde047" stroke="#a16207" strokeWidth="1" />
      <circle cx="40" cy="48" r="1.5" fill="#a16207" />
      <g style={{ transformOrigin:'10px 35px', transform: open?'rotate(-50deg)':'rotate(0deg)', transition:'transform 0.5s ease-out' }}>
        <path d="M 10 35 Q 10 20 40 20 Q 70 20 70 35 Z" fill="#92400e" stroke="#7c2d12" strokeWidth="2" />
        <path d="M 10 35 Q 10 22 40 22 Q 70 22 70 35" stroke="#fbbf24" strokeWidth="2" fill="none" />
      </g>
      {!open && (
        <g>
          <circle cx="6" cy="30" r="1.5" fill="#fde047"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" /></circle>
          <circle cx="74" cy="32" r="1.2" fill="#fde047"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" /></circle>
          <circle cx="40" cy="14" r="1.4" fill="#fde047"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.8s" repeatCount="indefinite" /></circle>
        </g>
      )}
    </svg>
  );
}

function MagicGiantFlower({ open }) {
  return (
    <svg viewBox="0 0 80 90" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="38" y="50" width="4" height="40" fill="#16a34a" />
      <path d="M 30 70 Q 22 64 26 76" fill="#22c55e" />
      <path d="M 50 75 Q 58 70 56 82" fill="#22c55e" />
      <g style={{ transformOrigin:'40px 35px', transform: open?'scale(1.15)':'scale(1)', transition:'transform 0.5s ease-out' }}>
        <ellipse cx="40" cy="14" rx="9" ry="14" fill="#ec4899" />
        <ellipse cx="20" cy="28" rx="9" ry="14" fill="#f472b6" transform="rotate(-60 20 28)" />
        <ellipse cx="60" cy="28" rx="9" ry="14" fill="#f472b6" transform="rotate(60 60 28)" />
        <ellipse cx="22" cy="48" rx="9" ry="14" fill="#ec4899" transform="rotate(-120 22 48)" />
        <ellipse cx="58" cy="48" rx="9" ry="14" fill="#ec4899" transform="rotate(120 58 48)" />
        <circle cx="40" cy="35" r={open?11:10} fill="#fde047" stroke="#facc15" strokeWidth="1.5" />
        <circle cx="40" cy="35" r={open?7:6} fill="#fef9c3" />
      </g>
    </svg>
  );
}

function MagicMushroomItem({ open }) {
  return (
    <svg viewBox="0 0 70 80" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <path d="M 25 45 Q 23 70 28 78 L 42 78 Q 47 70 45 45 Z" fill="#fef3c7" stroke="#fbbf24" strokeWidth="1.5" />
      <g style={{ transformOrigin:'35px 40px', transform: open?'translateY(-10px) scale(1.1)':'translateY(0) scale(1)', transition:'transform 0.5s ease-out' }}>
        <ellipse cx="35" cy="35" rx="30" ry="20" fill="#a855f7" />
        <ellipse cx="35" cy="30" rx="26" ry="14" fill="#c084fc" />
        <path d="M 22 30 L 23 33 L 26 34 L 23 35 L 22 38 L 21 35 L 18 34 L 21 33 Z" fill="#fef9c3" />
        <path d="M 45 28 L 46 31 L 49 32 L 46 33 L 45 36 L 44 33 L 41 32 L 44 31 Z" fill="#fef9c3" />
      </g>
    </svg>
  );
}

function GroceryShelf({ palette = 'mixed' }) {
  const items = palette === 'cool' ? ['#dc2626','#3b82f6','#fbbf24','#22c55e','#a855f7','#06b6d4','#f97316']
    : palette === 'warm' ? ['#f97316','#dc2626','#fbbf24','#ec4899','#fde047','#a855f7','#22c55e']
    : ['#dc2626','#fbbf24','#3b82f6','#22c55e','#a855f7','#f97316','#ec4899'];
  return (
    <svg viewBox="0 0 240 80" preserveAspectRatio="none" style={{ width:'100%', height:'100%' }}>
      <rect x="0" y="0" width="240" height="6" fill="#a16207" />
      <rect x="0" y="74" width="240" height="6" fill="#a16207" />
      <rect x="0" y="0" width="4" height="80" fill="#7c2d12" />
      <rect x="236" y="0" width="4" height="80" fill="#7c2d12" />
      {items.map((color, i) => {
        const x = 12 + i*32; const h = 50 + (i%3)*8;
        return (
          <g key={i}>
            <rect x={x} y={74-h} width="22" height={h} fill={color} rx="2" />
            <rect x={x+2} y={74-h+4} width="18" height="6" fill="white" opacity="0.6" />
          </g>
        );
      })}
    </svg>
  );
}

function FruitDisplay({ type }) {
  const isBanana = type === 'banana';
  return (
    <svg viewBox="0 0 100 40" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="4" y="20" width="92" height="16" rx="2" fill={isBanana?'#fef08a':'#fecaca'} stroke={isBanana?'#a16207':'#9d174d'} strokeWidth="1.5" />
      <rect x="4" y="20" width="92" height="3" fill={isBanana?'#facc15':'#f87171'} />
      <rect x="30" y="0" width="40" height="18" rx="3" fill="white" stroke={isBanana?'#a16207':'#9d174d'} strokeWidth="2" />
      <text x="50" y="13" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="9" fill={isBanana?'#a16207':'#9d174d'}>
        {isBanana?'🍌 BANANAS':'🍓 BERRIES'}
      </text>
      {isBanana ? (
        <>
          <ellipse cx="20" cy="22" rx="8" ry="3" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(-15 20 22)" />
          <ellipse cx="80" cy="22" rx="8" ry="3" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(15 80 22)" />
        </>
      ) : (
        <>
          <circle cx="20" cy="24" r="4" fill="#ef4444" />
          <circle cx="80" cy="24" r="4" fill="#ef4444" />
        </>
      )}
    </svg>
  );
}

function SupermarketSign() {
  return (
    <svg viewBox="0 0 200 60" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="10" y="8" width="180" height="44" rx="8" fill="white" stroke="#ec4899" strokeWidth="3" />
      <rect x="14" y="12" width="172" height="36" rx="5" fill="#fce7f3" />
      <text x="100" y="34" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="20" fill="#9d174d">SUPERMARKET</text>
      <path d="M 28 24 L 30 30 L 36 32 L 30 34 L 28 40 L 26 34 L 20 32 L 26 30 Z" fill="#fbbf24" />
      <path d="M 172 24 L 174 30 L 180 32 L 174 34 L 172 40 L 170 34 L 164 32 L 170 30 Z" fill="#fbbf24" />
    </svg>
  );
}

function MegaMartSign() {
  return (
    <svg viewBox="0 0 220 60" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="6" y="6" width="208" height="48" rx="6" fill="#1d4ed8" stroke="#fbbf24" strokeWidth="3" />
      <rect x="10" y="10" width="200" height="40" rx="4" fill="#2563eb" />
      <text x="110" y="36" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="22" fill="#fbbf24">MEGA MART</text>
      <path d="M 25 22 L 28 30 L 35 31 L 30 36 L 31 43 L 25 39 L 19 43 L 20 36 L 15 31 L 22 30 Z" fill="#fde047" />
      <path d="M 195 22 L 198 30 L 205 31 L 200 36 L 201 43 L 195 39 L 189 43 L 190 36 L 185 31 L 192 30 Z" fill="#fde047" />
    </svg>
  );
}

function ProducePalette() {
  return (
    <svg viewBox="0 0 120 60" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="4" y="38" width="112" height="20" rx="2" fill="#92400e" stroke="#7c2d12" strokeWidth="1.5" />
      <line x1="40" y1="38" x2="40" y2="58" stroke="#7c2d12" strokeWidth="0.8" />
      <line x1="80" y1="38" x2="80" y2="58" stroke="#7c2d12" strokeWidth="0.8" />
      <rect x="36" y="2" width="48" height="14" rx="2" fill="white" stroke="#16a34a" strokeWidth="1.5" />
      <text x="60" y="12" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="8" fill="#15803d">PRODUCE</text>
      <circle cx="60" cy="32" r="4" fill="#dc2626" />
      <circle cx="68" cy="32" r="4" fill="#dc2626" />
      <circle cx="76" cy="32" r="4" fill="#dc2626" />
      <circle cx="64" cy="26" r="4" fill="#dc2626" />
      <circle cx="72" cy="26" r="4" fill="#dc2626" />
      <circle cx="92" cy="30" r="3.5" fill="#f97316" />
      <circle cx="100" cy="30" r="3.5" fill="#f97316" />
      <circle cx="108" cy="30" r="3.5" fill="#f97316" />
      <circle cx="20" cy="30" r="3" fill="#7e22ce" />
      <circle cx="26" cy="30" r="3" fill="#9333ea" />
      <circle cx="32" cy="30" r="3" fill="#7e22ce" />
      <circle cx="14" cy="34" r="3" fill="#9333ea" />
      <circle cx="20" cy="34" r="3" fill="#a855f7" />
      <circle cx="26" cy="34" r="3" fill="#7e22ce" />
      <circle cx="32" cy="34" r="3" fill="#9333ea" />
    </svg>
  );
}

function PalletStack({ color = '#dc2626' }) {
  return (
    <svg viewBox="0 0 60 80" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <rect x="2" y="68" width="56" height="10" fill="#92400e" stroke="#7c2d12" strokeWidth="1" />
      <line x1="14" y1="68" x2="14" y2="78" stroke="#7c2d12" strokeWidth="0.8" />
      <line x1="30" y1="68" x2="30" y2="78" stroke="#7c2d12" strokeWidth="0.8" />
      <line x1="46" y1="68" x2="46" y2="78" stroke="#7c2d12" strokeWidth="0.8" />
      <rect x="6" y="50" width="22" height="18" fill={color} stroke="#1e293b" strokeWidth="0.8" rx="1" />
      <rect x="32" y="50" width="22" height="18" fill={color} stroke="#1e293b" strokeWidth="0.8" rx="1" />
      <rect x="6" y="32" width="22" height="18" fill={color} stroke="#1e293b" strokeWidth="0.8" rx="1" />
      <rect x="32" y="32" width="22" height="18" fill={color} stroke="#1e293b" strokeWidth="0.8" rx="1" />
      <rect x="19" y="14" width="22" height="18" fill={color} stroke="#1e293b" strokeWidth="0.8" rx="1" />
      <rect x="9" y="56" width="16" height="3" fill="white" opacity="0.7" />
      <rect x="35" y="56" width="16" height="3" fill="white" opacity="0.7" />
      <rect x="9" y="38" width="16" height="3" fill="white" opacity="0.7" />
      <rect x="35" y="38" width="16" height="3" fill="white" opacity="0.7" />
      <rect x="22" y="20" width="16" height="3" fill="white" opacity="0.7" />
    </svg>
  );
}

// ============================================================================
// LEVEL 5 SCENERY — RAINBOW GARDEN
// ============================================================================

function RainbowArch() {
  return (
    <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      <path d="M 20 100 Q 100 -10 180 100" stroke="#ef4444" strokeWidth="9" fill="none" />
      <path d="M 28 100 Q 100 -2 172 100" stroke="#f97316" strokeWidth="9" fill="none" />
      <path d="M 36 100 Q 100 6 164 100" stroke="#fde047" strokeWidth="9" fill="none" />
      <path d="M 44 100 Q 100 14 156 100" stroke="#22c55e" strokeWidth="9" fill="none" />
      <path d="M 52 100 Q 100 22 148 100" stroke="#3b82f6" strokeWidth="9" fill="none" />
      <path d="M 60 100 Q 100 30 140 100" stroke="#a855f7" strokeWidth="9" fill="none" />
      {/* Cloud anchors at base */}
      <ellipse cx="20" cy="100" rx="22" ry="10" fill="white" />
      <ellipse cx="180" cy="100" rx="22" ry="10" fill="white" />
      <ellipse cx="14" cy="98" rx="14" ry="7" fill="white" />
      <ellipse cx="186" cy="98" rx="14" ry="7" fill="white" />
    </svg>
  );
}

function FruitTree({ fruitColor = '#ef4444', fruitType = 'apple' }) {
  return (
    <svg viewBox="0 0 80 130" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      {/* Trunk */}
      <path d="M 36 80 L 32 122 L 48 122 L 44 80 Z" fill="#92400e" />
      <path d="M 38 90 L 36 118" stroke="#7c2d12" strokeWidth="1" />
      {/* Leafy canopy */}
      <circle cx="40" cy="40" r="22" fill="#22c55e" />
      <circle cx="22" cy="50" r="18" fill="#16a34a" />
      <circle cx="58" cy="50" r="18" fill="#16a34a" />
      <circle cx="40" cy="60" r="20" fill="#22c55e" />
      {/* Hanging fruits */}
      {fruitType === 'banana' ? (
        <>
          <ellipse cx="30" cy="58" rx="4" ry="2" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(-30 30 58)" />
          <ellipse cx="48" cy="62" rx="4" ry="2" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(30 48 62)" />
          <ellipse cx="38" cy="48" rx="4" ry="2" fill="#fde047" stroke="#a16207" strokeWidth="0.5" />
          <ellipse cx="55" cy="42" rx="4" ry="2" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(20 55 42)" />
          <ellipse cx="22" cy="42" rx="4" ry="2" fill="#fde047" stroke="#a16207" strokeWidth="0.5" transform="rotate(-20 22 42)" />
        </>
      ) : fruitType === 'mango' ? (
        <>
          <ellipse cx="30" cy="58" rx="3.5" ry="4.5" fill="#fb923c" />
          <ellipse cx="48" cy="62" rx="3.5" ry="4.5" fill="#fb923c" />
          <ellipse cx="38" cy="48" rx="3.5" ry="4.5" fill="#fb923c" />
          <ellipse cx="55" cy="42" rx="3.5" ry="4.5" fill="#fb923c" />
          <ellipse cx="22" cy="42" rx="3.5" ry="4.5" fill="#fb923c" />
        </>
      ) : (
        <>
          <circle cx="30" cy="58" r="4" fill={fruitColor} />
          <circle cx="48" cy="62" r="4" fill={fruitColor} />
          <circle cx="38" cy="48" r="4" fill={fruitColor} />
          <circle cx="55" cy="42" r="4" fill={fruitColor} />
          <circle cx="22" cy="42" r="4" fill={fruitColor} />
        </>
      )}
    </svg>
  );
}

function HeartFlower({ color = '#ec4899' }) {
  return (
    <svg viewBox="0 0 30 40" style={{ width:'100%', height:'100%' }}>
      <rect x="14" y="22" width="2" height="16" fill="#16a34a" />
      <path d="M 8 28 Q 4 25 6 30" fill="#22c55e" />
      <path d="M 22 30 Q 26 27 24 32" fill="#22c55e" />
      <path d="M 15 18 Q 6 6 6 14 Q 6 20 15 26 Q 24 20 24 14 Q 24 6 15 18 Z" fill={color} />
      <circle cx="11" cy="13" r="2" fill="white" opacity="0.5" />
    </svg>
  );
}

function GardenButterfly({ color1 = '#ec4899', color2 = '#a855f7' }) {
  return (
    <svg viewBox="0 0 40 30" style={{ width:'100%', height:'100%', overflow:'visible' }}>
      {/* Body */}
      <ellipse cx="20" cy="15" rx="1.2" ry="6" fill="#1e293b" />
      <circle cx="20" cy="9" r="1.5" fill="#1e293b" />
      {/* Antennae */}
      <path d="M 19 8 Q 16 4 14 5" stroke="#1e293b" strokeWidth="0.7" fill="none" strokeLinecap="round" />
      <path d="M 21 8 Q 24 4 26 5" stroke="#1e293b" strokeWidth="0.7" fill="none" strokeLinecap="round" />
      {/* Top wings */}
      <path d="M 20 11 Q 6 4 4 14 Q 8 16 20 14 Z" fill={color1} />
      <path d="M 20 11 Q 34 4 36 14 Q 32 16 20 14 Z" fill={color1} />
      {/* Bottom wings */}
      <path d="M 20 16 Q 8 18 8 24 Q 14 23 20 19 Z" fill={color2} />
      <path d="M 20 16 Q 32 18 32 24 Q 26 23 20 19 Z" fill={color2} />
      {/* Wing dots */}
      <circle cx="10" cy="12" r="1.4" fill="white" opacity="0.7" />
      <circle cx="30" cy="12" r="1.4" fill="white" opacity="0.7" />
      <circle cx="12" cy="21" r="1" fill="white" opacity="0.6" />
      <circle cx="28" cy="21" r="1" fill="white" opacity="0.6" />
    </svg>
  );
}

function FloatingNumber({ value, x, y, color = '#ec4899' }) {
  return (
    <div style={{ position:'absolute', left:`${x}%`, top:`${y}%`, transform:'translate(-50%, -50%)', fontFamily:"'Fredoka', sans-serif", fontWeight:800, fontSize:'clamp(48px, 9vw, 84px)', color, textShadow:'3px 3px 0 white, -2px -2px 0 white, 2px -2px 0 white, -2px 2px 0 white, 2px 2px 0 white, 5px 5px 0 rgba(0,0,0,0.18)', animation:'numberFloat 1.3s ease-out forwards', pointerEvents:'none', zIndex:35, WebkitTextStroke:'1px white' }}>
      {value}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() => {
    const colors = ['#ef4444','#f97316','#fbbf24','#fde047','#22c55e','#3b82f6','#a855f7','#ec4899','#fb7185','#06b6d4'];
    const shapes = ['circle','square','triangle','star'];
    return Array.from({ length: 90 }).map((_, i) => ({
      id:i, left:Math.random()*100, delay:Math.random()*1.8, duration:2.5+Math.random()*2,
      drift:(Math.random()-0.5)*40, rotation:360+Math.random()*720, color:colors[i%colors.length],
      shape:shapes[i%shapes.length], size:8+Math.random()*8,
    }));
  }, []);
  return (
    <div style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden', zIndex:50 }}>
      {pieces.map((p) => {
        const baseStyle = { position:'absolute', left:`${p.left}%`, top:'-12%', width:`${p.size}px`, height:`${p.size}px`, animation:`confettiFall ${p.duration}s ease-in ${p.delay}s forwards`, '--drift':`${p.drift}vw`, '--rotation':`${p.rotation}deg` };
        if (p.shape === 'circle') return <div key={p.id} style={{ ...baseStyle, background:p.color, borderRadius:'50%' }} />;
        if (p.shape === 'square') return <div key={p.id} style={{ ...baseStyle, background:p.color, borderRadius:'2px' }} />;
        if (p.shape === 'triangle') return <div key={p.id} style={{ ...baseStyle, width:0, height:0, background:'transparent', borderLeft:`${p.size/2}px solid transparent`, borderRight:`${p.size/2}px solid transparent`, borderBottom:`${p.size}px solid ${p.color}` }} />;
        return <div key={p.id} style={baseStyle}><svg viewBox="0 0 20 20" style={{ width:'100%', height:'100%' }}><path d="M 10 1 L 12.5 7.5 L 19 8 L 14 13 L 15.5 19 L 10 16 L 4.5 19 L 6 13 L 1 8 L 7.5 7.5 Z" fill={p.color} /></svg></div>;
      })}
    </div>
  );
}

function CountUpDisplay({ target, color, label, onComplete }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0); if (target === 0) return;
    let i = 0;
    const stepMs = Math.max(120, 600 / Math.max(target, 1));
    const id = setInterval(() => {
      i += 1; setCount(i); sound.collect(i - 1);
      if (i >= target) { clearInterval(id); setTimeout(() => { sound.win(); onComplete?.(); }, 250); }
    }, stepMs);
    return () => clearInterval(id);
  }, [target]);
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.4rem' }}>
      <div key={count} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(7rem, 22vw, 14rem)', color, lineHeight:1, textShadow:'4px 4px 0 white, 8px 8px 0 rgba(0,0,0,0.18)', WebkitTextStroke:'2px white', animation:'numberPop 0.3s ease-out' }}>{count}</div>
      <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(1rem, 3.5vw, 1.4rem)', color:'white', textShadow:'2px 2px 0 rgba(0,0,0,0.3)', textAlign:'center', padding:'0 1rem' }}>{label}</div>
    </div>
  );
}

function MathReveal({ config, onComplete }) {
  const [phase, setPhase] = useState(0);
  const isSub = config.operation === 'sub';
  useEffect(() => {
    sound.pop();
    const t1 = setTimeout(() => { setPhase(1); sound.pop(); }, 700);
    const t2 = setTimeout(() => { setPhase(2); sound.pop(); }, 1500);
    const t3 = setTimeout(() => {
      setPhase(3);
      sound.win();
      // Read the equation aloud
      if (isSub) {
        const isEs = (speech.lang || '').startsWith('es');
        const minus = isEs ? 'menos' : 'minus';
        const equals = isEs ? 'es igual a' : 'equals';
        const text = `${numToWord(config.minuend, speech.lang)} ${minus} ${numToWord(config.subtrahend, speech.lang)} ${equals} ${numToWord(config.total, speech.lang)}`;
        speech.speak(text);
      } else {
        speech.speak(buildEquationSpeech(config, speech.lang));
      }
    }, 2400);
    const t4 = setTimeout(onComplete, 4400);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, []);

  // Subtraction layout
  if (isSub) {
    const ItemComp = ITEM_COMPONENTS[config.type] || Strawberry;
    return (
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(157, 23, 77, 0.7) 0%, rgba(126, 34, 206, 0.7) 100%)', backdropFilter:'blur(6px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'1.5rem', padding:'1rem', zIndex:55, animation:'celebrationFadeIn 0.4s ease-out' }}>
        <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 5vw, 2.2rem)', color:'white', textShadow:'3px 3px 0 #ec4899, 5px 5px 0 rgba(0,0,0,0.3)', textAlign:'center', animation:'greatJobBounce 0.6s ease-out' }}>
          Let's count! ✨
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'clamp(0.4rem, 1.5vw, 1rem)', flexWrap:'wrap', justifyContent:'center', maxWidth:'95vw' }}>
          {/* Minuend group */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.3rem', opacity: phase>=1?1:0, transform: phase>=1?'scale(1)':'scale(0.5)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(config.minuend, 4)}, 1fr)`, gap:'3px', background:'rgba(255,255,255,0.2)', padding:'0.4rem', borderRadius:'12px' }}>
              {Array.from({ length: config.minuend }).map((_, i) => (
                <div key={i} style={{ width:'clamp(20px, 4vw, 32px)', height:'clamp(24px, 5vw, 40px)', opacity: (phase>=2 && i >= config.total) ? 0.25 : 1, filter: (phase>=2 && i >= config.total) ? 'grayscale(1)' : 'none', transition:'opacity 0.4s, filter 0.4s' }}>
                  <ItemComp />
                </div>
              ))}
            </div>
            <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'#fde047', lineHeight:1, textShadow:'2px 2px 0 #1e293b, 3px 3px 0 rgba(0,0,0,0.3)', WebkitTextStroke:'1px white' }}>{config.minuend}</div>
            <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.7rem, 2.4vw, 1rem)', color:'white', textShadow:'1px 1px 0 rgba(0,0,0,0.4)' }}>{config.labelA}</div>
          </div>
          {/* Minus sign */}
          <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'white', textShadow:'2px 2px 0 #ec4899, 3px 3px 0 rgba(0,0,0,0.3)', opacity: phase>=2?1:0, transform: phase>=2?'scale(1)':'scale(0)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>−</div>
          {/* Subtrahend label */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.3rem', opacity: phase>=2?1:0, transform: phase>=2?'scale(1)':'scale(0.5)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s' }}>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(config.subtrahend, 3)}, 1fr)`, gap:'3px', background:'rgba(255,255,255,0.2)', padding:'0.4rem', borderRadius:'12px' }}>
              {Array.from({ length: config.subtrahend }).map((_, i) => (
                <div key={i} style={{ width:'clamp(20px, 4vw, 32px)', height:'clamp(24px, 5vw, 40px)', opacity:0.45, filter:'grayscale(0.6)' }}>
                  <ItemComp />
                </div>
              ))}
            </div>
            <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'#fde047', lineHeight:1, textShadow:'2px 2px 0 #1e293b, 3px 3px 0 rgba(0,0,0,0.3)', WebkitTextStroke:'1px white' }}>{config.subtrahend}</div>
            <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.7rem, 2.4vw, 1rem)', color:'white', textShadow:'1px 1px 0 rgba(0,0,0,0.4)' }}>{config.labelB}</div>
          </div>
          {/* Equals + total */}
          <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'white', textShadow:'2px 2px 0 #ec4899, 3px 3px 0 rgba(0,0,0,0.3)', opacity: phase>=3?1:0, transform: phase>=3?'scale(1)':'scale(0)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>=</div>
          <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:800, fontSize:'clamp(4rem, 14vw, 7rem)', color:'#fde047', lineHeight:1, textShadow:'3px 3px 0 #ec4899, 6px 6px 0 rgba(0,0,0,0.3)', WebkitTextStroke:'2px white', opacity: phase>=3?1:0, transform: phase>=3?'scale(1)':'scale(0.3)', transition:'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>{config.total}</div>
        </div>
      </div>
    );
  }

  // Addition layout (existing)
  return (
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(157, 23, 77, 0.7) 0%, rgba(126, 34, 206, 0.7) 100%)', backdropFilter:'blur(6px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'1.5rem', padding:'1rem', zIndex:55, animation:'celebrationFadeIn 0.4s ease-out' }}>
      <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 5vw, 2.2rem)', color:'white', textShadow:'3px 3px 0 #ec4899, 5px 5px 0 rgba(0,0,0,0.3)', textAlign:'center', animation:'greatJobBounce 0.6s ease-out' }}>
        Let's count! ✨
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'clamp(0.4rem, 1.5vw, 1rem)', flexWrap:'wrap', justifyContent:'center', maxWidth:'95vw' }}>
        {config.groups.map((g, gi) => (
          <Fragment key={gi}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.3rem', opacity: phase>=1?1:0, transform: phase>=1?'scale(1)':'scale(0.5)', transition:`all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${gi*0.25}s` }}>
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${g.count <= 4 ? 2 : Math.ceil(Math.sqrt(g.count))}, 1fr)`, gap:'3px', background:'rgba(255,255,255,0.2)', padding:'0.4rem', borderRadius:'12px', minWidth:'clamp(70px, 14vw, 110px)', justifyContent:'center' }}>
                {Array.from({ length: g.count }).map((_, i) => {
                  const ItemComp = ITEM_COMPONENTS[g.type] || Strawberry;
                  return <div key={i} style={{ width:'clamp(20px, 4vw, 32px)', height:'clamp(24px, 5vw, 40px)' }}><ItemComp /></div>;
                })}
              </div>
              <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'#fde047', lineHeight:1, textShadow:'2px 2px 0 #1e293b, 3px 3px 0 rgba(0,0,0,0.3)', WebkitTextStroke:'1px white' }}>{g.count}</div>
              <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.7rem, 2.4vw, 1rem)', color:'white', textShadow:'1px 1px 0 rgba(0,0,0,0.4)' }}>{g.label}</div>
            </div>
            {gi < config.groups.length - 1 && (
              <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'white', textShadow:'2px 2px 0 #ec4899, 3px 3px 0 rgba(0,0,0,0.3)', opacity: phase>=2?1:0, transform: phase>=2?'scale(1)':'scale(0)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>+</div>
            )}
          </Fragment>
        ))}
        <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.5rem, 8vw, 4rem)', color:'white', textShadow:'2px 2px 0 #ec4899, 3px 3px 0 rgba(0,0,0,0.3)', opacity: phase>=3?1:0, transform: phase>=3?'scale(1)':'scale(0)', transition:'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>=</div>
        <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:800, fontSize:'clamp(4rem, 14vw, 7rem)', color:'#fde047', lineHeight:1, textShadow:'3px 3px 0 #ec4899, 6px 6px 0 rgba(0,0,0,0.3)', WebkitTextStroke:'2px white', opacity: phase>=3?1:0, transform: phase>=3?'scale(1)':'scale(0.3)', transition:'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>{config.total}</div>
      </div>
    </div>
  );
}

// ============================================================================
// PARENT GATE — required for App Store kids' category
// ============================================================================
function ParentGate({ onSuccess, onCancel }) {
  // Generate two random single-digit numbers; ask parent to enter the sum
  const [problem] = useState(() => {
    const a = 4 + Math.floor(Math.random() * 5); // 4-8
    const b = 4 + Math.floor(Math.random() * 5); // 4-8
    return { a, b, answer: a + b };
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  function check() {
    if (parseInt(input, 10) === problem.answer) {
      onSuccess();
    } else {
      setError(true);
      setInput('');
      setTimeout(() => setError(false), 600);
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.85)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', animation:'celebrationFadeIn 0.3s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'2rem 1.5rem', maxWidth:'380px', width:'100%', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.4)', animation: error ? 'shake 0.5s' : 'none' }}>
        <div style={{ fontSize:'clamp(2.5rem, 8vw, 3.5rem)', marginBottom:'0.5rem' }}>👨‍👩‍👧</div>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.3rem, 4.5vw, 1.7rem)', color:'#1e293b', margin:'0 0 0.5rem' }}>Grown-Up Check</h2>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'clamp(0.85rem, 2.5vw, 1rem)', color:'#64748b', margin:'0 0 1.25rem', lineHeight:1.4 }}>
          What is {problem.a} + {problem.b}?
        </p>
        <input
          type="number"
          inputMode="numeric"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          aria-label="Answer"
          style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'1.6rem', textAlign:'center', width:'100px', padding:'0.6rem', border:`3px solid ${error ? '#dc2626' : '#cbd5e1'}`, borderRadius:'12px', outline:'none', marginBottom:'1.25rem' }}
        />
        <div style={{ display:'flex', gap:'0.6rem', justifyContent:'center' }}>
          <button onClick={onCancel} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'#64748b', background:'#f1f5f9', border:'2px solid #cbd5e1', padding:'0.6rem 1.2rem', borderRadius:'999px', cursor:'pointer', minHeight:'44px' }}>
            Cancel
          </button>
          <button onClick={check} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.6rem 1.4rem', borderRadius:'999px', boxShadow:'0 4px 0 #9d174d', cursor:'pointer', minHeight:'44px' }}>
            Continue
          </button>
        </div>
        {error && (
          <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#dc2626', margin:'0.75rem 0 0' }}>
            Try again!
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// HOW TO PLAY — first-launch tutorial
// ============================================================================
function HowToPlay({ onClose }) {
  const [page, setPage] = useState(0);
  const pages = [
    {
      emoji: '👆',
      title: 'Tap to Move',
      body: 'Tap anywhere on the screen and Lili will walk there.',
    },
    {
      emoji: '🍓',
      title: 'Collect the Fruits',
      body: 'Walk Lili over the fruits to put them in her basket. Listen for the music!',
    },
    {
      emoji: '💕',
      title: 'Share with Friends',
      body: 'When the basket is full, Lili shares with her friends. Then count together!',
    },
  ];
  const p = pages[page];
  const isLast = page === pages.length - 1;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.85)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', animation:'celebrationFadeIn 0.3s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'1.75rem 1.5rem', maxWidth:'380px', width:'100%', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize:'clamp(3.5rem, 12vw, 5rem)', marginBottom:'0.5rem' }} aria-hidden="true">{p.emoji}</div>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.3rem, 4.5vw, 1.7rem)', color:'#9d174d', margin:'0 0 0.6rem' }}>{p.title}</h2>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'clamp(0.95rem, 2.8vw, 1.1rem)', color:'#475569', margin:'0 0 1.25rem', lineHeight:1.5 }}>{p.body}</p>
        {/* Page dots */}
        <div style={{ display:'flex', gap:'0.5rem', justifyContent:'center', marginBottom:'1.25rem' }}>
          {pages.map((_, i) => (
            <div key={i} style={{ width:'10px', height:'10px', borderRadius:'50%', background: i === page ? '#ec4899' : '#cbd5e1', transition:'background 0.2s' }} />
          ))}
        </div>
        <div style={{ display:'flex', gap:'0.6rem', justifyContent:'center' }}>
          {page > 0 && (
            <button onClick={() => setPage(page - 1)} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'#64748b', background:'#f1f5f9', border:'2px solid #cbd5e1', padding:'0.6rem 1.2rem', borderRadius:'999px', cursor:'pointer', minHeight:'44px' }}>
              Back
            </button>
          )}
          <button onClick={() => isLast ? onClose() : setPage(page + 1)} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.6rem 1.6rem', borderRadius:'999px', boxShadow:'0 4px 0 #9d174d', cursor:'pointer', minHeight:'44px' }}>
            {isLast ? "Let's Play!" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PAUSE MENU — opens when child taps the home button mid-level
// ============================================================================
function PauseMenu({ onResume, onRestart, onHome }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.7)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:150, padding:'1rem', animation:'celebrationFadeIn 0.25s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'1.75rem 1.5rem', maxWidth:'340px', width:'100%', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize:'clamp(2.5rem, 8vw, 3.5rem)', marginBottom:'0.4rem' }} aria-hidden="true">⏸️</div>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.3rem, 4.5vw, 1.7rem)', color:'#9d174d', margin:'0 0 1.25rem' }}>Paused</h2>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
          <button onClick={onResume} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1.1rem', color:'white', background:'linear-gradient(180deg, #22c55e 0%, #15803d 100%)', border:'none', padding:'0.75rem 1.4rem', borderRadius:'999px', boxShadow:'0 5px 0 #14532d', cursor:'pointer', minHeight:'48px' }}>
            ▶ Keep Playing
          </button>
          <button onClick={onRestart} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'#9d174d', background:'white', border:'3px solid #f9a8d4', padding:'0.6rem 1.2rem', borderRadius:'999px', cursor:'pointer', minHeight:'44px' }}>
            🔄 Start Over
          </button>
          <button onClick={onHome} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'#64748b', background:'#f1f5f9', border:'2px solid #cbd5e1', padding:'0.6rem 1.2rem', borderRadius:'999px', cursor:'pointer', minHeight:'44px' }}>
            🏠 Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PRIVACY / ABOUT — accessible behind parent gate
// ============================================================================
function AboutScreen({ onClose, childName, setChildName, speechLang, setSpeechLang, totalFruitsCollected, completedLevels, levelPlayCounts, daysPlayed, onResetProgress }) {
  const [localName, setLocalName] = useState(childName || '');
  const [confirmReset, setConfirmReset] = useState(false);

  function handleSave() {
    setChildName(localName.trim().slice(0, 20));
    onClose();
  }

  // Compute stats for parent dashboard
  const totalStars = Object.values(levelPlayCounts || {}).reduce((sum, c) => sum + Math.min(c, 3), 0);
  const totalLevelPlays = Object.values(levelPlayCounts || {}).reduce((sum, c) => sum + c, 0);
  const daysCount = (daysPlayed || []).length;
  const levelsCompleted = (completedLevels || []).length;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.85)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', animation:'celebrationFadeIn 0.3s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'1.75rem 1.5rem', maxWidth:'420px', width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.4)', maxHeight:'90vh', overflowY:'auto' }}>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 4.5vw, 1.8rem)', color:'#9d174d', margin:'0 0 0.5rem', textAlign:'center' }}>About Lili</h2>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.92rem', color:'#475569', margin:'0 0 1rem', lineHeight:1.5 }}>
          A gentle counting and sharing game for ages 3–5. Lili the pony collects fruits with her friends and learns simple addition along the way.
        </p>

        {/* Progress dashboard */}
        {totalLevelPlays > 0 && (
          <>
            <h3 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1.05rem', color:'#1e293b', margin:'0.5rem 0 0.5rem' }}>📊 Progress {childName ? `— ${childName}` : ''}</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'1rem' }}>
              <div style={{ background:'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)', padding:'0.6rem', borderRadius:'12px', textAlign:'center', border:'2px solid #f9a8d4' }}>
                <div style={{ fontSize:'1.6rem', lineHeight:1 }}>🍓</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'1.4rem', color:'#9d174d', lineHeight:1.1, marginTop:'0.15rem' }}>{totalFruitsCollected}</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.7rem', color:'#86198f' }}>fruits picked</div>
              </div>
              <div style={{ background:'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', padding:'0.6rem', borderRadius:'12px', textAlign:'center', border:'2px solid #fbbf24' }}>
                <div style={{ fontSize:'1.6rem', lineHeight:1 }}>⭐</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'1.4rem', color:'#a16207', lineHeight:1.1, marginTop:'0.15rem' }}>{totalStars}</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.7rem', color:'#92400e' }}>stars earned</div>
              </div>
              <div style={{ background:'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', padding:'0.6rem', borderRadius:'12px', textAlign:'center', border:'2px solid #93c5fd' }}>
                <div style={{ fontSize:'1.6rem', lineHeight:1 }}>🏆</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'1.4rem', color:'#1e3a8a', lineHeight:1.1, marginTop:'0.15rem' }}>{levelsCompleted}/6</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.7rem', color:'#1d4ed8' }}>levels mastered</div>
              </div>
              <div style={{ background:'linear-gradient(135deg, #d9f99d 0%, #86efac 100%)', padding:'0.6rem', borderRadius:'12px', textAlign:'center', border:'2px solid #4ade80' }}>
                <div style={{ fontSize:'1.6rem', lineHeight:1 }}>📅</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'1.4rem', color:'#15803d', lineHeight:1.1, marginTop:'0.15rem' }}>{daysCount}</div>
                <div style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.7rem', color:'#166534' }}>days played</div>
              </div>
            </div>
          </>
        )}

        {/* Personalization */}
        <h3 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1.05rem', color:'#1e293b', margin:'0.75rem 0 0.4rem' }}>Personalize ✨</h3>
        <label style={{ display:'block', fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#475569', marginBottom:'0.3rem' }}>Child's name (used in celebrations)</label>
        <input
          type="text"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          placeholder="e.g. Olivia"
          maxLength={20}
          aria-label="Child's name"
          style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'1rem', width:'100%', padding:'0.6rem 0.8rem', border:'2px solid #cbd5e1', borderRadius:'10px', outline:'none', marginBottom:'0.85rem', boxSizing:'border-box' }}
        />

        <label style={{ display:'block', fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#475569', marginBottom:'0.3rem' }}>Read-aloud language</label>
        <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
          {[
            { code:'en-US', label:'English 🇺🇸' },
            { code:'es-ES', label:'Español 🇪🇸' },
          ].map((opt) => (
            <button
              key={opt.code}
              onClick={() => setSpeechLang(opt.code)}
              style={{
                flex:1, fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.9rem',
                color: speechLang === opt.code ? 'white' : '#475569',
                background: speechLang === opt.code ? 'linear-gradient(180deg, #ec4899 0%, #db2777 100%)' : '#f1f5f9',
                border: speechLang === opt.code ? 'none' : '2px solid #cbd5e1',
                padding:'0.55rem 0.5rem', borderRadius:'10px', cursor:'pointer', minHeight:'42px',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <h3 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1.05rem', color:'#1e293b', margin:'0.75rem 0 0.4rem' }}>Privacy</h3>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.88rem', color:'#475569', margin:'0 0 0.5rem', lineHeight:1.5 }}>
          • No data collection. No accounts. No ads.<br />
          • No third-party tracking.<br />
          • Game progress is saved only on this device.<br />
          • No internet connection required to play.
        </p>
        <h3 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1.05rem', color:'#1e293b', margin:'0.75rem 0 0.4rem' }}>For Parents</h3>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.88rem', color:'#475569', margin:'0 0 1rem', lineHeight:1.5 }}>
          Designed for the "How many altogether?" moment. Each level ends with a visual addition story (e.g., 4 + 4 = 8) read aloud to support early number sense.
        </p>
        <button onClick={handleSave} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.65rem 1.5rem', borderRadius:'999px', boxShadow:'0 4px 0 #9d174d', cursor:'pointer', minHeight:'44px', width:'100%' }}>
          Save & Close
        </button>

        {/* Reset progress (parent utility, behind two-step confirmation) */}
        <div style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid #e2e8f0' }}>
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:500, fontSize:'0.78rem', color:'#94a3b8', background:'transparent', border:'none', padding:'0.25rem 0.5rem', cursor:'pointer', textDecoration:'underline', display:'block', margin:'0 auto' }}
            >
              Reset all progress
            </button>
          ) : (
            <div style={{ background:'#fef2f2', border:'2px solid #fecaca', borderRadius:'12px', padding:'0.75rem', textAlign:'center' }}>
              <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#991b1b', margin:'0 0 0.6rem', lineHeight:1.4 }}>
                This will erase all stars, fruits, and saved settings. This cannot be undone.
              </p>
              <div style={{ display:'flex', gap:'0.5rem', justifyContent:'center' }}>
                <button onClick={() => setConfirmReset(false)} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.85rem', color:'#475569', background:'white', border:'2px solid #cbd5e1', padding:'0.5rem 1rem', borderRadius:'999px', cursor:'pointer', minHeight:'40px' }}>
                  Keep
                </button>
                <button onClick={() => { onResetProgress(); setConfirmReset(false); onClose(); }} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.85rem', color:'white', background:'#dc2626', border:'none', padding:'0.5rem 1rem', borderRadius:'999px', cursor:'pointer', minHeight:'40px', boxShadow:'0 3px 0 #991b1b' }}>
                  Yes, reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SPLASH SCREEN — branded first impression on app launch
// ============================================================================
function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, #fce7f3 0%, #fbcfe8 50%, #fef3c7 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
      {/* Sparkles around */}
      <div style={{ position:'absolute', top:'18%', left:'15%', width:'34px', height:'34px', animation:'splashSparkle 1.6s ease-in-out infinite' }}><Sparkle /></div>
      <div style={{ position:'absolute', top:'24%', right:'18%', width:'28px', height:'28px', animation:'splashSparkle 1.6s ease-in-out infinite 0.4s' }}><Sparkle /></div>
      <div style={{ position:'absolute', bottom:'28%', left:'22%', width:'24px', height:'24px', animation:'splashSparkle 1.6s ease-in-out infinite 0.8s' }}><Sparkle /></div>
      <div style={{ position:'absolute', bottom:'22%', right:'20%', width:'30px', height:'30px', animation:'splashSparkle 1.6s ease-in-out infinite 0.2s' }}><Sparkle /></div>
      {/* Lili character — bounces in */}
      <div style={{ width:'min(280px, 65%)', height:'200px', animation:'splashLili 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <Lili facing="right" happy level={1} />
      </div>
      {/* Title — fades up */}
      <h1 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(3rem, 12vw, 6rem)', color:'#9d174d', margin:'0.5rem 0 0', textShadow:'4px 4px 0 #fbcfe8, 8px 8px 0 rgba(157, 23, 77, 0.15)', letterSpacing:'-0.02em', animation:'splashTitle 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both' }}>
        Lili
      </h1>
      <p style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:500, fontSize:'clamp(0.9rem, 2.6vw, 1.1rem)', color:'#86198f', margin:'0.4rem 0 0', opacity:0, animation:'splashTagline 0.6s ease-out 0.9s forwards' }}>
        Count, Share, Smile
      </p>
    </div>
  );
}

// ============================================================================
// SEND TO GRANDMA — postcard generator (HTML5 Canvas, no external lib)
// ============================================================================
function generatePostcard({ name, levelName, stars, totalFruits, lang }) {
  const isEs = (lang || '').startsWith('es');
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');

  // Pink-to-yellow gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, 800);
  grad.addColorStop(0, '#fce7f3');
  grad.addColorStop(0.5, '#fbcfe8');
  grad.addColorStop(1, '#fef3c7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 800);

  // Decorative confetti dots
  const dotColors = ['#ec4899', '#a855f7', '#fbbf24', '#22c55e', '#3b82f6'];
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = dotColors[i % dotColors.length];
    ctx.globalAlpha = 0.5;
    const r = 8 + Math.random() * 12;
    const x = 40 + Math.random() * 1120;
    const y = 40 + Math.random() * 720;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Inner rounded card
  ctx.fillStyle = 'white';
  const r = 28;
  const x = 80, y = 80, w = 1040, h = 640;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  // Card border
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.textAlign = 'center';
  // Header
  ctx.fillStyle = '#9d174d';
  ctx.font = 'bold 78px sans-serif';
  const headerText = name ? (isEs ? `¡${name} lo logró!` : `${name} did it!`) : (isEs ? '¡Lo logré!' : 'I did it!');
  ctx.fillText(headerText, 600, 200);

  // Level name
  ctx.fillStyle = '#be185d';
  ctx.font = '46px sans-serif';
  ctx.fillText(levelName, 600, 270);

  // Stars
  ctx.font = '110px sans-serif';
  ctx.fillText('⭐'.repeat(Math.max(stars, 1)), 600, 420);

  // Fruits stat
  ctx.fillStyle = '#86198f';
  ctx.font = '40px sans-serif';
  const fruitsText = isEs ? `🍓 ${totalFruits} frutas en total` : `🍓 ${totalFruits} fruits collected!`;
  ctx.fillText(fruitsText, 600, 510);

  // Date
  ctx.fillStyle = '#64748b';
  ctx.font = '32px sans-serif';
  const dateOpts = { year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = new Date().toLocaleDateString(isEs ? 'es-ES' : 'en-US', dateOpts);
  ctx.fillText(dateStr, 600, 580);

  // Footer
  ctx.fillStyle = '#9d174d';
  ctx.font = 'bold 38px sans-serif';
  const footerText = isEs ? '🐴 ¡Lili dice excelente trabajo!' : '🐴 Lili says: Great Job!';
  ctx.fillText(footerText, 600, 670);

  return canvas.toDataURL('image/png');
}

function PostcardModal({ dataUrl, childName, onClose }) {
  function handleSave() {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `lili-${(childName || 'kid').toLowerCase().replace(/\s+/g, '-')}-postcard.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  async function handleShare() {
    try {
      if (navigator.canShare && navigator.share) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'lili-postcard.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Look what I did!', text: 'Lili says great job!' });
          return;
        }
      }
      handleSave();
    } catch { handleSave(); }
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.85)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', animation:'celebrationFadeIn 0.3s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'1.25rem', maxWidth:'440px', width:'100%', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.4)', maxHeight:'90vh', overflowY:'auto' }}>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.2rem, 4vw, 1.5rem)', color:'#9d174d', margin:'0 0 0.5rem' }}>📮 Send to Grandma!</h2>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#64748b', margin:'0 0 0.75rem' }}>Save this postcard or share it directly.</p>
        <img src={dataUrl} alt="Postcard preview" style={{ width:'100%', borderRadius:'12px', border:'2px solid #f9a8d4', boxShadow:'0 4px 12px rgba(0,0,0,0.15)', animation:'postcardZoom 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
        <div style={{ display:'flex', gap:'0.5rem', marginTop:'1rem', flexWrap:'wrap', justifyContent:'center' }}>
          <button onClick={handleShare} style={{ flex:'1 1 120px', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.95rem', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.65rem 1.2rem', borderRadius:'999px', boxShadow:'0 4px 0 #9d174d', cursor:'pointer', minHeight:'46px' }}>
            📤 Share
          </button>
          <button onClick={handleSave} style={{ flex:'1 1 120px', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.95rem', color:'white', background:'linear-gradient(180deg, #a855f7 0%, #7e22ce 100%)', border:'none', padding:'0.65rem 1.2rem', borderRadius:'999px', boxShadow:'0 4px 0 #581c87', cursor:'pointer', minHeight:'46px' }}>
            💾 Save
          </button>
          <button onClick={onClose} style={{ flex:'1 1 80px', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.95rem', color:'#64748b', background:'#f1f5f9', border:'2px solid #cbd5e1', padding:'0.55rem 1rem', borderRadius:'999px', cursor:'pointer', minHeight:'46px' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COLOR SALON — let kids style Lili
// ============================================================================
function ColorSalon({ currentColor, onSelect, onClose, speechLang }) {
  const [selected, setSelected] = useState(currentColor);
  const swatches = [
    { id: null, label: 'Default', color: '#a855f7' },
    { id: 'pink', label: 'Pink', color: '#ec4899' },
    { id: 'blue', label: 'Blue', color: '#3b82f6' },
    { id: 'green', label: 'Green', color: '#22c55e' },
    { id: 'orange', label: 'Orange', color: '#f97316' },
    { id: 'rainbow', label: 'Rainbow', color: 'conic-gradient(from 0deg, #ef4444, #f97316, #fde047, #22c55e, #3b82f6, #a855f7, #ef4444)' },
  ];
  function handleSave() {
    onSelect(selected);
    sound.win();
    onClose();
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.85)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'1rem', animation:'celebrationFadeIn 0.3s ease-out' }}>
      <div style={{ background:'white', borderRadius:'24px', padding:'1.5rem 1.25rem', maxWidth:'400px', width:'100%', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }}>
        <h2 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.3rem, 4.5vw, 1.7rem)', color:'#9d174d', margin:'0 0 0.4rem' }}>🎨 Style Lili!</h2>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.85rem', color:'#64748b', margin:'0 0 0.8rem' }}>Pick Lili's mane color</p>
        {/* Live preview */}
        <div style={{ width:'160px', height:'120px', margin:'0 auto 0.8rem' }}>
          <Lili facing="right" happy level={1} colorPreset={selected} />
        </div>
        {/* Swatches */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'0.5rem', marginBottom:'1rem' }}>
          {swatches.map((s) => (
            <button
              key={s.id || 'default'}
              onClick={() => { sound.pop(); haptic(8); setSelected(s.id); }}
              aria-label={`Choose ${s.label}`}
              style={{
                fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.78rem',
                padding:'0.45rem 0.3rem', border: selected === s.id ? '3px solid #ec4899' : '2px solid #e2e8f0',
                borderRadius:'12px', cursor:'pointer', background:'white', minHeight:'62px',
                display:'flex', flexDirection:'column', alignItems:'center', gap:'0.25rem',
                color:'#475569',
              }}
            >
              <span style={{ width:'26px', height:'26px', borderRadius:'50%', background: s.color, border:'2px solid white', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <button onClick={onClose} style={{ flex:1, fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'0.95rem', color:'#64748b', background:'#f1f5f9', border:'2px solid #cbd5e1', padding:'0.6rem', borderRadius:'999px', cursor:'pointer', minHeight:'44px' }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ flex:2, fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'1rem', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.6rem 1.2rem', borderRadius:'999px', boxShadow:'0 4px 0 #9d174d', cursor:'pointer', minHeight:'44px' }}>
            ✨ Use This!
          </button>
        </div>
      </div>
    </div>
  );
}

function SoundToggle({ enabled, onToggle }) {
  return (
    <button onClick={onToggle} aria-label={enabled?'Mute sound':'Unmute sound'} style={{ position:'absolute', top:'2%', right:'3%', fontFamily:"'Fredoka', sans-serif", fontSize:'clamp(1rem, 3.5vw, 1.4rem)', background:'rgba(255, 255, 255, 0.85)', backdropFilter:'blur(8px)', border:'2px solid rgba(0,0,0,0.1)', padding:'0.45rem 0.7rem', borderRadius:'999px', cursor:'pointer', zIndex:25, boxShadow:'0 3px 8px rgba(0,0,0,0.15)', minWidth:'44px', minHeight:'44px' }}>
      {enabled?'🔊':'🔇'}
    </button>
  );
}

function SpeechBubble({ text, x, y, side = 'right', color = '#9333ea' }) {
  // Clamp x to keep bubble inside viewport (avoids clipping at edges)
  const safeX = Math.max(22, Math.min(78, x));
  return (
    <div style={{ position:'absolute', left:`${safeX}%`, top:`${y}%`, transform:'translate(-50%, -100%)', background:'white', padding:'0.6rem 1rem', borderRadius:'20px', border:`3px solid ${color}`, fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.85rem, 2.3vw, 1.1rem)', color:color, boxShadow:`0 4px 12px ${color}30`, maxWidth:'min(75vw, 280px)', whiteSpace:'nowrap', animation:'bubblePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)', zIndex:30 }}>
      {text}
      <div style={{ position:'absolute', bottom:'-12px', [side==='right'?'right':'left']:'20px', width:0, height:0, borderLeft:'10px solid transparent', borderRight:'10px solid transparent', borderTop:`14px solid ${color}` }} />
      <div style={{ position:'absolute', bottom:'-7px', [side==='right'?'right':'left']:'23px', width:0, height:0, borderLeft:'7px solid transparent', borderRight:'7px solid transparent', borderTop:'10px solid white' }} />
    </div>
  );
}

function LevelButton({ onClick, stars = 0, gradient, shadow, label }) {
  return (
    <button onClick={onClick} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(1rem, 3.4vw, 1.3rem)', color:'white', background:gradient, border:'none', padding:'0.7rem 1.3rem', borderRadius:'999px', boxShadow:shadow, cursor:'pointer', position:'relative', minHeight:'48px' }}>
      {label}
      {stars > 0 && (
        <span style={{ position:'absolute', top:'-12px', right:'-6px', display:'flex', gap:'1px', background:'white', padding:'3px 7px', borderRadius:'999px', boxShadow:'0 2px 6px rgba(0,0,0,0.2)', border:'2px solid #fbbf24' }}>
          {[1, 2, 3].map((i) => (
            <span key={i} style={{ fontSize:'12px', filter: i > stars ? 'grayscale(1) opacity(0.25)' : 'none' }}>⭐</span>
          ))}
        </span>
      )}
    </button>
  );
}

function TitleScreen({ onStartLevel, levelStars, totalFruitsCollected, soundEnabled, onToggleSound, onShowHowToPlay, onShowAbout, onShowSalon, speechLang, liliColor, welcomeBackMessage }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, #fce7f3 0%, #fbcfe8 30%, #fef3c7 65%, #d9f99d 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'0.85rem', padding:'1rem', textAlign:'center', overflow:'hidden' }}>
      <Cloud x={5} y={4} size={1.4} opacity={0.9} />
      <Cloud x={75} y={3} size={1} />
      <Cloud x={60} y={88} size={1.2} opacity={0.7} />
      <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      {/* How-to-play button (top-left) */}
      <button onClick={onShowHowToPlay} aria-label="How to play" style={{ position:'absolute', top:'2%', left:'3%', fontFamily:"'Fredoka', sans-serif", fontSize:'clamp(1rem, 3.5vw, 1.4rem)', background:'rgba(255, 255, 255, 0.85)', backdropFilter:'blur(8px)', border:'2px solid rgba(0,0,0,0.1)', padding:'0.45rem 0.7rem', borderRadius:'999px', cursor:'pointer', zIndex:25, boxShadow:'0 3px 8px rgba(0,0,0,0.15)', minWidth:'44px', minHeight:'44px' }}>
        ❓
      </button>
      {/* About button (bottom-left, small, parent-facing) */}
      <button onClick={onShowAbout} aria-label="About this app (parents)" style={{ position:'absolute', bottom:'2%', left:'3%', fontFamily:"'Fredoka', sans-serif", fontSize:'0.75rem', color:'#86198f', background:'rgba(255, 255, 255, 0.7)', backdropFilter:'blur(4px)', border:'1px solid rgba(157, 23, 77, 0.2)', padding:'0.35rem 0.7rem', borderRadius:'999px', cursor:'pointer', zIndex:25, opacity:0.7 }}>
        For Parents
      </button>
      {/* Total fruits collected stat (bottom-right) */}
      {totalFruitsCollected > 0 && (
        <div style={{ position:'absolute', bottom:'2%', right:'3%', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.7rem, 2vw, 0.85rem)', color:'#9d174d', background:'rgba(255, 255, 255, 0.92)', backdropFilter:'blur(8px)', padding:'0.4rem 0.85rem', borderRadius:'999px', border:'2px solid #f9a8d4', boxShadow:'0 2px 6px rgba(0,0,0,0.12)', zIndex:25 }}>
          🌟 {totalFruitsCollected} fruits!
        </div>
      )}
      {/* Style Lili button (top-right, below sound) */}
      <button onClick={onShowSalon} aria-label="Style Lili" style={{ position:'absolute', top:'2%', right:'calc(3% + 56px)', fontFamily:"'Fredoka', sans-serif", fontSize:'clamp(1rem, 3.5vw, 1.4rem)', background:'rgba(255, 255, 255, 0.85)', backdropFilter:'blur(8px)', border:'2px solid rgba(0,0,0,0.1)', padding:'0.45rem 0.7rem', borderRadius:'999px', cursor:'pointer', zIndex:25, boxShadow:'0 3px 8px rgba(0,0,0,0.15)', minWidth:'44px', minHeight:'44px' }}>
        🎨
      </button>
      {/* Welcome-back greeting */}
      {welcomeBackMessage && (
        <div style={{ position:'absolute', top:'12%', left:'50%', transform:'translateX(-50%)', background:'white', padding:'0.7rem 1.3rem', borderRadius:'999px', border:'3px solid #ec4899', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.9rem, 2.8vw, 1.2rem)', color:'#9d174d', boxShadow:'0 6px 18px rgba(236, 72, 153, 0.35)', maxWidth:'88vw', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', zIndex:28, animation:'welcomeBackIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
          {welcomeBackMessage}
        </div>
      )}
      <div style={{ position:'relative', zIndex:2 }}>
        <h1 style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(2.25rem, 8vw, 4.5rem)', color:'#9d174d', margin:0, lineHeight:1, textShadow:'3px 3px 0 #fbcfe8, 6px 6px 0 rgba(157, 23, 77, 0.15)', letterSpacing:'-0.02em' }}>Lili</h1>
        <p style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:500, fontSize:'clamp(0.95rem, 2.8vw, 1.2rem)', color:'#86198f', margin:'0.3rem 0 0' }}>Pick an Adventure</p>
      </div>
      <div style={{ display:'flex', gap:'0.4rem', alignItems:'flex-end', width:'min(340px, 80%)', height:'clamp(105px, 18vh, 160px)', position:'relative', zIndex:2 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            sound.pop();
            haptic(10);
            const isEs = (speechLang || '').startsWith('es');
            speech.speak(isEs ? '¡Hola!' : 'Hi!');
            // Trigger one-shot spin animation
            const el = e.currentTarget;
            el.style.animation = 'none';
            void el.offsetWidth; // restart animation
            el.style.animation = 'liliHappySpin 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)';
            setTimeout(() => { el.style.animation = 'liliBob 2.4s ease-in-out infinite'; }, 700);
          }}
          aria-label="Tap Lili to say hi"
          style={{ flex:1, animation:'liliBob 2.4s ease-in-out infinite', background:'transparent', border:'none', padding:0, cursor:'pointer' }}
        >
          <Lili facing="right" happy level={1} colorPreset={liliColor} />
        </button>
        <div style={{ flex:1, animation:'unicornBob 2.4s ease-in-out infinite 0.6s' }}><Unicorn facing="left" level={1} /></div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem', width:'min(330px, 92%)', position:'relative', zIndex:2 }}>
        <LevelButton onClick={() => onStartLevel(1)} stars={levelStars[1] || 0} gradient="linear-gradient(180deg, #ec4899 0%, #db2777 100%)" shadow="0 5px 0 #9d174d, 0 7px 16px rgba(219, 39, 119, 0.4)" label="🍓 Strawberry Day" />
        <LevelButton onClick={() => onStartLevel(2)} stars={levelStars[2] || 0} gradient="linear-gradient(180deg, #a855f7 0%, #7e22ce 100%)" shadow="0 5px 0 #581c87, 0 7px 16px rgba(126, 34, 206, 0.4)" label="✨ Magical Town" />
        <LevelButton onClick={() => onStartLevel(3)} stars={levelStars[3] || 0} gradient="linear-gradient(180deg, #fb923c 0%, #ea580c 100%)" shadow="0 5px 0 #9a3412, 0 7px 16px rgba(234, 88, 12, 0.4)" label="🛒 Supermarket" />
        <LevelButton onClick={() => onStartLevel(4)} stars={levelStars[4] || 0} gradient="linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)" shadow="0 5px 0 #1e3a8a, 0 7px 16px rgba(29, 78, 216, 0.4)" label="🐕 Mega Mart 🐱" />
        <LevelButton onClick={() => onStartLevel(5)} stars={levelStars[5] || 0} gradient="linear-gradient(180deg, #22c55e 0%, #15803d 100%)" shadow="0 5px 0 #14532d, 0 7px 16px rgba(21, 128, 61, 0.4)" label="🌈 Rainbow Garden" />
        <LevelButton onClick={() => onStartLevel(6)} stars={levelStars[6] || 0} gradient="linear-gradient(180deg, #f472b6 0%, #be185d 100%)" shadow="0 5px 0 #831843, 0 7px 16px rgba(190, 24, 93, 0.4)" label="🥪 Sharing Picnic 🐄" />
      </div>
      <p style={{ fontFamily:"'Fredoka', sans-serif", fontSize:'0.8rem', color:'#86198f', margin:'0.2rem 0 0', opacity:0.7, position:'relative', zIndex:2 }}>
        Tap where you want Lili to walk!
      </p>
    </div>
  );
}

const LEVELS = {
  1: { name:'Strawberry Day', total:8, label:'strawberries', accentColor:'#9d174d', accentColorLight:'#ec4899', counterBorder:'#f9a8d4', bg:'linear-gradient(180deg, #bae6fd 0%, #fce7f3 45%, #fef3c7 65%, #d9f99d 78%, #86efac 100%)' },
  2: { name:'Magical Town', total:6, label:'mangoes', accentColor:'#7e22ce', accentColorLight:'#a855f7', counterBorder:'#c084fc', bg:'linear-gradient(180deg, #312e81 0%, #6b21a8 25%, #be185d 55%, #ec4899 75%, #fda4af 100%)' },
  3: { name:'Supermarket', total:8, label:'fruits', accentColor:'#9a3412', accentColorLight:'#fb923c', counterBorder:'#fdba74', bg:'linear-gradient(180deg, #fef3c7 0%, #fde68a 18%, #fef9c3 32%, #f1f5f9 100%)' },
  4: { name:'Mega Mart', total:10, label:'grapes', accentColor:'#1e3a8a', accentColorLight:'#3b82f6', counterBorder:'#93c5fd', bg:'linear-gradient(180deg, #dbeafe 0%, #bfdbfe 22%, #f1f5f9 40%, #e2e8f0 100%)' },
  5: { name:'Rainbow Garden', total:9, label:'fruits', accentColor:'#15803d', accentColorLight:'#22c55e', counterBorder:'#86efac', bg:'linear-gradient(180deg, #fef3c7 0%, #fef9c3 25%, #d9f99d 50%, #86efac 100%)' },
  6: { name:'Sharing Picnic', total:5, label:'strawberries left', accentColor:'#9d174d', accentColorLight:'#ec4899', counterBorder:'#f9a8d4', bg:'linear-gradient(180deg, #fef3c7 0%, #fed7aa 25%, #fce7f3 65%, #d9f99d 100%)' },
};

const MATH_CONFIG = {
  1: { groups:[{ count:4, type:'strawberry', label:'Lili 🐴' },{ count:4, type:'strawberry', label:'Unicorn 🦄' }], total:8 },
  2: { groups:[{ count:3, type:'mango', label:'Lili 🐴' },{ count:3, type:'mango', label:'Unicorn 🦄' }], total:6 },
  3: { groups:[{ count:4, type:'banana', label:'Bananas 🍌' },{ count:4, type:'strawberry', label:'Berries 🍓' }], total:8 },
  4: { groups:[{ count:5, type:'grapes', label:'Cat 🐱' },{ count:5, type:'grapes', label:'Dog 🐕' }], total:10 },
  5: { groups:[{ count:3, type:'mango', label:'Lili 🐴' },{ count:3, type:'banana', label:'Cow 🐄' },{ count:3, type:'strawberry', label:'Catalino 🌈' }], total:9 },
  6: { operation:'sub', minuend:8, subtrahend:3, total:5, type:'strawberry', labelA:'Lili had 🐴', labelB:'Cow ate 🐄' },
};

const LILI_START = { x: 18, y: 78 };
const NPC_CONFIG = {
  1: [{ id:'unicorn', type:'unicorn', x: 84, y: 38 }],
  2: [{ id:'unicorn', type:'unicorn', x: 86, y: 70 }],
  3: [{ id:'unicorn', type:'unicorn', x: 84, y: 80 }],
  4: [
    { id:'cat', type:'cat', x: 78, y: 80 },
    { id:'dog', type:'dog', x: 92, y: 80 },
  ],
  5: [
    { id:'cow', type:'cow', x: 78, y: 78 },
    { id:'catalino', type:'catalino', x: 92, y: 80 },
  ],
  6: [
    { id:'cow', type:'cow', x: 80, y: 76 },
  ],
};

const LEVEL2_VISIBLE_MANGOES = [
  { x: 30, y: 82, type:'mango', id:'m1' },
  { x: 60, y: 78, type:'mango', id:'m2' },
  { x: 50, y: 62, type:'mango', id:'m3' },
];
const LEVEL2_MAGIC_OBJECTS = [
  { type:'chest', x: 18, y: 64, id:'mo1', mangoId:'mh1' },
  { type:'flower', x: 70, y: 50, id:'mo2', mangoId:'mh2' },
  { type:'mushroom', x: 38, y: 50, id:'mo3', mangoId:'mh3' },
];
const LEVEL3_ITEMS = [
  { x: 18, y: 42, type:'banana', id:'b1' },
  { x: 32, y: 50, type:'banana', id:'b2' },
  { x: 22, y: 62, type:'banana', id:'b3' },
  { x: 38, y: 70, type:'banana', id:'b4' },
  { x: 60, y: 45, type:'strawberry', id:'s1' },
  { x: 75, y: 55, type:'strawberry', id:'s2' },
  { x: 65, y: 68, type:'strawberry', id:'s3' },
  { x: 50, y: 60, type:'strawberry', id:'s4' },
];
const LEVEL4_ITEMS = [
  { x: 14, y: 42, type:'grapes', id:'g1' },
  { x: 30, y: 46, type:'grapes', id:'g2' },
  { x: 46, y: 42, type:'grapes', id:'g3' },
  { x: 60, y: 46, type:'grapes', id:'g4' },
  { x: 72, y: 42, type:'grapes', id:'g5' },
  { x: 22, y: 60, type:'grapes', id:'g6' },
  { x: 38, y: 64, type:'grapes', id:'g7' },
  { x: 54, y: 60, type:'grapes', id:'g8' },
  { x: 66, y: 64, type:'grapes', id:'g9' },
  { x: 30, y: 74, type:'grapes', id:'g10' },
];
const LEVEL5_ITEMS = [
  // 9 mixed fruits — 3 mangoes, 3 bananas, 3 strawberries
  { x: 18, y: 44, type:'mango', id:'lm1' },
  { x: 38, y: 50, type:'mango', id:'lm2' },
  { x: 60, y: 46, type:'mango', id:'lm3' },
  { x: 26, y: 60, type:'banana', id:'lb1' },
  { x: 50, y: 56, type:'banana', id:'lb2' },
  { x: 70, y: 60, type:'banana', id:'lb3' },
  { x: 14, y: 72, type:'strawberry', id:'ls1' },
  { x: 42, y: 74, type:'strawberry', id:'ls2' },
  { x: 64, y: 74, type:'strawberry', id:'ls3' },
];
// Level 6: 8 strawberries on a picnic blanket (visible from start, taps feed Cow)
const LEVEL6_ITEMS = [
  { x: 16, y: 42, type:'strawberry', id:'p1' },
  { x: 28, y: 42, type:'strawberry', id:'p2' },
  { x: 40, y: 42, type:'strawberry', id:'p3' },
  { x: 52, y: 42, type:'strawberry', id:'p4' },
  { x: 16, y: 56, type:'strawberry', id:'p5' },
  { x: 28, y: 56, type:'strawberry', id:'p6' },
  { x: 40, y: 56, type:'strawberry', id:'p7' },
  { x: 52, y: 56, type:'strawberry', id:'p8' },
];

function makeStrawberries() {
  const positions = [];
  let attempts = 0;
  while (positions.length < 8 && attempts < 300) {
    attempts++;
    const candidate = { x: 14+Math.random()*72, y: 32+Math.random()*48, type:'strawberry', id: 's'+Date.now()+Math.random() };
    if (candidate.x > 75 && candidate.y < 48) continue;
    if (Math.hypot(candidate.x-LILI_START.x, candidate.y-LILI_START.y) < 14) continue;
    if (positions.every((p) => Math.hypot(p.x-candidate.x, p.y-candidate.y) > 14)) positions.push(candidate);
  }
  return positions;
}

const NEXT_LEVEL_LABEL = { 1:'✨ Magical Town!', 2:'🛒 Supermarket!', 3:'🐕 Mega Mart!', 4:'🌈 Rainbow Garden!', 5:'🥪 Sharing Picnic!' };
const NEXT_LEVEL_GRADIENT = {
  1:'linear-gradient(180deg, #a855f7 0%, #7e22ce 100%)',
  2:'linear-gradient(180deg, #fb923c 0%, #ea580c 100%)',
  3:'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
  4:'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
  5:'linear-gradient(180deg, #f472b6 0%, #be185d 100%)',
};
const NEXT_LEVEL_SHADOW = {
  1:'0 5px 0 #581c87, 0 7px 18px rgba(126, 34, 206, 0.4)',
  2:'0 5px 0 #9a3412, 0 7px 18px rgba(234, 88, 12, 0.4)',
  3:'0 5px 0 #1e3a8a, 0 7px 18px rgba(29, 78, 216, 0.4)',
  4:'0 5px 0 #14532d, 0 7px 18px rgba(21, 128, 61, 0.4)',
  5:'0 5px 0 #831843, 0 7px 18px rgba(190, 24, 93, 0.4)',
};

function CelebrationScreen({ level, total, label, accentColor, stars, childName, totalFruitsCollected, levelName, speechLang, onAgain, onNext, onHome, onShowPostcard }) {
  const [phase, setPhase] = useState('intro');
  const [showButtons, setShowButtons] = useState(false);
  const [revealedStars, setRevealedStars] = useState(0);
  useEffect(() => {
    sound.win();
    // Speak personalized greeting on celebration
    speech.speak(buildGreatJobSpeech(childName, speech.lang));
    const t1 = setTimeout(() => setPhase('counting'), 600);
    return () => clearTimeout(t1);
  }, []);

  // After count-up finishes, reveal stars one by one
  function handleCountComplete() {
    setPhase('stars');
    const targetStars = Math.min(stars || 1, 3);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealedStars(i);
      sound.pop();
      if (i >= targetStars) {
        clearInterval(id);
        setTimeout(() => setShowButtons(true), 500);
      }
    }, 380);
  }

  return (
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(157, 23, 77, 0.55) 0%, rgba(126, 34, 206, 0.55) 100%)', backdropFilter:'blur(4px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'1.25rem', padding:'1.5rem', zIndex:60, animation:'celebrationFadeIn 0.5s ease-out' }}>
      <Confetti />
      <div style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.8rem, 6.5vw, 3.2rem)', color:'white', textShadow:'3px 3px 0 #ec4899, 6px 6px 0 rgba(0,0,0,0.3)', textAlign:'center', animation:'greatJobBounce 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)', zIndex:60, lineHeight:1.1 }}>
        GREAT JOB{childName ? `,` : '!'} {childName ? <span style={{ color:'#fde047', display:'inline-block' }}>{childName}!</span> : ''} 🎉
      </div>
      {phase === 'counting' && (
        <CountUpDisplay target={total} color={accentColor} label={`You collected ${total} ${label}!`} onComplete={handleCountComplete} />
      )}
      {phase === 'stars' && (
        <>
          <CountUpDisplay target={total} color={accentColor} label={`You collected ${total} ${label}!`} onComplete={() => {}} />
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', justifyContent:'center', zIndex:60 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ fontSize:'clamp(2.2rem, 7vw, 3.2rem)', filter: i > revealedStars ? 'grayscale(1) opacity(0.25)' : 'none', animation: i <= revealedStars ? 'starReveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none', transition:'filter 0.3s' }}>
                ⭐
              </div>
            ))}
          </div>
        </>
      )}
      {showButtons && (
        <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap', justifyContent:'center', animation:'fadeUp 0.6s ease-out', zIndex:60, maxWidth:'95vw' }}>
          <button onClick={onAgain} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.9rem, 2.8vw, 1.1rem)', color:'white', background:'linear-gradient(180deg, #ec4899 0%, #db2777 100%)', border:'none', padding:'0.7rem 1.2rem', borderRadius:'999px', boxShadow:'0 5px 0 #9d174d, 0 7px 18px rgba(219, 39, 119, 0.4)', cursor:'pointer', minHeight:'48px' }}>▶ Play Again</button>
          {onNext && (
            <button onClick={onNext} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.9rem, 2.8vw, 1.1rem)', color:'white', background:NEXT_LEVEL_GRADIENT[level], border:'none', padding:'0.7rem 1.2rem', borderRadius:'999px', boxShadow:NEXT_LEVEL_SHADOW[level], cursor:'pointer', minHeight:'48px' }}>
              {NEXT_LEVEL_LABEL[level]}
            </button>
          )}
          <button onClick={onShowPostcard} aria-label="Send postcard to family" style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.85rem, 2.6vw, 1rem)', color:'white', background:'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)', border:'none', padding:'0.7rem 1.1rem', borderRadius:'999px', boxShadow:'0 5px 0 #92400e, 0 7px 18px rgba(217, 119, 6, 0.4)', cursor:'pointer', minHeight:'48px' }}>
            📮 Send
          </button>
          <button onClick={onHome} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.9rem, 2.8vw, 1.1rem)', color:'#9d174d', background:'white', border:'3px solid #f9a8d4', padding:'0.55rem 1.1rem', borderRadius:'999px', cursor:'pointer', boxShadow:'0 4px 10px rgba(0,0,0,0.2)', minHeight:'48px' }}>🏠</button>
        </div>
      )}
    </div>
  );
}

export default function LiliGame() {
  const [level, setLevel] = useState(0);
  const [stage, setStage] = useState('title');
  const [lili, setLili] = useState({ ...LILI_START, facing: 'right' });
  const [target, setTarget] = useState(LILI_START);
  const [items, setItems] = useState([]);
  const [basket, setBasket] = useState([]);
  const [sparkles, setSparkles] = useState([]);
  const [floatingNumbers, setFloatingNumbers] = useState([]);
  const [npcs, setNpcs] = useState([]);
  const [hearts, setHearts] = useState([]);
  const [magicObjects, setMagicObjects] = useState([]);
  const [completedLevels, setCompletedLevels] = useState([]);
  const [levelPlayCounts, setLevelPlayCounts] = useState({});
  const [totalFruitsCollected, setTotalFruitsCollected] = useState(0);
  const [appReady, setAppReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showHint, setShowHint] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const [showParentGate, setShowParentGate] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [hasSeenTutorial, setHasSeenTutorial] = useState(true); // assume true until storage loads
  const [childName, setChildName] = useState('');
  const [speechLang, setSpeechLang] = useState('en-US');
  const [welcomeBackMessage, setWelcomeBackMessage] = useState(null);
  const [daysPlayed, setDaysPlayed] = useState([]);
  const [liliColor, setLiliColor] = useState(null); // null = level default
  const [showColorSalon, setShowColorSalon] = useState(false);
  const [postcardDataUrl, setPostcardDataUrl] = useState(null);
  const gameRef = useRef(null);

  useEffect(() => {
    (async () => {
      const savedSound = await storageGet('lili-sound', true);
      const savedCompleted = await storageGet('lili-completed', []);
      const savedTutorial = await storageGet('lili-tutorial-seen', false);
      const savedPlayCounts = await storageGet('lili-play-counts', {});
      const savedTotalFruits = await storageGet('lili-total-fruits', 0);
      const savedName = await storageGet('lili-child-name', '');
      const savedLang = await storageGet('lili-speech-lang', 'en-US');
      const savedLiliColor = await storageGet('lili-color', null);
      const savedDays = await storageGet('lili-days-played', []);
      const lastVisit = await storageGet('lili-last-visit', 0);
      const now = Date.now();
      storageSet('lili-last-visit', now);
      // Mark today as a play day
      const today = new Date().toISOString().slice(0, 10);
      const baseDays = Array.isArray(savedDays) ? savedDays : [];
      const allDays = baseDays.includes(today) ? baseDays : [...baseDays, today];
      if (!baseDays.includes(today)) storageSet('lili-days-played', allDays);
      setDaysPlayed(allDays);

      setSoundEnabled(savedSound); sound.enabled = savedSound; speech.enabled = savedSound;
      setCompletedLevels(Array.isArray(savedCompleted) ? savedCompleted : []);
      setLevelPlayCounts(typeof savedPlayCounts === 'object' && savedPlayCounts !== null ? savedPlayCounts : {});
      setTotalFruitsCollected(typeof savedTotalFruits === 'number' ? savedTotalFruits : 0);
      setChildName(typeof savedName === 'string' ? savedName : '');
      setSpeechLang(savedLang); speech.setLang(savedLang);
      setLiliColor(savedLiliColor);
      setHasSeenTutorial(savedTutorial);
      if (!savedTutorial) setShowHowToPlay(true);

      // Welcome-back greeting if returning after 12+ hours
      const hoursAway = lastVisit > 0 ? (now - lastVisit) / 3600000 : 0;
      if (hoursAway > 12) {
        const isEs = (savedLang || '').startsWith('es');
        const nm = (typeof savedName === 'string' ? savedName : '').trim();
        let msg;
        if (isEs) msg = nm ? `¡Te extrañé, ${nm}! 💕` : '¡Bienvenido de vuelta! 💕';
        else msg = nm ? `I missed you, ${nm}! 💕` : 'Welcome back! 💕';
        setWelcomeBackMessage(msg);
      }
      setStorageReady(true);
    })();
  }, []);

  function dismissTutorial() {
    setShowHowToPlay(false);
    setHasSeenTutorial(true);
    storageSet('lili-tutorial-seen', true);
  }

  useEffect(() => {
    sound.enabled = soundEnabled;
    speech.enabled = soundEnabled;
    if (!soundEnabled) sound.stopAmbient();
    if (storageReady) storageSet('lili-sound', soundEnabled);
  }, [soundEnabled, storageReady]);

  // Persist child name and speech language whenever they change
  useEffect(() => {
    if (storageReady) storageSet('lili-child-name', childName);
  }, [childName, storageReady]);

  useEffect(() => {
    speech.setLang(speechLang);
    if (storageReady) storageSet('lili-speech-lang', speechLang);
  }, [speechLang, storageReady]);

  useEffect(() => {
    if (storageReady) storageSet('lili-color', liliColor);
  }, [liliColor, storageReady]);

  // Speak the welcome-back message once shown, then auto-dismiss after 5s
  useEffect(() => {
    if (welcomeBackMessage && appReady) {
      speech.speak(welcomeBackMessage);
      const t = setTimeout(() => setWelcomeBackMessage(null), 5500);
      return () => clearTimeout(t);
    }
  }, [welcomeBackMessage, appReady]);

  function startLevel(lvl) {
    sound.pop();
    sound.startAmbient(lvl);
    setLevel(lvl); setBasket([]); setSparkles([]); setHearts([]); setFloatingNumbers([]);
    setLili({ ...LILI_START, facing: 'right' });
    setTarget(LILI_START);
    setNpcs(NPC_CONFIG[lvl].map((n) => ({ ...n })));

    if (lvl === 1) {
      setItems(makeStrawberries()); setMagicObjects([]); setStage('playing');
    } else if (lvl === 2) {
      setItems(LEVEL2_VISIBLE_MANGOES.map((m) => ({ ...m })));
      setMagicObjects(LEVEL2_MAGIC_OBJECTS.map((o) => ({ ...o, open: false })));
      setStage('intro');
    } else if (lvl === 3) {
      setItems(LEVEL3_ITEMS.map((m) => ({ ...m })));
      setMagicObjects([]);
      setStage('intro');
    } else if (lvl === 4) {
      setItems(LEVEL4_ITEMS.map((m) => ({ ...m })));
      setMagicObjects([]);
      setStage('intro');
    } else if (lvl === 5) {
      setItems(LEVEL5_ITEMS.map((m) => ({ ...m })));
      setMagicObjects([]);
      setStage('intro');
    } else {
      // Level 6: subtraction picnic - 8 strawberries laid out, kid taps to feed cow
      setItems(LEVEL6_ITEMS.map((m) => ({ ...m })));
      setMagicObjects([]);
      setStage('intro');
    }
  }

  function backToTitle() { sound.pop(); sound.stopAmbient(); setLevel(0); setStage('title'); setShowHint(false); }

  useEffect(() => {
    if (stage !== 'playing' && stage !== 'sharing') return;
    const id = setInterval(() => {
      setLili((prev) => {
        const dx = target.x - prev.x; const dy = target.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.6) return prev;
        const speed = 1.0;
        const ratio = Math.min(speed / dist, 1);
        const newFacing = dx > 0.2 ? 'right' : dx < -0.2 ? 'left' : prev.facing;
        return { x: prev.x + dx * ratio, y: prev.y + dy * ratio, facing: newFacing };
      });
    }, 40);
    return () => clearInterval(id);
  }, [target, stage]);

  useEffect(() => {
    if (stage !== 'playing') return;
    // Skip items already in collecting state to prevent re-triggering
    const hit = items.find((s) => !s.collecting && Math.hypot(s.x - lili.x, s.y - lili.y) < 5.5);
    if (!hit) return;
    // Mark as collecting (triggers leap animation), remove after animation
    setItems((prev) => prev.map((s) => s.id === hit.id ? { ...s, collecting: true } : s));
    setTimeout(() => {
      setItems((prev) => prev.filter((s) => s.id !== hit.id));
    }, 600);
    // Increment lifetime fruit counter
    setTotalFruitsCollected((t) => {
      const next = t + 1;
      storageSet('lili-total-fruits', next);
      return next;
    });
    setBasket((prev) => {
      // Guard: if already in basket, skip (defensive against double-fire)
      if (prev.some((b) => b.id === hit.id)) return prev;
      const next = [...prev, { id: hit.id, type: hit.type }];
      const sameTypeCount = next.filter((b) => b.type === hit.type).length;
      sound.collect(sameTypeCount - 1);
      haptic(15);
      const fnId = uid();
      const fnColor = hit.type === 'banana' ? '#ea580c' : hit.type === 'mango' ? '#dc2626' : hit.type === 'grapes' ? '#7e22ce' : '#dc2626';
      setFloatingNumbers((cur) => [...cur, { id: fnId, value: sameTypeCount, x: hit.x, y: hit.y, color: fnColor }]);
      setTimeout(() => setFloatingNumbers((cur) => cur.filter((n) => n.id !== fnId)), 1300);
      return next;
    });
    const sparkleId = uid();
    setSparkles((prev) => [...prev, { x: hit.x, y: hit.y, id: sparkleId }]);
    setTimeout(() => setSparkles((prev) => prev.filter((s) => s.id !== sparkleId)), 900);
    setShowHint(false);
  }, [lili, stage, items]);

  useEffect(() => {
    if (stage !== 'playing' || level !== 2) return;
    const near = magicObjects.find((o) => !o.open && Math.hypot(o.x - lili.x, o.y - lili.y) < 9);
    if (!near) return;
    sound.sparkle();
    haptic(20);
    setMagicObjects((prev) => prev.map((o) => (o.id === near.id ? { ...o, open: true } : o)));
    setTimeout(() => {
      setItems((prev) => [...prev, { x: near.x, y: near.y + 6, type: 'mango', id: near.mangoId, fresh: true }]);
    }, 400);
    const sparkleId = uid();
    setSparkles((prev) => [...prev, { x: near.x, y: near.y, id: sparkleId }]);
    setTimeout(() => setSparkles((prev) => prev.filter((s) => s.id !== sparkleId)), 900);
  }, [lili, stage, level, magicObjects]);

  useEffect(() => {
    const total = LEVELS[level]?.total;
    if (stage !== 'playing') return;
    // Level 6: trigger when 3 strawberries fed to Cow
    if (level === 6 && basket.length === 3) {
      const t = setTimeout(() => setStage('eating'), 700);
      return () => clearTimeout(t);
    }
    // Other levels: trigger when all items collected
    if (level !== 6 && total && items.length === 0 && basket.length === total) {
      const t = setTimeout(() => setStage('eating'), 700);
      return () => clearTimeout(t);
    }
  }, [items, basket, stage, level]);

  useEffect(() => {
    if (stage === 'intro') {
      // Speak the intro phrase aloud for non-readers (mirrors the visible bubble)
      const intro = buildIntroSpeech(level, speechLang);
      if (intro) speech.speak(intro);
      const t = setTimeout(() => setStage('playing'), 2800);
      return () => clearTimeout(t);
    }
    if (stage === 'eating') {
      // Level 1: unicorn calls. Level 6: cow ate, jump to math. Others: sharing.
      const next = level === 1 ? 'unicornCalls' : (level === 6 ? 'mathReveal' : 'sharing');
      const delay = level === 1 ? 2400 : 1800;
      const t = setTimeout(() => setStage(next), delay);
      return () => clearTimeout(t);
    }
    if (stage === 'unicornCalls') {
      const t = setTimeout(() => setStage('sharing'), 2200);
      return () => clearTimeout(t);
    }
  }, [stage, level, speechLang]);

  // Visual + audio tap hint when playing starts (helps non-readers know what to do)
  useEffect(() => {
    if (stage !== 'playing') { setShowHint(false); return; }
    setShowHint(true);
    // Speak the tap instruction shortly after the stage opens
    const speakTimer = setTimeout(() => {
      const phrase = buildTapHintSpeech(level, speechLang);
      if (phrase) speech.speak(phrase);
    }, 350);
    // Auto-hide visual hint after a generous window (handleTap dismisses earlier on first tap)
    const hideTimer = setTimeout(() => setShowHint(false), 6500);
    return () => { clearTimeout(speakTimer); clearTimeout(hideTimer); };
  }, [stage, level, speechLang]);

  // Sharing animation: levels 1-3 unicorn walks to Lili. Levels 4-5 (multi-NPC) just stay put.
  useEffect(() => {
    if (stage !== 'sharing') return;
    const isMultiNpc = level === 4 || level === 5;
    let intervalId;
    if (!isMultiNpc) {
      const targetX = lili.x + 14;
      const targetY = lili.y;
      intervalId = setInterval(() => {
        setNpcs((prev) => prev.map((n) => {
          if (n.id !== 'unicorn') return n;
          const dx = targetX - n.x; const dy = targetY - n.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1) return n;
          const speed = 0.9;
          const ratio = Math.min(speed / dist, 1);
          return { ...n, x: n.x + dx * ratio, y: n.y + dy * ratio };
        }));
      }, 40);
    }
    const sharingDuration = isMultiNpc ? 1900 : 2400;
    const t = setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      const newHearts = [];
      const npcCenterX = npcs.length > 0 ? npcs.reduce((s, n) => s + n.x, 0) / npcs.length : lili.x + 14;
      const centerX = (lili.x + npcCenterX) / 2;
      const centerY = lili.y - 8;
      for (let i = 0; i < 10; i++) {
        newHearts.push({ id: i, x: centerX + (Math.random() - 0.5) * 18, y: centerY, delay: i * 180 });
      }
      setHearts(newHearts);
      setStage('mathReveal');
    }, sharingDuration);
    return () => { if (intervalId) clearInterval(intervalId); clearTimeout(t); };
  }, [stage, level]);

  function onMathRevealComplete() {
    haptic([20, 50, 20, 50, 100]);
    setStage('celebration');
    // Bump per-level play count (drives the 1-3 star display)
    const newCounts = { ...levelPlayCounts, [level]: (levelPlayCounts[level] || 0) + 1 };
    setLevelPlayCounts(newCounts);
    if (storageReady) {
      storageSet('lili-play-counts', newCounts);
      if (!completedLevels.includes(level)) {
        const next = [...completedLevels, level];
        setCompletedLevels(next);
        storageSet('lili-completed', next);
      }
    }
  }

  function handleTap(e) {
    if (stage !== 'playing') return;
    const rect = gameRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setTarget({ x: Math.max(8, Math.min(92, x)), y: Math.max(28, Math.min(86, y)) });
    setShowHint(false);
  }

  const fontLink = (<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />);
  const globalStyles = (
    <style>{`
      @keyframes liliBob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
      @keyframes unicornBob { 0%, 100% { transform: translateY(0) rotate(2deg); } 50% { transform: translateY(-8px) rotate(-2deg); } }
      @keyframes strawberryBob { 0%, 100% { transform: translate(-50%, -50%) translateY(0); } 50% { transform: translate(-50%, -50%) translateY(-5px); } }
      @keyframes mangoEmerge { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0); } 70% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      @keyframes sparklePop { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0) rotate(0deg); } 50% { opacity: 1; transform: translate(-50%, -50%) scale(1.2) rotate(180deg); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8) rotate(360deg); } }
      @keyframes heartFloat { 0% { opacity: 0; transform: translateY(0) scale(0.5); } 20% { opacity: 1; transform: translateY(-10px) scale(1); } 100% { opacity: 0; transform: translateY(-80px) scale(1.2); } }
      @keyframes liliWalk { 0%, 100% { transform: translate(-50%, -50%) translateY(0); } 50% { transform: translate(-50%, -50%) translateY(-2px); } }
      @keyframes liliEat { 0%, 100% { transform: translate(-50%, -50%) rotate(-2deg); } 50% { transform: translate(-50%, -50%) rotate(2deg); } }
      @keyframes liliHappy { 0%, 100% { transform: translate(-50%, -50%) translateY(0) rotate(-1deg); } 50% { transform: translate(-50%, -50%) translateY(-8px) rotate(1deg); } }
      @keyframes pop { 0% { transform: scale(0); } 70% { transform: scale(1.3); } 100% { transform: scale(1); } }
      @keyframes fadeUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      @keyframes twinkle { 0%, 100% { opacity: 0.4; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
      @keyframes bubblePop { 0% { transform: translate(-50%, -100%) scale(0); } 100% { transform: translate(-50%, -100%) scale(1); } }
      @keyframes numberFloat { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); } 25% { opacity: 1; transform: translate(-50%, -70%) scale(1.4); } 100% { opacity: 0; transform: translate(-50%, -200%) scale(1); } }
      @keyframes numberPop { 0% { transform: scale(0.6); } 50% { transform: scale(1.18); } 100% { transform: scale(1); } }
      @keyframes confettiFall { 0% { transform: translate(0, -10vh) rotate(0deg); opacity: 1; } 90% { opacity: 1; } 100% { transform: translate(var(--drift, 0vw), 110vh) rotate(var(--rotation, 360deg)); opacity: 0; } }
      @keyframes hintPulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; } 50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; } }
      @keyframes celebrationFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes greatJobBounce { 0% { transform: scale(0) rotate(-10deg); } 60% { transform: scale(1.15) rotate(2deg); } 80% { transform: scale(0.95) rotate(-1deg); } 100% { transform: scale(1) rotate(0deg); } }
      @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
      @keyframes butterflyFlit1 { 0%, 100% { transform: translate(0, 0) rotate(-5deg); } 25% { transform: translate(20px, -15px) rotate(8deg); } 50% { transform: translate(-10px, -25px) rotate(-3deg); } 75% { transform: translate(15px, -10px) rotate(5deg); } }
      @keyframes butterflyFlit2 { 0%, 100% { transform: translate(0, 0) rotate(3deg); } 33% { transform: translate(-25px, -20px) rotate(-6deg); } 66% { transform: translate(10px, -30px) rotate(4deg); } }
      @keyframes splashLili { 0% { transform: scale(0) rotate(-30deg); opacity: 0; } 60% { transform: scale(1.2) rotate(8deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
      @keyframes splashTitle { 0% { transform: translateY(30px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      @keyframes splashTagline { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes splashSparkle { 0%, 100% { transform: scale(0.6) rotate(0deg); opacity: 0.4; } 50% { transform: scale(1.1) rotate(180deg); opacity: 1; } }
      @keyframes starReveal { 0% { transform: scale(0) rotate(-180deg); opacity: 0; } 70% { transform: scale(1.4) rotate(20deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
      @keyframes liliHappySpin { 0% { transform: scale(1) rotate(0deg); } 30% { transform: scale(1.15) rotate(-20deg); } 60% { transform: scale(1.2) rotate(360deg); } 100% { transform: scale(1) rotate(360deg); } }
      @keyframes welcomeBackIn { 0% { transform: translateX(-50%) translateY(-30px) scale(0.8); opacity: 0; } 100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; } }
      @keyframes tapHintGlow { 0%, 100% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.5; } 50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; } }
      @keyframes tapHintBounce { 0%, 100% { transform: translate(-50%, -100%) translateY(0); } 50% { transform: translate(-50%, -100%) translateY(-12px); } }
      @keyframes postcardZoom { 0% { transform: scale(0.7) rotate(-3deg); opacity: 0; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
      @keyframes fruitLeap { 0% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; } 30% { transform: translate(-50%, -110%) scale(1.55) rotate(120deg); opacity: 1; } 60% { transform: translate(-50%, -150%) scale(1.3) rotate(260deg); opacity: 0.95; } 100% { transform: translate(-50%, -180%) scale(0.35) rotate(380deg); opacity: 0; } }
      @keyframes cartBounce { 0% { transform: scale(1) translateY(0); } 25% { transform: scale(1.18, 0.88) translateY(-7px); } 55% { transform: scale(0.92, 1.1) translateY(3px); } 80% { transform: scale(1.04, 0.98) translateY(-1px); } 100% { transform: scale(1) translateY(0); } }
      @keyframes basketEmojiPop { 0% { transform: scale(1) rotate(0deg); } 30% { transform: scale(1.5) rotate(-12deg); } 60% { transform: scale(0.95) rotate(8deg); } 100% { transform: scale(1) rotate(0deg); } }
    `}</style>
  );

  if (level === 0) {
    return (
      <>
        {fontLink}{globalStyles}
        <div style={{ width:'100%', height:'100vh', position:'relative', overflow:'hidden', fontFamily:"'Fredoka', sans-serif" }}>
          {!appReady ? (
            <SplashScreen onDone={() => setAppReady(true)} />
          ) : (
            <>
              <TitleScreen
                onStartLevel={startLevel}
                levelStars={levelPlayCounts}
                totalFruitsCollected={totalFruitsCollected}
                soundEnabled={soundEnabled}
                onToggleSound={() => setSoundEnabled((s) => !s)}
                onShowHowToPlay={() => { sound.pop(); setShowHowToPlay(true); }}
                onShowAbout={() => { sound.pop(); setShowParentGate(true); }}
                onShowSalon={() => { sound.pop(); setShowColorSalon(true); }}
                speechLang={speechLang}
                liliColor={liliColor}
                welcomeBackMessage={welcomeBackMessage}
              />
              {showColorSalon && (
                <ColorSalon
                  currentColor={liliColor}
                  onSelect={setLiliColor}
                  onClose={() => setShowColorSalon(false)}
                  speechLang={speechLang}
                />
              )}
              {showHowToPlay && <HowToPlay onClose={dismissTutorial} />}
              {showParentGate && (
                <ParentGate
                  onSuccess={() => { setShowParentGate(false); setShowAbout(true); }}
                  onCancel={() => setShowParentGate(false)}
                />
              )}
              {showAbout && (
                <AboutScreen
                  onClose={() => setShowAbout(false)}
                  childName={childName}
                  setChildName={setChildName}
                  speechLang={speechLang}
                  setSpeechLang={setSpeechLang}
                  totalFruitsCollected={totalFruitsCollected}
                  completedLevels={completedLevels}
                  levelPlayCounts={levelPlayCounts}
                  daysPlayed={daysPlayed}
                  onResetProgress={() => {
                    // Wipe all persisted state and reset in-memory values
                    setCompletedLevels([]);
                    setLevelPlayCounts({});
                    setTotalFruitsCollected(0);
                    setChildName('');
                    setLiliColor(null);
                    setDaysPlayed([]);
                    [
                      'lili-completed', 'lili-play-counts', 'lili-total-fruits',
                      'lili-child-name', 'lili-color', 'lili-days-played',
                      'lili-tutorial-seen', 'lili-last-visit',
                    ].forEach((k) => storageSet(k, k === 'lili-play-counts' ? {} : (k === 'lili-completed' || k === 'lili-days-played') ? [] : (k === 'lili-total-fruits' || k === 'lili-last-visit') ? 0 : ''));
                    sound.win();
                  }}
                />
              )}
            </>
          )}
        </div>
      </>
    );
  }

  const config = LEVELS[level];
  const cartX = lili.x + (lili.facing === 'right' ? 7 : -7);
  const cartFlipped = lili.facing === 'left';
  const bananaCount = basket.filter((b) => b.type === 'banana').length;
  const strawberryCount = basket.filter((b) => b.type === 'strawberry').length;
  const grapesCount = basket.filter((b) => b.type === 'grapes').length;
  const mangoCount = basket.filter((b) => b.type === 'mango').length;

  return (
    <>
      {fontLink}{globalStyles}
      <div style={{ width:'100%', height:'100vh', position:'relative', overflow:'hidden', fontFamily:"'Fredoka', sans-serif", userSelect:'none' }}>
        <div ref={gameRef} onClick={handleTap} onTouchStart={handleTap} style={{ position:'absolute', inset:0, background:config.bg, cursor: stage==='playing'?'pointer':'default' }}>

          {level === 1 && (
            <>
              <div style={{ position:'absolute', top:'4%', right:'8%', width:'clamp(50px, 8vw, 80px)', height:'clamp(50px, 8vw, 80px)', borderRadius:'50%', background:'radial-gradient(circle, #fef9c3 0%, #fde047 70%, #facc15 100%)', boxShadow:'0 0 60px rgba(253, 224, 71, 0.6)' }} />
              <Cloud x={8} y={6} size={1.3} opacity={0.95} />
              <Cloud x={45} y={3} size={1} opacity={0.9} />
              <Cloud x={70} y={12} size={0.9} opacity={0.85} />
              <div style={{ position:'absolute', left:'38%', top:'14%', width:'24%', height:'14%' }}><ZooSign /></div>
              <div style={{ position:'absolute', left:0, top:'23%', width:'100%', height:'7%' }}><Fence /></div>
              <div style={{ position:'absolute', left:'4%', top:'85%', width:'4%', height:'6%' }}><Flower color="#f472b6" /></div>
              <div style={{ position:'absolute', left:'26%', top:'92%', width:'3.5%', height:'5%' }}><Flower color="#facc15" /></div>
              <div style={{ position:'absolute', left:'48%', top:'88%', width:'4%', height:'6%' }}><Flower color="#a855f7" /></div>
              <div style={{ position:'absolute', left:'72%', top:'93%', width:'3.5%', height:'5%' }}><Flower color="#fb7185" /></div>
              <div style={{ position:'absolute', left:'92%', top:'87%', width:'4%', height:'6%' }}><Flower color="#facc15" /></div>
            </>
          )}

          {level === 2 && (
            <>
              {[{x:6,y:5},{x:14,y:12},{x:22,y:4},{x:30,y:10},{x:42,y:6},{x:50,y:13},{x:58,y:4},{x:66,y:10},{x:78,y:6},{x:88,y:12},{x:12,y:22},{x:36,y:22},{x:64,y:22},{x:86,y:22}].map((s,i) => (<Star key={i} x={s.x} y={s.y} size={1+(i%3)*0.3} />))}
              <div style={{ position:'absolute', top:'4%', left:'8%', width:'clamp(50px, 8vw, 80px)', height:'clamp(50px, 8vw, 80px)' }}><CrescentMoon /></div>
              <div style={{ position:'absolute', left:'4%', top:'30%', width:'14%', height:'28%' }}><MushroomHouse capColor="#ef4444" spotColor="#fef3c7" /></div>
              <div style={{ position:'absolute', left:'82%', top:'24%', width:'14%', height:'28%' }}><MushroomHouse capColor="#3b82f6" spotColor="#fef3c7" /></div>
              <div style={{ position:'absolute', left:'60%', top:'32%', width:'11%', height:'22%' }}><MushroomHouse capColor="#f97316" spotColor="#fef3c7" /></div>
              <div style={{ position:'absolute', left:'22%', top:'28%', width:'12%', height:'26%' }}><SparkleTree /></div>
              <div style={{ position:'absolute', left:'44%', top:'32%', width:'13%', height:'24%' }}><MagicFountain /></div>
              <div style={{ position:'absolute', left:0, bottom:0, width:'100%', height:'38%', background:'radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.2) 0%, rgba(168,85,247,0) 60%), linear-gradient(180deg, #7c3aed 0%, #5b21b6 100%)' }} />
              <svg style={{ position:'absolute', left:0, bottom:0, width:'100%', height:'38%', opacity:0.4 }} viewBox="0 0 400 152" preserveAspectRatio="none">
                {Array.from({ length: 50 }).map((_, i) => {
                  const cx = (i % 10) * 40 + ((Math.floor(i / 10) % 2) * 20) + 20;
                  const cy = Math.floor(i / 10) * 30 + 15;
                  return <ellipse key={i} cx={cx} cy={cy} rx="14" ry="9" fill="#a78bfa" stroke="#5b21b6" strokeWidth="1" />;
                })}
              </svg>
              {magicObjects.map((o) => {
                const Component = o.type === 'chest' ? MagicChest : o.type === 'flower' ? MagicGiantFlower : MagicMushroomItem;
                return (
                  <div key={o.id} style={{ position:'absolute', left:`${o.x}%`, top:`${o.y}%`, transform:'translate(-50%, -50%)', width:'clamp(60px, 11vw, 100px)', height:'clamp(60px, 11vw, 100px)', pointerEvents:'none', zIndex:4 }}>
                    <Component open={o.open} />
                  </div>
                );
              })}
            </>
          )}

          {level === 3 && (
            <>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:'20%', background:'linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)', borderBottom:'4px solid #fbbf24' }} />
              <div style={{ position:'absolute', top:'3%', left:'50%', transform:'translateX(-50%)', width:'46%', height:'12%' }}><SupermarketSign /></div>
              <div style={{ position:'absolute', top:'5%', left:'2%', width:'24%', height:'11%' }}><GroceryShelf palette="cool" /></div>
              <div style={{ position:'absolute', top:'5%', right:'2%', width:'24%', height:'11%' }}><GroceryShelf palette="warm" /></div>
              <div style={{ position:'absolute', top:'24%', left:'8%', width:'26%', height:'8%' }}><FruitDisplay type="banana" /></div>
              <div style={{ position:'absolute', top:'24%', right:'8%', width:'26%', height:'8%' }}><FruitDisplay type="strawberry" /></div>
              <div style={{ position:'absolute', top:'34%', left:0, right:0, bottom:0, background:'repeating-conic-gradient(from 0deg at 50% 50%, #f1f5f9 0deg 90deg, #e2e8f0 90deg 180deg, #f1f5f9 180deg 270deg, #e2e8f0 270deg 360deg)', backgroundSize:'6% 9%', opacity:0.7 }} />
              <div style={{ position:'absolute', top:'34%', left:0, right:0, height:'2px', background:'#cbd5e1', opacity:0.6 }} />
            </>
          )}

          {level === 4 && (
            <>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:'18%', background:'linear-gradient(180deg, #1d4ed8 0%, #2563eb 100%)', borderBottom:'4px solid #fbbf24' }} />
              <div style={{ position:'absolute', top:'2%', left:'50%', transform:'translateX(-50%)', width:'52%', height:'13%' }}><MegaMartSign /></div>
              <div style={{ position:'absolute', top:'5%', left:'2%', width:'18%', height:'11%' }}><GroceryShelf palette="cool" /></div>
              <div style={{ position:'absolute', top:'5%', right:'2%', width:'18%', height:'11%' }}><GroceryShelf palette="warm" /></div>
              {/* AISLE 1 / AISLE 2 signs */}
              <div style={{ position:'absolute', top:'21%', left:'12%', width:'12%', height:'9%' }}>
                <svg viewBox="0 0 80 50" style={{ width:'100%', height:'100%' }}>
                  <rect x="38" y="25" width="4" height="25" fill="#64748b" />
                  <rect x="6" y="6" width="68" height="22" rx="3" fill="white" stroke="#1d4ed8" strokeWidth="2.5" />
                  <text x="40" y="22" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="11" fill="#1d4ed8">AISLE 1</text>
                </svg>
              </div>
              <div style={{ position:'absolute', top:'21%', right:'12%', width:'12%', height:'9%' }}>
                <svg viewBox="0 0 80 50" style={{ width:'100%', height:'100%' }}>
                  <rect x="38" y="25" width="4" height="25" fill="#64748b" />
                  <rect x="6" y="6" width="68" height="22" rx="3" fill="white" stroke="#1d4ed8" strokeWidth="2.5" />
                  <text x="40" y="22" textAnchor="middle" fontFamily="'Fredoka', sans-serif" fontWeight="700" fontSize="11" fill="#1d4ed8">AISLE 2</text>
                </svg>
              </div>
              {/* Produce displays at top — Olivia "sees inherits and produce before finding the grapes" */}
              <div style={{ position:'absolute', top:'21%', left:'40%', width:'20%', height:'12%' }}><ProducePalette /></div>
              {/* Pallet stacks at edges (decorative wholesale vibe) */}
              <div style={{ position:'absolute', top:'52%', left:'1%', width:'10%', height:'20%' }}><PalletStack color="#dc2626" /></div>
              <div style={{ position:'absolute', top:'52%', right:'1%', width:'10%', height:'20%' }}><PalletStack color="#f97316" /></div>
              {/* Polished floor */}
              <div style={{ position:'absolute', top:'34%', left:0, right:0, bottom:0, background:'repeating-conic-gradient(from 0deg at 50% 50%, #f1f5f9 0deg 90deg, #e2e8f0 90deg 180deg, #f1f5f9 180deg 270deg, #e2e8f0 270deg 360deg)', backgroundSize:'5% 8%', opacity:0.7 }} />
              <div style={{ position:'absolute', top:'34%', left:0, right:0, height:'2px', background:'#cbd5e1', opacity:0.6 }} />
            </>
          )}

          {level === 5 && (
            <>
              {/* Sun */}
              <div style={{ position:'absolute', top:'4%', right:'8%', width:'clamp(50px, 9vw, 90px)', height:'clamp(50px, 9vw, 90px)', borderRadius:'50%', background:'radial-gradient(circle, #fef9c3 0%, #fde047 60%, #facc15 100%)', boxShadow:'0 0 70px rgba(253, 224, 71, 0.7)' }} />
              {/* Soft clouds */}
              <Cloud x={4} y={4} size={1.3} opacity={0.95} />
              <Cloud x={28} y={9} size={1} opacity={0.85} />
              <Cloud x={50} y={3} size={1.1} opacity={0.9} />
              {/* Big rainbow arch in the back */}
              <div style={{ position:'absolute', top:'10%', left:'10%', width:'80%', height:'40%', pointerEvents:'none' }}>
                <RainbowArch />
              </div>
              {/* Fruit trees on the sides */}
              <div style={{ position:'absolute', left:'1%', top:'24%', width:'18%', height:'42%', pointerEvents:'none' }}>
                <FruitTree fruitType="mango" />
              </div>
              <div style={{ position:'absolute', right:'1%', top:'26%', width:'18%', height:'42%', pointerEvents:'none' }}>
                <FruitTree fruitType="banana" />
              </div>
              <div style={{ position:'absolute', left:'42%', top:'18%', width:'15%', height:'34%', pointerEvents:'none' }}>
                <FruitTree fruitColor="#ef4444" />
              </div>
              {/* Heart flowers along the bottom */}
              <div style={{ position:'absolute', left:'4%', top:'88%', width:'4%', height:'8%' }}><HeartFlower color="#ec4899" /></div>
              <div style={{ position:'absolute', left:'14%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#f97316" /></div>
              <div style={{ position:'absolute', left:'26%', top:'88%', width:'4%', height:'8%' }}><HeartFlower color="#fde047" /></div>
              <div style={{ position:'absolute', left:'38%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#22c55e" /></div>
              <div style={{ position:'absolute', left:'52%', top:'88%', width:'4%', height:'8%' }}><HeartFlower color="#3b82f6" /></div>
              <div style={{ position:'absolute', left:'64%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#a855f7" /></div>
              <div style={{ position:'absolute', left:'76%', top:'88%', width:'4%', height:'8%' }}><HeartFlower color="#ec4899" /></div>
              <div style={{ position:'absolute', left:'88%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#f97316" /></div>
              {/* Floating butterflies */}
              <div style={{ position:'absolute', left:'24%', top:'30%', width:'8%', height:'8%', animation:'butterflyFlit1 6s ease-in-out infinite', pointerEvents:'none' }}>
                <GardenButterfly color1="#ec4899" color2="#a855f7" />
              </div>
              <div style={{ position:'absolute', left:'72%', top:'34%', width:'8%', height:'8%', animation:'butterflyFlit2 7s ease-in-out infinite', pointerEvents:'none' }}>
                <GardenButterfly color1="#fbbf24" color2="#22c55e" />
              </div>
              <div style={{ position:'absolute', left:'48%', top:'62%', width:'7%', height:'7%', animation:'butterflyFlit1 5s ease-in-out infinite 1s', pointerEvents:'none' }}>
                <GardenButterfly color1="#3b82f6" color2="#06b6d4" />
              </div>
              {/* Grass at the very bottom */}
              <svg style={{ position:'absolute', left:0, bottom:0, width:'100%', height:'8%' }} viewBox="0 0 400 30" preserveAspectRatio="none">
                <path d="M 0 30 L 0 15 Q 10 5 20 15 Q 30 5 40 15 Q 50 5 60 15 Q 70 5 80 15 Q 90 5 100 15 Q 110 5 120 15 Q 130 5 140 15 Q 150 5 160 15 Q 170 5 180 15 Q 190 5 200 15 Q 210 5 220 15 Q 230 5 240 15 Q 250 5 260 15 Q 270 5 280 15 Q 290 5 300 15 Q 310 5 320 15 Q 330 5 340 15 Q 350 5 360 15 Q 370 5 380 15 Q 390 5 400 15 L 400 30 Z" fill="#16a34a" />
              </svg>
            </>
          )}

          {level === 6 && (
            <>
              {/* Sun */}
              <div style={{ position:'absolute', top:'5%', right:'8%', width:'clamp(46px, 8vw, 80px)', height:'clamp(46px, 8vw, 80px)', borderRadius:'50%', background:'radial-gradient(circle, #fef9c3 0%, #fde047 60%, #facc15 100%)', boxShadow:'0 0 60px rgba(253, 224, 71, 0.65)' }} />
              <Cloud x={6} y={5} size={1.3} opacity={0.95} />
              <Cloud x={42} y={3} size={1} opacity={0.9} />
              {/* Picnic blanket - red/white checker */}
              <div style={{ position:'absolute', left:'10%', top:'34%', width:'56%', height:'34%', borderRadius:'12px', background:'repeating-linear-gradient(45deg, #ef4444 0%, #ef4444 20px, #fef3c7 20px, #fef3c7 40px)', boxShadow:'0 8px 20px rgba(0,0,0,0.15)', transform:'rotate(-2deg)', border:'4px solid #dc2626' }} />
              {/* Picnic basket */}
              <div style={{ position:'absolute', left:'66%', top:'52%', width:'12%', height:'12%' }}>
                <svg viewBox="0 0 100 100" style={{ width:'100%', height:'100%' }}>
                  <ellipse cx="50" cy="92" rx="42" ry="6" fill="#000" opacity="0.2" />
                  <path d="M 18 50 Q 18 90 30 92 L 70 92 Q 82 90 82 50 Z" fill="#a16207" stroke="#7c2d12" strokeWidth="2" />
                  <line x1="22" y1="55" x2="78" y2="55" stroke="#7c2d12" strokeWidth="1.5" />
                  <line x1="20" y1="65" x2="80" y2="65" stroke="#7c2d12" strokeWidth="1.5" />
                  <line x1="22" y1="75" x2="78" y2="75" stroke="#7c2d12" strokeWidth="1.5" />
                  <line x1="20" y1="85" x2="80" y2="85" stroke="#7c2d12" strokeWidth="1.5" />
                  <path d="M 22 50 Q 50 20 78 50" stroke="#a16207" strokeWidth="6" fill="none" strokeLinecap="round" />
                  <rect x="14" y="46" width="72" height="10" rx="2" fill="#92400e" />
                </svg>
              </div>
              {/* Heart flowers along the bottom */}
              <div style={{ position:'absolute', left:'4%', top:'87%', width:'4%', height:'8%' }}><HeartFlower color="#ec4899" /></div>
              <div style={{ position:'absolute', left:'18%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#fde047" /></div>
              <div style={{ position:'absolute', left:'76%', top:'88%', width:'4%', height:'8%' }}><HeartFlower color="#a855f7" /></div>
              <div style={{ position:'absolute', left:'90%', top:'92%', width:'3.5%', height:'6%' }}><HeartFlower color="#22c55e" /></div>
              {/* Grass at bottom */}
              <svg style={{ position:'absolute', left:0, bottom:0, width:'100%', height:'8%' }} viewBox="0 0 400 30" preserveAspectRatio="none">
                <path d="M 0 30 L 0 15 Q 10 5 20 15 Q 30 5 40 15 Q 50 5 60 15 Q 70 5 80 15 Q 90 5 100 15 Q 110 5 120 15 Q 130 5 140 15 Q 150 5 160 15 Q 170 5 180 15 Q 190 5 200 15 Q 210 5 220 15 Q 230 5 240 15 Q 250 5 260 15 Q 270 5 280 15 Q 290 5 300 15 Q 310 5 320 15 Q 330 5 340 15 Q 350 5 360 15 Q 370 5 380 15 Q 390 5 400 15 L 400 30 Z" fill="#16a34a" />
              </svg>
            </>
          )}

          {items.map((s) => {
            const ItemComp = ITEM_COMPONENTS[s.type] || Strawberry;
            const isCollecting = s.collecting;
            // Bigger fruits + leap animation when collected
            return (
              <div key={s.id} style={{ position:'absolute', left:`${s.x}%`, top:`${s.y}%`, width:'clamp(48px, 8.5vw, 72px)', height:'clamp(60px, 10vw, 90px)', transform:'translate(-50%, -50%)', animation: isCollecting ? 'fruitLeap 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : (s.fresh ? 'mangoEmerge 0.6s ease-out, strawberryBob 1.6s ease-in-out infinite 0.6s' : 'strawberryBob 1.6s ease-in-out infinite'), pointerEvents:'none', zIndex: isCollecting ? 30 : 5, willChange:'transform, opacity' }}>
                <ItemComp />
              </div>
            );
          })}

          {sparkles.map((s) => (
            <div key={s.id} style={{ position:'absolute', left:`${s.x}%`, top:`${s.y}%`, width:'clamp(50px, 9vw, 90px)', height:'clamp(50px, 9vw, 90px)', transform:'translate(-50%, -50%)', animation:'sparklePop 0.9s ease-out forwards', pointerEvents:'none', zIndex:15 }}>
              <Sparkle />
            </div>
          ))}

          {floatingNumbers.map((n) => (<FloatingNumber key={n.id} value={n.value} x={n.x} y={n.y} color={n.color} />))}

          {hearts.map((h) => (
            <div key={h.id} style={{ position:'absolute', left:`${h.x}%`, top:`${h.y}%`, fontSize:'clamp(22px, 4.5vw, 36px)', animation:`heartFloat 2.5s ease-out forwards ${h.delay}ms`, animationFillMode:'both', pointerEvents:'none', zIndex:20 }}>💕</div>
          ))}

          {/* NPCs */}
          {npcs.map((n) => {
            const Component = NPC_COMPONENTS[n.type] || Unicorn;
            return (
              <div key={n.id} style={{ position:'absolute', left:`${n.x}%`, top:`${n.y}%`, width:'clamp(110px, 19vw, 175px)', height:'clamp(85px, 14vw, 135px)', transform:'translate(-50%, -50%)', transition:'left 0.04s linear, top 0.04s linear', zIndex:10 }}>
                <Component facing={n.x > lili.x ? 'left' : 'right'} level={level} />
              </div>
            );
          })}

          <div style={{ position:'absolute', left:`${lili.x}%`, top:`${lili.y}%`, width:'clamp(110px, 19vw, 175px)', height:'clamp(85px, 14vw, 135px)', transform:'translate(-50%, -50%)', transition:'left 0.04s linear, top 0.04s linear', zIndex:11, animation: stage==='eating'?'liliEat 0.4s ease-in-out infinite':(stage==='celebration'||stage==='sharing'||stage==='mathReveal')?'liliHappy 0.6s ease-in-out infinite':'liliWalk 0.5s ease-in-out infinite' }}>
            <Lili facing={lili.facing} happy={stage==='celebration'||stage==='eating'||stage==='sharing'||stage==='mathReveal'} level={level} colorPreset={liliColor} />
          </div>

          {(level === 3 || level === 4) && stage !== 'celebration' && stage !== 'mathReveal' && (
            <div style={{ position:'absolute', left:`${cartX}%`, top:`${lili.y + 4}%`, width:'clamp(105px, 18vw, 165px)', height:'clamp(90px, 15vw, 138px)', transform: cartFlipped?'translate(-50%, -50%) scaleX(-1)':'translate(-50%, -50%)', transition:'left 0.04s linear, top 0.04s linear', zIndex:12, pointerEvents:'none' }}>
              <div key={basket.length} style={{ width:'100%', height:'100%', animation: basket.length > 0 ? 'cartBounce 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)':'none', transformOrigin:'center bottom' }}>
                <ShoppingCart items={basket} />
              </div>
            </div>
          )}

          {/* Visual tap hint for non-readers: pulsing glow + bouncing finger on the nearest item */}
          {showHint && stage === 'playing' && items.length > 0 && (() => {
            const nearest = items.reduce((best, it) => {
              const d = Math.hypot(it.x - lili.x, it.y - lili.y);
              return d < best.d ? { d, item: it } : best;
            }, { d: Infinity, item: null }).item;
            if (!nearest) return null;
            return (
              <Fragment key={nearest.id}>
                {/* Pulsing golden glow around target */}
                <div style={{
                  position:'absolute', left:`${nearest.x}%`, top:`${nearest.y}%`,
                  width:'clamp(80px, 16vw, 130px)', height:'clamp(80px, 16vw, 130px)',
                  transform:'translate(-50%, -50%)', borderRadius:'50%',
                  background:'radial-gradient(circle, rgba(251, 191, 36, 0.6) 0%, rgba(251, 191, 36, 0.25) 40%, rgba(251, 191, 36, 0) 70%)',
                  animation:'tapHintGlow 1.4s ease-in-out infinite',
                  pointerEvents:'none', zIndex:14,
                }} />
                {/* Bouncing finger pointing down at the item */}
                <div style={{
                  position:'absolute', left:`${nearest.x}%`, top:`${nearest.y - 11}%`,
                  transform:'translate(-50%, -100%)',
                  fontSize:'clamp(2.4rem, 7vw, 3.6rem)',
                  animation:'tapHintBounce 0.9s ease-in-out infinite',
                  pointerEvents:'none', zIndex:19,
                  filter:'drop-shadow(0 4px 6px rgba(0,0,0,0.35))',
                }}>
                  👇
                </div>
              </Fragment>
            );
          })()}

          {/* Speech bubbles */}
          {stage === 'intro' && level === 2 && npcs[0] && (<SpeechBubble text="Get mangoes for us! 🥭" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#ec4899" />)}
          {stage === 'intro' && level === 3 && npcs[0] && (<SpeechBubble text="Let's go shopping! 🛒" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#ea580c" />)}
          {stage === 'intro' && level === 4 && npcs[0] && (<SpeechBubble text="Get grapes for us! 🍇" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#7e22ce" />)}
          {stage === 'intro' && level === 5 && npcs[0] && (<SpeechBubble text="Pick lots of fruits! 🌈" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#15803d" />)}
          {stage === 'intro' && level === 6 && npcs[0] && (<SpeechBubble text="Mooo! Can I have some? 🐄" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#1e293b" />)}
          {stage === 'eating' && level !== 6 && (<SpeechBubble text={level===2?'Yum yum! 🥭':level===3?'Yum yum! 🍌🍓':level===4?'Yum yum! 🍇':level===5?'Yum yum! 🍓🍌🥭':'Yum yum! 🍓'} x={lili.x} y={lili.y - 12} side="right" color={level===2?'#15803d':level===3?'#ea580c':level===4?'#7e22ce':level===5?'#15803d':'#9333ea'} />)}
          {stage === 'eating' && level === 6 && npcs[0] && (<SpeechBubble text="Yum! Thank you! 💕" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#1e293b" />)}
          {(stage === 'unicornCalls' || (stage === 'sharing' && level === 1)) && npcs[0] && (<SpeechBubble text="Oh! I want some too! 🍓" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#9333ea" />)}
          {stage === 'sharing' && level === 2 && npcs[0] && (<SpeechBubble text="Mmm thank you! 💕" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#ec4899" />)}
          {stage === 'sharing' && level === 3 && npcs[0] && (<SpeechBubble text="Yummy! Thank you! 💕" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#ea580c" />)}
          {stage === 'sharing' && level === 4 && npcs[0] && npcs[1] && (
            <>
              <SpeechBubble text="Meow! Thank you! 💕" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#ea580c" />
              <SpeechBubble text="Woof! Yummy! 💕" x={npcs[1].x} y={npcs[1].y - 12} side="left" color="#92400e" />
            </>
          )}
          {stage === 'sharing' && level === 5 && npcs[0] && npcs[1] && (
            <>
              <SpeechBubble text="Moo! So yummy! 🐄💕" x={npcs[0].x} y={npcs[0].y - 12} side="left" color="#1e293b" />
              <SpeechBubble text="Meow! Rainbow yum! 🌈" x={npcs[1].x} y={npcs[1].y - 12} side="left" color="#ec4899" />
            </>
          )}
        </div>

        {(stage === 'playing' || stage === 'intro') && (
          <>
            <button onClick={() => { sound.pop(); setShowPauseMenu(true); }} aria-label="Pause" style={{ position:'absolute', top:'2%', left:'3%', fontFamily:"'Fredoka', sans-serif", fontWeight:600, fontSize:'clamp(0.85rem, 2.5vw, 1rem)', color: config.accentColor, background:'rgba(255, 255, 255, 0.85)', backdropFilter:'blur(8px)', border:`2px solid ${config.counterBorder}`, padding:'0.45rem 0.9rem', borderRadius:'999px', cursor:'pointer', zIndex:25, boxShadow:'0 3px 8px rgba(0,0,0,0.15)', minWidth:'44px', minHeight:'44px' }}>⏸️</button>
            <SoundToggle enabled={soundEnabled} onToggle={() => setSoundEnabled((s) => !s)} />
          </>
        )}

        {(stage === 'playing' || stage === 'eating' || stage === 'intro') && (
          <div style={{ position:'absolute', top:'2%', left:'50%', transform:'translateX(-50%)', background:'rgba(255, 255, 255, 0.92)', backdropFilter:'blur(8px)', padding:'0.45rem 0.9rem', borderRadius:'999px', border:`3px solid ${config.counterBorder}`, boxShadow:'0 4px 14px rgba(0,0,0,0.2)', display:'flex', gap:'0.4rem', alignItems:'center', zIndex:25, maxWidth:'90%' }}>
            <span key={`emo-${basket.length}`} style={{ fontSize:'clamp(26px, 5vw, 36px)', display:'inline-block', animation: basket.length > 0 ? 'basketEmojiPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none' }}>{(level === 3 || level === 4) ? '🛒' : '🧺'}</span>
            {level === 3 ? (
              <>
                <span style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.2rem, 4vw, 1.6rem)', color:'#a16207', minWidth:'40px', textAlign:'center' }}>
                  <span style={{ fontSize:'clamp(20px, 4vw, 28px)' }}>🍌</span> {bananaCount}/4
                </span>
                <span style={{ width:'6px', display:'inline-block', borderLeft:'2px solid #fbbf24', height:'20px' }} />
                <span style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.2rem, 4vw, 1.6rem)', color:'#9d174d', minWidth:'40px', textAlign:'center' }}>
                  <span style={{ fontSize:'clamp(20px, 4vw, 28px)' }}>🍓</span> {strawberryCount}/4
                </span>
              </>
            ) : level === 4 ? (
              <span key={grapesCount} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 5vw, 2rem)', color:'#7e22ce', minWidth:'80px', textAlign:'center', animation: grapesCount > 0 ? 'numberPop 0.3s ease-out':'none' }}>
                <span style={{ fontSize:'clamp(20px, 4vw, 28px)' }}>🍇</span> {grapesCount} <span style={{ color:'#94a3b8', fontSize:'0.7em' }}>/10</span>
              </span>
            ) : level === 5 ? (
              <>
                <span style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1rem, 3.5vw, 1.4rem)', color:'#dc2626', minWidth:'30px', textAlign:'center' }}>
                  <span style={{ fontSize:'clamp(18px, 3.5vw, 24px)' }}>🥭</span> {mangoCount}/3
                </span>
                <span style={{ width:'4px', display:'inline-block', borderLeft:'2px solid #86efac', height:'18px' }} />
                <span style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1rem, 3.5vw, 1.4rem)', color:'#a16207', minWidth:'30px', textAlign:'center' }}>
                  <span style={{ fontSize:'clamp(18px, 3.5vw, 24px)' }}>🍌</span> {bananaCount}/3
                </span>
                <span style={{ width:'4px', display:'inline-block', borderLeft:'2px solid #86efac', height:'18px' }} />
                <span style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1rem, 3.5vw, 1.4rem)', color:'#9d174d', minWidth:'30px', textAlign:'center' }}>
                  <span style={{ fontSize:'clamp(18px, 3.5vw, 24px)' }}>🍓</span> {strawberryCount}/3
                </span>
              </>
            ) : level === 6 ? (
              <span key={items.length} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 5vw, 2rem)', color:'#9d174d', minWidth:'80px', textAlign:'center', animation: basket.length > 0 ? 'numberPop 0.3s ease-out':'none' }}>
                <span style={{ fontSize:'clamp(20px, 4vw, 28px)' }}>🍓</span> {items.length} <span style={{ color:'#94a3b8', fontSize:'0.7em' }}>left</span>
              </span>
            ) : (
              <span key={basket.length} style={{ fontFamily:"'Fredoka', sans-serif", fontWeight:700, fontSize:'clamp(1.4rem, 5vw, 2rem)', color: config.accentColor, minWidth:'60px', textAlign:'center', animation: basket.length > 0 ? 'numberPop 0.3s ease-out':'none' }}>
                {basket.length} <span style={{ color:'#94a3b8', fontSize:'0.7em' }}>/{config.total}</span>
              </span>
            )}
          </div>
        )}

        {stage === 'mathReveal' && (
          <MathReveal config={MATH_CONFIG[level]} onComplete={onMathRevealComplete} />
        )}

        {stage === 'celebration' && (
          <CelebrationScreen
            level={level}
            total={config.total}
            label={config.label}
            accentColor={config.accentColorLight}
            stars={Math.min(levelPlayCounts[level] || 1, 3)}
            childName={childName}
            totalFruitsCollected={totalFruitsCollected}
            levelName={config.name}
            speechLang={speechLang}
            onAgain={() => startLevel(level)}
            onNext={level < 6 ? () => startLevel(level + 1) : null}
            onHome={backToTitle}
            onShowPostcard={() => {
              try {
                const url = generatePostcard({
                  name: childName,
                  levelName: config.name,
                  stars: Math.min(levelPlayCounts[level] || 1, 3),
                  totalFruits: totalFruitsCollected,
                  lang: speechLang,
                });
                setPostcardDataUrl(url);
                sound.win();
              } catch (e) {}
            }}
          />
        )}

        {postcardDataUrl && (
          <PostcardModal
            dataUrl={postcardDataUrl}
            childName={childName}
            onClose={() => setPostcardDataUrl(null)}
          />
        )}

        {showPauseMenu && (
          <PauseMenu
            onResume={() => { sound.pop(); setShowPauseMenu(false); }}
            onRestart={() => { setShowPauseMenu(false); startLevel(level); }}
            onHome={() => { setShowPauseMenu(false); backToTitle(); }}
          />
        )}
      </div>
    </>
  );
}
