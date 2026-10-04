// signal-lab — the interactive part.
//
// The maths lives in logic.mjs (and is unit-tested); this file only wires it
// to canvases, sliders and the Web Audio oscillator.

import {
  WAVEFORMS,
  MAX_HARMONICS,
  PULSE_DUTY,
  harmonic,
  harmonicsOf,
  keptHarmonics,
  synthesize,
  ideal,
  peakOf,
  seriesFormula,
  truncatedFormula,
  seriesSummary,
} from "./logic.mjs?v=3";

const $ = (id) => document.getElementById(id);
const els = {
  waves: $("waves"),
  waveNote: $("waveNote"),
  n: $("n"),
  nOut: $("nOut"),
  freq: $("freq"),
  fOut: $("fOut"),
  play: $("play"),
  sweep: $("sweep"),
  kept: $("kept"),
  peak: $("peak"),
  err: $("err"),
  formulaFull: $("formulaFull"),
  formulaNow: $("formulaNow"),
  formulaNote: $("formulaNote"),
  steps: $("steps"),
  stepNote: $("stepNote"),
  time: $("timeCanvas"),
  spec: $("specCanvas"),
};

const CYCLES = 2; // how many periods the time plot shows
const SPEC_BARS = 32; // harmonics drawn in the spectrum

let waveform = "square";
let count = Number(els.n.value);
let frequency = Number(els.freq.value);
let audio = null;
let playing = false;
let sweepTimer = null;

