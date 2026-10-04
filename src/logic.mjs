// signal-lab — pure math layer.
// No DOM, no Web Audio here, so every formula can be unit-tested in Node.
//
// Convention: a waveform is written as a Fourier series over its normalised
// period t ∈ [0, 1):
//
//     x(t) = dc + Σ  amp_n · cos(2π·n·t + phase_n)
//
// Keeping one representation for every waveform means the synthesiser, the
// spectrum plot and the audio layer all read the same numbers.

/** Duty cycle of the pulse waveform. */
export const PULSE_DUTY = 0.25;

/** How many harmonics we are willing to synthesise. */
export const MAX_HARMONICS = 64;

export const WAVEFORMS = [
  { id: "sine", label: "正弦波", note: "只有基波" },
  { id: "square", label: "方波", note: "只有奇次谐波，1/n 衰减" },
  { id: "saw", label: "锯齿波", note: "全部谐波，1/n 衰减" },
  { id: "triangle", label: "三角波", note: "只有奇次谐波，1/n² 衰减" },
  { id: "pulse", label: "脉冲（25%）", note: "包络是 sinc，每第 4 根消失" },
];

export function isWaveform(id) {
  return WAVEFORMS.some((w) => w.id === id);
}

/**
 * The n-th harmonic (n ≥ 1) of a waveform, or null when it is absent.
 * @returns {{amp:number, phase:number}|null}
 */
export function harmonic(waveform, n, duty = PULSE_DUTY) {
  if (!Number.isFinite(n) || n < 1) return null;
  switch (waveform) {
    case "sine":
      return n === 1 ? { amp: 1, phase: -Math.PI / 2 } : null;
    case "square":
      // (4/π)·Σ sin(nωt)/n over odd n
      return n % 2 === 0 ? null : { amp: 4 / (n * Math.PI), phase: -Math.PI / 2 };
    case "saw":
      // (2/π)·Σ (-1)^(n+1)·sin(nωt)/n
      return { amp: 2 / (n * Math.PI), phase: -Math.PI / 2 + (n % 2 === 0 ? Math.PI : 0) };
    case "triangle": {
      // (8/π²)·Σ (-1)^((n-1)/2)·sin(nωt)/n² over odd n
      if (n % 2 === 0) return null;
      const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
      return {
        amp: 8 / (Math.PI * Math.PI * n * n),
        phase: -Math.PI / 2 + (sign < 0 ? Math.PI : 0),
      };
    }
    case "pulse": {
      // duty-cycle pulse train: |X_n| = |sin(πnd)|/(πn), phase = -πnd
      const amp = (2 * Math.abs(Math.sin(Math.PI * n * duty))) / (Math.PI * n);
      return amp < 1e-12 ? null : { amp, phase: -Math.PI * n * duty };
    }
    default:
      return null;
  }
}

/** DC term of the series. */
export function dcOf(waveform, duty = PULSE_DUTY) {
  return waveform === "pulse" ? duty : 0;
}

/** Every present harmonic up to n = maxN, in ascending order. */
export function harmonicsOf(waveform, maxN = MAX_HARMONICS, duty = PULSE_DUTY) {
  const out = [];
  for (let n = 1; n <= maxN; n++) {
    const h = harmonic(waveform, n, duty);
    if (h) out.push({ n, amp: h.amp, phase: h.phase });
  }
  return out;
}

/** Harmonic numbers actually used when we keep the first `count` harmonics. */
export function keptHarmonics(waveform, count, duty = PULSE_DUTY) {
  return harmonicsOf(waveform, count, duty).map((h) => h.n);
}

/** Band-limited synthesis: keep only harmonics up to number `count`. */
export function synthesize(waveform, t, count, { duty = PULSE_DUTY } = {}) {
  let value = dcOf(waveform, duty);
  for (const h of harmonicsOf(waveform, count, duty)) {
    value += h.amp * Math.cos(2 * Math.PI * h.n * t + h.phase);
  }
  return value;
}

/** The exact (infinite-harmonic) waveform, used as the dashed reference. */
export function ideal(waveform, t, duty = PULSE_DUTY) {
  const x = ((t % 1) + 1) % 1;
  switch (waveform) {
    case "sine":
      return Math.sin(2 * Math.PI * x);
    case "square":
      return x < 0.5 ? 1 : -1;
    case "saw":
      // the sine series converges to 2x for x < 0.5 and 2x - 2 after the jump
      return x < 0.5 ? 2 * x : 2 * x - 2;
    case "triangle":
      if (x < 0.25) return 4 * x;
      if (x < 0.75) return 2 - 4 * x;
      return 4 * x - 4;
    case "pulse":
      return x < duty ? 1 : 0;
    default:
      return 0;
  }
}

