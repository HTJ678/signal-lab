import test from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_DUTY,
  MAX_HARMONICS,
  WAVEFORMS,
  harmonic,
  harmonicsOf,
  keptHarmonics,
  synthesize,
  ideal,
  peakOf,
  seriesFormula,
  truncatedFormula,
  seriesSummary,
  sinc,
  gateSpectrum,
  lineAmplitude,
  envelopeZeros,
  mainLobeWidth,
  fft,
  spectrum,
  dcOf,
} from "../src/logic.mjs";

test("square wave has only odd harmonics, decaying as 1/n", () => {
  assert.equal(harmonic("square", 2), null);
  assert.equal(harmonic("square", 4), null);
  const h1 = harmonic("square", 1);
  const h3 = harmonic("square", 3);
  const h5 = harmonic("square", 5);
  assert.ok(Math.abs(h1.amp - 4 / Math.PI) < 1e-12);
  assert.ok(Math.abs(h3.amp - h1.amp / 3) < 1e-12);
  assert.ok(Math.abs(h5.amp - h1.amp / 5) < 1e-12);
});

test("triangle wave decays as 1/n²", () => {
  const h1 = harmonic("triangle", 1);
  const h3 = harmonic("triangle", 3);
  assert.equal(harmonic("triangle", 2), null);
  assert.ok(Math.abs(h3.amp - h1.amp / 9) < 1e-12);
});

test("sawtooth keeps every harmonic, with alternating sign", () => {
  const h1 = harmonic("saw", 1);
  const h2 = harmonic("saw", 2);
  assert.ok(Math.abs(h1.amp - 2 / Math.PI) < 1e-12);
  assert.ok(Math.abs(h2.amp - h1.amp / 2) < 1e-12);
  // the sign flip shows up as a phase shift of π
  assert.ok(Math.abs(Math.abs(h2.phase - h1.phase) - Math.PI) < 1e-12);
});

test("pulse train: sinc envelope, every 4th harmonic vanishes at 25% duty", () => {
  const h4 = harmonic("pulse", 4);
  assert.equal(h4, null);
  assert.equal(harmonic("pulse", 8), null);
  const h1 = harmonic("pulse", 1);
  assert.ok(Math.abs(h1.amp - (2 * Math.sin(Math.PI * PULSE_DUTY)) / Math.PI) < 1e-12);
  assert.ok(Math.abs(dcOf("pulse") - PULSE_DUTY) < 1e-12);
});

test("keptHarmonics reports what actually survives truncation", () => {
  assert.deepEqual(keptHarmonics("square", 7), [1, 3, 5, 7]);
  assert.deepEqual(keptHarmonics("square", 8), [1, 3, 5, 7]);
  assert.deepEqual(keptHarmonics("saw", 4), [1, 2, 3, 4]);
  assert.equal(keptHarmonics("square", MAX_HARMONICS).length, 32);
});

test("synthesis converges to the ideal waveform away from the jump", () => {
  for (const wave of ["square", "saw", "triangle"]) {
    for (const t of [0.1, 0.2, 0.3]) {
      const got = synthesize(wave, t, 400);
      const want = ideal(wave, t);
      assert.ok(Math.abs(got - want) < 0.02, `${wave} @${t}: ${got} vs ${want}`);
    }
  }
});

test("one harmonic of a square is just a sine of amplitude 4/π", () => {
  const got = synthesize("square", 0.25, 1); // peak of sin
  assert.ok(Math.abs(got - 4 / Math.PI) < 1e-12);
});

test("Gibbs phenomenon: overshoot converges to 8.95% of the half-jump", () => {
  const one = peakOf("square", 1);
  const some = peakOf("square", 5);
  const many = peakOf("square", 199);
  // one harmonic is just sin, peaking at 4/π
  assert.ok(Math.abs(one - 4 / Math.PI) < 1e-3, `single-harmonic peak = ${one}`);
  // the truncated series settles at ≈1.179 of the ±1 amplitude, and never below
  assert.ok(many > 1.16, `overshoot should be near 1.179, got ${many}`);
  assert.ok(many < 1.19, `overshoot should not keep growing, got ${many}`);
  // it approaches that value from above
  assert.ok(one > some && some > many);
});