// --- canvases ---------------------------------------------------------------
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  // Both dimensions come from layout, never from canvas.width/height — those are
  // the drawing buffer, already multiplied by dpr.
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawTime() {
  const { ctx, w, h } = fitCanvas(els.time);
  const padTop = 16;
  const padBottom = 20;
  const yMid = padTop + (h - padTop - padBottom) / 2;
  const scale = (h - padTop - padBottom) / 2 / 1.45; // leave room for overshoot

  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = "#16202f";
  ctx.lineWidth = 1;
  for (let i = 0; i <= CYCLES * 4; i++) {
    const x = (w * i) / (CYCLES * 4);
    ctx.beginPath();
    ctx.moveTo(x, padTop - 6);
    ctx.lineTo(x, h - padBottom + 4);
    ctx.stroke();
  }
  for (const level of [-1, 1]) {
    const y = yMid - level * scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // zero line
  ctx.strokeStyle = "#2a3648";
  ctx.beginPath();
  ctx.moveTo(0, yMid);
  ctx.lineTo(w, yMid);
  ctx.stroke();

  const xToT = (i, steps) => (CYCLES * i) / steps;

  // ideal (dashed)
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const steps = 2000;
  let idealMax = 0;
  for (let i = 0; i <= steps; i++) {
    const t = xToT(i, steps);
    const v = ideal(waveform, t);
    if (Math.abs(v) > idealMax) idealMax = Math.abs(v);
    const x = (w * i) / steps;
    const y = yMid - v * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // synthesized (solid)
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let maxV = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i <= steps; i++) {
    const t = xToT(i, steps);
    const v = synthesize(waveform, t, count);
    const x = (w * i) / steps;
    const y = yMid - v * scale;
    if (Math.abs(v) > Math.abs(maxV)) {
      maxV = v;
      maxX = x;
      maxY = y;
    }
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // reference labels
  ctx.fillStyle = "#64748b";
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillText("+1", 4, yMid - scale + 12);
  ctx.fillText("-1", 4, yMid + scale - 4);
  ctx.save();
  ctx.translate(12, yMid + 4);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("幅度", -14, 0);
  ctx.restore();

  // --- annotations: point straight at the interesting bits ------------------
  ctx.font = "12px ui-monospace, Consolas, monospace";

  // where the ideal waveform jumps
  for (let i = 1; i <= steps; i++) {
    const v0 = ideal(waveform, xToT(i - 1, steps));
    const v1 = ideal(waveform, xToT(i, steps));
    if (Math.abs(v1 - v0) > 0.5) {
      const x = (w * i) / steps;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(148,163,184,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padTop - 6);
      ctx.lineTo(x, h - padBottom + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("跳变处", x + 5, padTop + 2);
      break;
    }
  }

  // the overshoot that refuses to go away
  const overshoot = Math.abs(maxV) > idealMax * 1.02;
  if (overshoot) {
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(maxX, maxY, 5, 0, Math.PI * 2);
    ctx.stroke();
    const right = maxX < w * 0.62;
    const tx = right ? maxX + 40 : maxX - 150;
    ctx.beginPath();
    ctx.moveTo(maxX + (right ? 5 : -5), maxY);
    ctx.lineTo(tx + (right ? -10 : 10), maxY - 26);
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`过冲 ${Math.abs(maxV).toFixed(3)}（吉布斯）`, tx, maxY - 32);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`理想值只有 ${idealMax.toFixed(2)}`, tx, maxY - 17);
  } else {
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("谐波全部保留时几乎和虚线重合", 8, padTop + 2);
  }
}

function drawSpectrum() {
  const { ctx, w, h } = fitCanvas(els.spec);
  const padTop = 12;
  const padBottom = 24;
  const plotH = h - padTop - padBottom;
  ctx.clearRect(0, 0, w, h);

  // amplitude of the fundamental sets the full-scale reference
  const fund = harmonic(waveform, 1, PULSE_DUTY);
  const full = fund ? fund.amp : 1;
  const slot = w / SPEC_BARS;

  ctx.strokeStyle = "#16202f";
  for (let k = 0; k <= 4; k++) {
    const y = padTop + (plotH * k) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.font = "11px ui-monospace, Consolas, monospace";
  for (let n = 1; n <= SPEC_BARS; n++) {
    const amp = harmonic(waveform, n, PULSE_DUTY)?.amp ?? 0;
    const barH = (amp / full) * plotH;
    const x = slot * (n - 1) + slot * 0.18;
    const bw = slot * 0.64;
    const kept = n <= count;
    ctx.fillStyle = kept ? "#7dd3fc" : "#243044";
    ctx.fillRect(x, padTop + plotH - barH, bw, barH);
    if (n % 4 === 0 || n <= 3) {
      ctx.fillStyle = "#64748b";
      ctx.fillText(String(n), x + bw / 2 - (n > 9 ? 6 : 3), h - 8);
    }
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "11px ui-monospace, Consolas, monospace";
  ctx.fillText("谐波序号 n →", 4, h - 8);

  // --- annotations ----------------------------------------------------------
  // 1. where the series is cut
  if (count <= SPEC_BARS) {
    const x = slot * count;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(251,191,36,0.75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, padTop - 6);
    ctx.lineTo(x, padTop + plotH + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`← n ≤ ${count} 保留`, Math.max(2, x - 82), padTop + 6);
  } else {
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`n ≤ ${count}：范围内全保留`, 4, padTop + 6);
  }

  // 2. a missing harmonic shouts louder than a present one
  const evenMissing = harmonic(waveform, 2, PULSE_DUTY) === null;
  if (evenMissing) {
    const x = slot * 2;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("2、4、6… 是空的", x - 6, padTop + plotH + 12);
    ctx.strokeStyle = "rgba(148,163,184,0.7)";
    ctx.beginPath();
    ctx.moveTo(x + 6, padTop + plotH + 2);
    ctx.lineTo(x + 6, padTop + plotH - 10);
    ctx.stroke();
  }

  // 3. name the fundamental
  ctx.fillStyle = "#7dd3fc";
  ctx.fillText("基波", slot * 0.1, padTop + plotH * 0.12);
}

// --- readouts ---------------------------------------------------------------
function refresh() {
  const list = keptHarmonics(waveform, count, PULSE_DUTY);
  els.kept.textContent = list.length <= 8 ? list.join(", ") : `${list.slice(0, 8).join(", ")} …（共 ${list.length} 个）`;

  const peak = peakOf(waveform, count, 1200);
  els.peak.textContent = peak.toFixed(3);
  els.peak.classList.toggle("hot", peak > 1.02);

  // mean error away from the jump: how close the shape is overall
  let err = 0;
  const samples = 600;
  for (let i = 0; i < samples; i++) {
    const t = ((i + 0.5) / samples) * 0.45; // first 45% of a period: no jump
    err += Math.abs(synthesize(waveform, t, count) - ideal(waveform, t));
  }
  err /= samples;
  els.err.textContent = err < 0.002 ? "几乎重合" : err.toFixed(3);

  els.waveNote.textContent = WAVEFORMS.find((w) => w.id === waveform)?.note ?? "";
  for (const b of els.waves.querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.wave === waveform);
  }
  els.nOut.textContent = String(count);
  els.fOut.textContent = String(frequency);

  // live formula readout
  const summary = seriesSummary(waveform, count, frequency, PULSE_DUTY);
  els.formulaFull.textContent = seriesFormula(waveform, PULSE_DUTY);
  els.formulaNow.textContent = truncatedFormula(waveform, count, PULSE_DUTY, 6);
  const keptList =
    summary.kept.length <= 10
      ? summary.kept.join(", ")
      : `${summary.kept.slice(0, 10).join(", ")} …`;
  els.formulaNote.textContent =
    `ω = 2πf = 2π × ${frequency} ≈ ${Math.round(summary.omega)} rad/s　·　` +
    `${summary.keptCount} 个谐波：${keptList || "无"}`;

  try {
    drawTime();
    drawSpectrum();
  } catch (err) {
    els.err.textContent = `绘图出错：${err.message}`;
    return;
  }
  if (audio && playing) audio.update();
}

// --- audio ------------------------------------------------------------------
function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();

  function buildWave() {
    // Feed our own Fourier coefficients straight into a PeriodicWave:
    // the browser then synthesises exactly this band-limited waveform.
    const real = new Float32Array(MAX_HARMONICS + 1);
    const imag = new Float32Array(MAX_HARMONICS + 1);
    for (const h of harmonicsOf(waveform, count, PULSE_DUTY)) {
      real[h.n] += h.amp * Math.cos(h.phase);
      imag[h.n] += -h.amp * Math.sin(h.phase);
    }
    return ctx.createPeriodicWave(real, imag);
  }

  return {
    ctx,
    update() {
      osc.setPeriodicWave(buildWave());
      osc.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.01);
    },
    start() {
      this.update();
      gain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.02);
    },
    stop() {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
  };
}