/** Largest |value| reached by the band-limited waveform — the Gibbs overshoot. */
export function peakOf(waveform, count, samples = 4000) {
  let peak = 0;
  for (let i = 0; i <= samples; i++) {
    const v = Math.abs(synthesize(waveform, i / samples, count));
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * The exact Fourier series of each waveform, written the way a textbook would.
 */
export function seriesFormula(waveform, duty = PULSE_DUTY) {
  switch (waveform) {
    case "sine":
      return "x(t) = sin(ωt)";
    case "square":
      return "x(t) = (4/π) · Σₖ sin[(2k+1)ωt] / (2k+1),  k = 0,1,2,…";
    case "saw":
      return "x(t) = (2/π) · Σₙ (−1)^(n+1) · sin(nωt) / n,  n = 1,2,3,…";
    case "triangle":
      return "x(t) = (8/π²) · Σₖ (−1)^k · sin[(2k+1)ωt] / (2k+1)²,  k = 0,1,2,…";
    case "pulse":
      return `x(t) = d + Σₙ [2·sin(nπd)/(nπ)] · cos(nωt − nπd),  d = ${duty}（25% 占空比）`;
    default:
      return "x(t) = ?";
  }
}

function fixed(x, digits = 3) {
  const v = Math.abs(x) < 0.5 * Math.pow(10, -digits) ? 0 : x;
  return v.toFixed(digits);
}

/**
 * The band-limited expression actually being played: one term per surviving
 * harmonic, plus the DC term where there is one.
 */
export function truncatedFormula(waveform, count, duty = PULSE_DUTY, maxTerms = 6) {
  const harmonics = harmonicsOf(waveform, count, duty);
  const dc = dcOf(waveform, duty);
  const parts = [];

  if (dc !== 0) parts.push(fixed(dc));

  for (const h of harmonics) {
    if (parts.length >= maxTerms + (dc !== 0 ? 1 : 0)) {
      parts.push("…");
      break;
    }
    const n = h.n;
    const angle = n === 1 ? "ωt" : `${n}ωt`;
    if (waveform === "pulse") {
      parts.push(`${fixed(h.amp)}·cos(${angle} − ${fixed(Math.PI * n * duty)})`);
      continue;
    }
    // amp·cos(θ + φ) collapses to ±amp·sin(θ) for these three waveforms
    const signed = h.amp * Math.cos(h.phase + Math.PI / 2);
    parts.push(`${fixed(Math.abs(signed))}·sin(${angle})`);
    if (signed < 0) {
      parts[parts.length - 1] = `− ${parts[parts.length - 1]}`;
    }
  }

  if (!parts.length) return "x(t) ≈ 0（没有保留任何谐波）";

  let expression = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === "…" || p.startsWith("− ")) expression += ` ${p}`;
    else expression += ` + ${p}`;
  }
  return `x(t) ≈ ${expression}`;
}

/** How many harmonics survive truncation, and the ω that goes with a frequency. */
export function seriesSummary(waveform, count, freqHz, duty = PULSE_DUTY) {
  const kept = keptHarmonics(waveform, count, duty);
  return {
    kept,
    keptCount: kept.length,
    omega: 2 * Math.PI * freqHz,
  };
}
// --- gate ⊛ comb -------------------------------------------------------------
// The periodic pulse train is NOT defined by its series here; it is *built*:
//
//     p(t) = g(t) ⊛ Σ δ(t − nT)          (T = 1 in normalised time)
//
// and the whole point of the module is that convolution in time is
// multiplication in frequency:
//
//     P(f) = G(f) · (1/T)·Σ δ(f − n/T),   G(f) = τ·sinc(τf)
//
// i.e. a sinc envelope with a comb of lines sampling it.

export function sinc(x) {
  if (x === 0) return 1;
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

/** Continuous spectrum of a unit-height gate of width `duty` (period = 1). */
export function gateSpectrum(f, duty) {
  return duty * sinc(duty * f);
}

/** Amplitude of the n-th line of the pulse train (single-sided). */
export function lineAmplitude(n, duty) {
  return 2 * Math.abs(gateSpectrum(n, duty));
}

/** Where the sinc envelope crosses zero: f = k / τ. */
export function envelopeZeros(duty, maxF = 40, limit = 24) {
  const out = [];
  for (let k = 1; k <= limit; k++) {
    const f = k / duty;
    if (f > maxF) break;
    out.push(f);
  }
  return out;
}

/** Width of the main lobe of the envelope — inversely proportional to τ. */
export function mainLobeWidth(duty) {
  return 1 / duty;
}

/**
 * In-place iterative radix-2 FFT (Cooley–Tukey). Written by hand on purpose:
 * this project is about understanding the transform, not importing it.
 */
export function fft(re, im) {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error("fft: length must be a power of two");
  }
  if (im.length !== n) {
    throw new Error("fft: re and im must have the same length");
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < len / 2; k++) {
        const i = start + k;
        const j = i + len / 2;
        const vr = re[j] * curR - im[j] * curI;
        const vi = re[j] * curI + im[j] * curR;
        re[j] = re[i] - vr;
        im[j] = im[i] - vi;
        re[i] += vr;
        im[i] += vi;
        const nextR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nextR;
      }
    }
  }
  return { re, im };
}

/**
 * Single-sided amplitude spectrum of a real signal.
 * Normalised by 2/N so a unit sinusoid shows up as a bar of height 1.
 */
export function spectrum(signal) {
  const n = signal.length;
  const re = Float64Array.from(signal);
  const im = new Float64Array(n);
  fft(re, im);
  const bins = n / 2 + 1;
  const mags = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    mags[i] = (2 * Math.hypot(re[i], im[i])) / n;
  }
  mags[0] /= 2; // DC should not be doubled
  return mags;
}