test("fft: impulse has a flat spectrum", () => {
  const n = 8;
  const re = Float64Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
  const im = new Float64Array(n);
  fft(re, im);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(re[i] - 1) < 1e-12);
    assert.ok(Math.abs(im[i]) < 1e-12);
  }
});

test("fft: constant input puts all energy in bin 0", () => {
  const n = 8;
  const re = Float64Array.from(new Array(n).fill(1));
  const im = new Float64Array(n);
  fft(re, im);
  assert.ok(Math.abs(re[0] - n) < 1e-12);
  for (let i = 1; i < n; i++) assert.ok(Math.abs(re[i]) < 1e-12);
});

test("fft: a bin-centred cosine becomes a single spike", () => {
  const n = 64;
  const bin = 5;
  const signal = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * bin * i) / n));
  const mags = spectrum(signal);
  assert.equal(mags.length, n / 2 + 1);
  let best = 0;
  for (let i = 0; i < mags.length; i++) if (mags[i] > mags[best]) best = i;
  assert.equal(best, bin);
  assert.ok(Math.abs(mags[bin] - 1) < 1e-9, `peak should be 1, got ${mags[bin]}`);
  for (let i = 0; i < mags.length; i++) {
    if (i !== bin) assert.ok(mags[i] < 1e-9, `bin ${i} should be empty`);
  }
});

test("fft: Parseval's theorem holds", () => {
  const n = 128;
  const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1));
  const timeEnergy = signal.reduce((a, v) => a + v * v, 0);
  const re = Float64Array.from(signal);
  const im = new Float64Array(n);
  fft(re, im);
  let freqEnergy = 0;
  for (let i = 0; i < n; i++) freqEnergy += re[i] * re[i] + im[i] * im[i];
  freqEnergy /= n;
  assert.ok(Math.abs(timeEnergy - freqEnergy) < 1e-6);
});

test("fft: rejects lengths that are not a power of two", () => {
  assert.throws(() => fft(Float64Array.from([1, 2, 3]), new Float64Array(3)), /power of two/);
  assert.throws(() => fft(Float64Array.from([1, 2]), new Float64Array(3)), /same length/);
});

test("spectrum of a truncated square peaks at its odd harmonics", () => {
  const n = 512;
  const signal = Array.from({ length: n }, (_, i) => synthesize("square", i / n, 32));
  const mags = spectrum(signal);
  // bin k corresponds to harmonic k for a signal of exactly one period
  const h1 = mags[1];
  assert.ok(Math.abs(h1 - 4 / Math.PI) < 0.05, `h1=${h1}`);
  assert.ok(mags[2] < 0.02, `even harmonics should be tiny, got ${mags[2]}`);
  assert.ok(Math.abs(mags[3] - 4 / (3 * Math.PI)) < 0.05);
});

test("WAVEFORMS catalogue is coherent", () => {
  assert.equal(WAVEFORMS.length, 5);
  for (const w of WAVEFORMS) assert.ok(harmonic(w.id, 1), `${w.id} needs a fundamental`);
});

test("seriesFormula spells out each textbook series", () => {
  assert.match(seriesFormula("square"), /4\/π/);
  assert.match(seriesFormula("triangle"), /8\/π²/);
  assert.match(seriesFormula("saw"), /2\/π/);
  assert.match(seriesFormula("pulse"), /sin\(nπd\)/);
  assert.equal(seriesFormula("sine"), "x(t) = sin(ωt)");
});