async function togglePlay() {
  if (!audio) audio = createAudio();
  await audio.ctx.resume();
  playing = !playing;
  if (playing) audio.start();
  else audio.stop();
  els.play.textContent = playing ? "■ 停止" : "▶︎ 播放";
}

// --- wiring ------------------------------------------------------------------
for (const w of WAVEFORMS) {
  const b = document.createElement("button");
  b.dataset.wave = w.id;
  b.textContent = w.label;
  b.addEventListener("click", () => {
    waveform = w.id;
    refresh();
  });
  els.waves.appendChild(b);
}

els.n.addEventListener("input", () => {
  count = Number(els.n.value);
  refresh();
});
els.freq.addEventListener("input", () => {
  frequency = Number(els.freq.value);
  refresh();
});
els.play.addEventListener("click", togglePlay);
// --- guided steps -----------------------------------------------------------
// Three clicks that walk through the whole idea: one harmonic, seven, forty.
const STEPS = [
  {
    n: 1,
    note:
      "<b>只剩基波。</b>频域：只有 1 根亮柱。时域：蓝线是一条纯正弦，跟理想方波差得远。" +
      "听：很闷、很圆，像长笛而不是方波。",
  },
  {
    n: 7,
    note:
      "<b>加上 3、5、7（一共 4 根）。</b>蓝线开始有方波的轮廓，但边角还是圆的；" +
      "跳变附近长出了那个黄色圈出来的过冲 —— 这就是吉布斯现象。听：明显变亮了。",
  },
  {
    n: 40,
    note:
      "<b>40 根全上。</b>蓝线几乎贴住虚线了，声音很接近方波。" +
      "但注意过冲：它没有消失，只是被挤得更窄 —— 这就是「不管加多少谐波都甩不掉」的吉布斯。",
  },
];

function applyStep(index) {
  const step = STEPS[index];
  if (!step) return;
  waveform = "square";
  count = step.n;
  els.n.value = String(count);
  for (const b of els.steps.querySelectorAll("button")) {
    b.classList.toggle("on", Number(b.dataset.step) === index);
  }
  els.stepNote.innerHTML = step.note;
  refresh();
  if (!playing) togglePlay(); // the click is the gesture, so sound is allowed
}

els.steps.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step]");
  if (button) applyStep(Number(button.dataset.step));
});

els.sweep.addEventListener("click", () => {  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    els.sweep.textContent = "扫描谐波";
    return;
  }
  els.sweep.textContent = "停止扫描";
  els.n.value = "1";
  count = 1;
  refresh();
  sweepTimer = setInterval(() => {
    count += 1;
    if (count > 24) {
      clearInterval(sweepTimer);
      sweepTimer = null;
      els.sweep.textContent = "扫描谐波";
    }
    els.n.value = String(count);
    refresh();
  }, 220);
});

window.addEventListener("resize", () => {
  drawTime();
  drawSpectrum();
});

// deep link: ?wave=saw&n=9&freq=330
{
  const p = new URLSearchParams(location.search);
  const w = p.get("wave");
  if (WAVEFORMS.some((x) => x.id === w)) waveform = w;
  const n = Number(p.get("n"));
  if (Number.isInteger(n) && n >= 1 && n <= MAX_HARMONICS) count = n;
  const f = Number(p.get("freq"));
  if (Number.isFinite(f) && f >= 80 && f <= 660) frequency = f;
  els.n.value = String(count);
  els.freq.value = String(frequency);
}

refresh();
window.__signalLab = { get state() { return { waveform, count, frequency, playing }; }, refresh };
