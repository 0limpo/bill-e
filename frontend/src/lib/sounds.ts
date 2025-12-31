/**
 * sounds.ts
 * Audio utilities for Bill-e
 * Uses Web Audio API to generate sounds without external files
 */

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
};

/**
 * Play a celebration sound (Ta-Da!)
 */
export const playCelebrationSound = () => {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (required after user interaction)
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const now = ctx.currentTime;

  // First chord (C major)
  [523, 659, 784].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  });

  // Second chord (higher, E-G-C)
  [659, 784, 1047].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now + 0.18);
    osc.stop(now + 0.5);
  });
};

/**
 * Play a simple success sound (single tone)
 */
export const playSuccessSound = () => {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.frequency.value = 880; // A5
  oscillator.type = "sine";

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  oscillator.start(now);
  oscillator.stop(now + 0.2);
};
