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
 * Synchronized with animation: ends at ~1s when checkmark completes
 */
export const playCelebrationSound = () => {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (required after user interaction)
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const now = ctx.currentTime;

  // First chord (C major) - starts at 0.5s
  [523, 659, 784].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.start(now + 0.5);
    osc.stop(now + 0.7);
  });

  // Second chord (higher, E-G-C) - starts at 0.65s, ends at 1.0s
  [659, 784, 1047].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, now + 0.65);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.start(now + 0.65);
    osc.stop(now + 1.0);
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