test("truncatedFormula lists exactly the surviving harmonics", () => {
  // count is the highest harmonic number kept: for a square that is n = 1, 3
  const square3 = truncatedFormula("square", 3);
  assert.equal((square3.match(/sin\(/g) || []).length, 2);
  assert.ok(square3.startsWith("x(t) ≈ 1.273·sin(ωt)"));
  assert.match(square3, /0\.424·sin\(3ωt\)/);
  assert.ok(!square3.includes("5ωt"));

  const square7 = truncatedFormula("square", 7);
  assert.equal((square7.match(/sin\(/g) || []).length, 4); // n = 1, 3, 5, 7
  assert.match(square7, /0\.255·sin\(5ωt\)/);
  assert.match(square7, /0\.182·sin\(7ωt\)/);

  const sine = truncatedFormula("sine", 4);
  assert.equal(sine, "x(t) ≈ 1.000·sin(ωt)");
});

test("truncatedFormula keeps the alternating sign of the sawtooth", () => {
  const saw = truncatedFormula("saw", 2);
  assert.match(saw, /0\.637·sin\(ωt\)/);
  assert.match(saw, /− 0\.318·sin\(2ωt\)/);
});

test("truncatedFormula shows the pulse DC term and skips the missing 4th", () => {
  const pulse = truncatedFormula("pulse", 8, PULSE_DUTY, 8);
  assert.ok(pulse.includes("0.250"));
  assert.ok(!pulse.includes("cos(4ωt"));
  assert.ok(pulse.includes("cos(5ωt"));
});

test("truncatedFormula abbreviates long series", () => {
  const long = truncatedFormula("saw", 32, PULSE_DUTY, 4);
  assert.ok(long.endsWith("…"));
  assert.equal((long.match(/sin\(/g) || []).length, 4);
});

test("sinc is normalised and finite at zero", () => {
  assert.equal(sinc(0), 1);
  assert.ok(Math.abs(sinc(1)) < 1e-15);
  assert.ok(Math.abs(sinc(2)) < 1e-15);
  assert.ok(Math.abs(sinc(0.5) - 2 / Math.PI) < 1e-12);
});

test("gate spectrum is the sinc envelope, scaled by the width", () => {
  assert.equal(gateSpectrum(0, 0.25), 0.25);
  assert.ok(Math.abs(gateSpectrum(1, 0.5) - 0.5 * (2 / Math.PI)) < 1e-12);
  // a wider gate has a narrower envelope
  assert.ok(gateSpectrum(5, 0.4) < gateSpectrum(5, 0.2));
});

test("line amplitudes reproduce the pulse-train harmonics exactly", () => {
  for (const duty of [0.1, 0.25, 0.5]) {
    for (const n of [1, 2, 3, 5, 7, 9]) {
      const expected = harmonic("pulse", n, duty)?.amp ?? 0;
      assert.ok(
        Math.abs(lineAmplitude(n, duty) - expected) < 1e-12,
        `duty=${duty} n=${n}: ${lineAmplitude(n, duty)} vs ${expected}`,
      );
    }
  }
});

test("envelope zeros land exactly on the harmonics that vanish", () => {
  assert.deepEqual(envelopeZeros(0.25, 20), [4, 8, 12, 16, 20]);
  assert.deepEqual(envelopeZeros(0.5, 20), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  for (const f of envelopeZeros(0.25, 20)) {
    assert.ok(Math.abs(gateSpectrum(f, 0.25)) < 1e-12);
  }
});

test("main lobe width is inversely proportional to the gate width", () => {
  assert.equal(mainLobeWidth(0.25), 4);
  assert.equal(mainLobeWidth(0.5), 2);
  assert.ok(mainLobeWidth(0.1) > mainLobeWidth(0.5));
});

test("seriesSummary ties the kept harmonics to ω", () => {  const s = seriesSummary("square", 8, 220);
  assert.deepEqual(s.kept, [1, 3, 5, 7]);
  assert.equal(s.keptCount, 4);
  assert.ok(Math.abs(s.omega - 2 * Math.PI * 220) < 1e-9);
});
