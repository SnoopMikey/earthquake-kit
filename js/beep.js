// Grocery-checkout style confirmation beep via Web Audio (no audio asset).

let ctx = null;

// Must be called from a user gesture (e.g. tapping "Scan barcode") so the
// AudioContext is unlocked on iOS before the async decode fires the beep.
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume();
}

export function beep() {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 2637; // E7 — the classic checkout-scanner pitch
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
  gain.gain.setValueAtTime(0.25, t + 0.09);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.14);
}
