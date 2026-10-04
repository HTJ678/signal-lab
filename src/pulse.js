// signal-lab — 门函数 ⊛ 冲激串
// Shows why a periodic pulse train is "a gate stamped on every impulse"
// and why its spectrum is "a sinc envelope sampling a comb".

import {
  harmonicsOf,
  gateSpectrum,
  lineAmplitude,
  envelopeZeros,
  mainLobeWidth,
} from "./logic.mjs?v=2";

const $ = (id) => document.getElementById(id);
const els = {
  duty: $("duty"),
  dutyOut: $("dutyOut"),
  freq: $("freq"),
  fOut: $("fOut"),
  play: $("play"),
  square: $("square"),
  lobe: $("lobe"),
  firstZero: $("firstZero"),
  zeroHarmonic: $("zeroHarmonic"),
  zeros: $("zeros"),
  time: $("timeCanvas"),
  spec: $("specCanvas"),
  nowline: $("nowline"),
  note: $("note"),
  steps: $("steps"),
  stepNote: $("stepNote"),
};

const PERIODS = 3; // how many periods the time plot shows
const MAX_LINES = 32; // spectrum lines drawn
const AUDIO_HARMONICS = 48;

let duty = Number(els.duty.value);
let frequency = Number(els.freq.value);
let audio = null;
let playing = false;

// --- canvases ---------------------------------------------------------------
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawTime() {
  const { ctx, w, h } = fitCanvas(els.time);
  ctx.clearRect(0, 0, w, h);

  const x0 = 46;
  const x1 = w - 12;
  const plotW = x1 - x0;
  const tToX = (t) => x0 + (plotW * t) / PERIODS;

  const laneH = h / 3;
  const amp = laneH * 0.34;
  const lanes = {
    comb: laneH * 0.5,
    gate: laneH * 1.5,
    result: laneH * 2.5,
  };

  const label = (text, colour = "#64748b") => {
    ctx.fillStyle = colour;
    ctx.font = "12px ui-monospace, Consolas, monospace";
    ctx.fillText(text, 6, 14);
  };

  // frame lines
  ctx.strokeStyle = "#16202f";
  for (let n = 0; n <= PERIODS; n++) {
    const x = tToX(n);
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, h - 6);
    ctx.stroke();
  }

  // lane 1: the comb — one arrow per integer t
  ctx.strokeStyle = "#2f3f57";
  ctx.beginPath();
  ctx.moveTo(x0, lanes.comb);
  ctx.lineTo(x1, lanes.comb);
  ctx.stroke();
  for (let n = 0; n < PERIODS; n++) {
    const x = tToX(n);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, lanes.comb);
    ctx.lineTo(x, lanes.comb - amp * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4, lanes.comb - amp * 0.9 + 7);
    ctx.lineTo(x, lanes.comb - amp * 0.9);
    ctx.lineTo(x + 4, lanes.comb - amp * 0.9 + 7);
    ctx.stroke();
  }
  label("① 冲激串  Σ δ(t − nT)");

  // lane 2: the gate, stamped at every impulse
  ctx.strokeStyle = "#2f3f57";
  ctx.beginPath();
  ctx.moveTo(x0, lanes.gate);
  ctx.lineTo(x1, lanes.gate);
  ctx.stroke();
  for (let n = 0; n < PERIODS; n++) {
    const xa = tToX(n);
    const xb = tToX(n + duty);
    const solid = n === 0;
    ctx.setLineDash(solid ? [5, 4] : [3, 4]);
    ctx.strokeStyle = solid ? "#f9a8d4" : "rgba(249,168,212,0.35)";
    ctx.lineWidth = solid ? 2 : 1.4;
    ctx.strokeRect(xa, lanes.gate - amp, xb - xa, amp);
    ctx.setLineDash([]);
  }
  label("② 门函数 g(t)  每次盖一个 τ 宽的章");

  // lane 3: the result — a pulse train
  ctx.strokeStyle = "#2f3f57";
  ctx.beginPath();
  ctx.moveTo(x0, lanes.result);
  ctx.lineTo(x1, lanes.result);
  ctx.stroke();
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let n = 0; n <= PERIODS; n++) {
    const xa = tToX(n);
    const xb = tToX(Math.min(n + duty, PERIODS));
    ctx.moveTo(xa, lanes.result);
    ctx.lineTo(xa, lanes.result - amp);
    ctx.lineTo(xb, lanes.result - amp);
    ctx.lineTo(xb, lanes.result);
  }
  ctx.stroke();
  label("③ 卷积结果 p(t) = g(t) ⊛ Σ δ(t − nT)  → 周期脉冲串", "#7dd3fc");

  // annotation: what convolution actually does here
  const ax = x0 + 30;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(249,168,212,0.85)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ax, lanes.gate + amp * 0.6);
  ctx.lineTo(ax, lanes.result - amp * 1.1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax - 4, lanes.result - amp * 1.1 + 8);
  ctx.lineTo(ax, lanes.result - amp * 1.1);
  ctx.lineTo(ax + 4, lanes.result - amp * 1.1 + 8);
  ctx.stroke();
  ctx.fillStyle = "rgba(249,168,212,0.95)";
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillText("盖一次 = 复制一份", ax + 10, (lanes.gate + lanes.result) / 2);
}

function drawSpectrum() {
  const { ctx, w, h } = fitCanvas(els.spec);
  ctx.clearRect(0, 0, w, h);

  const x0 = 46;
  const x1 = w - 12;
  const padTop = 14;
  const padBottom = 22;
  const plotH = h - padTop - padBottom;
  const plotW = x1 - x0;
  const fMax = MAX_LINES;
  const fToX = (f) => x0 + (plotW * f) / fMax;

  const full = 2 * duty; // a line can never exceed this
  const scale = (v) => padTop + plotH - (v / full) * plotH;

  // grid
  ctx.strokeStyle = "#16202f";
  for (let k = 0; k <= 4; k++) {
    const y = padTop + (plotH * k) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }

  // envelope zeros
  for (const f of envelopeZeros(duty, fMax)) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(251,191,36,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fToX(f), padTop);
    ctx.lineTo(fToX(f), padTop + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // the continuous envelope |G(f)|
  ctx.strokeStyle = "#64748b";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const steps = Math.max(600, Math.round(plotW));
  for (let i = 0; i <= steps; i++) {
    const f = (fMax * i) / steps;
    const v = Math.abs(gateSpectrum(f, duty));
    const x = x0 + (plotW * i) / steps;
    const y = scale(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // the comb samples: discrete lines
  const slot = plotW / fMax;
  for (let n = 1; n <= MAX_LINES; n++) {
    const amp = lineAmplitude(n, duty);
    const y = scale(amp);
    const x = fToX(n) - slot * 0.3;
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(x, y, Math.max(2, slot * 0.6), padTop + plotH - y);
    if (n % 5 === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px ui-monospace, Consolas, monospace";
      ctx.fillText(String(n), x, h - 7);
    }
  }

  // main lobe marker + the payoff annotation
  const lobe = mainLobeWidth(duty);
  if (lobe <= fMax) {
    const y = padTop + plotH + 8;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(fToX(lobe), y);
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.fillText(`主瓣 1/τ = ${lobe.toFixed(2)}`, Math.min(fToX(lobe) + 6, w - 120), y + 4);
    ctx.fillStyle = "#fbbf24";
    ctx.fillText("↑ 包络在这里为零 ⇒ 这根柱子消失", Math.min(fToX(lobe) + 6, w - 210), padTop + 34);
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "11px ui-monospace, Consolas, monospace";
  ctx.fillText("f / T⁻¹（谐波序号）", 4, h - 7);
}

// --- readouts ---------------------------------------------------------------
function refresh() {
  els.dutyOut.textContent = duty.toFixed(2);
  els.fOut.textContent = String(frequency);

  const lobe = mainLobeWidth(duty);
  els.lobe.textContent = lobe.toFixed(2);
  els.firstZero.textContent = lobe.toFixed(2);
  els.zeroHarmonic.textContent = Number.isInteger(lobe)
    ? `n = ${lobe} 整根消失`
    : `n ≈ ${lobe.toFixed(2)} 附近最弱`;
  const zeros = envelopeZeros(duty, 32);
  els.zeros.textContent = zeros.length ? `${zeros.slice(0, 6).join(", ")}${zeros.length > 6 ? " …" : ""}` : "（范围内无）";

  const firstLine = lineAmplitude(1, duty);
  els.nowline.textContent =
    `τ = ${duty.toFixed(2)}　→　G(0) = τ = ${duty.toFixed(2)}，` +
    `第 1 根谱线幅度 2|G(1)| = ${firstLine.toFixed(3)}`;
  els.note.textContent =
    `主瓣宽度 1/τ = ${lobe.toFixed(2)} 谐波　·　` +
    `τ 越大 → 包络越窄 → 谐波越少 → 音色越闷；` +
    `τ 越小 → 包络越宽 → 谐波越多 → 音色越亮`;

  drawTime();
  drawSpectrum();
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
    const real = new Float32Array(AUDIO_HARMONICS + 1);
    const imag = new Float32Array(AUDIO_HARMONICS + 1);
    for (const h of harmonicsOf("pulse", AUDIO_HARMONICS, duty)) {
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
      gain.gain.setTargetAtTime(0.26, ctx.currentTime, 0.02);
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

// --- wiring -----------------------------------------------------------------
els.duty.addEventListener("input", () => {
  duty = Number(els.duty.value);
  refresh();
});
els.freq.addEventListener("input", () => {
  frequency = Number(els.freq.value);
  refresh();
});
els.play.addEventListener("click", togglePlay);
els.square.addEventListener("click", () => {
  duty = 0.5;
  els.duty.value = "0.5";
  refresh();
});

// --- guided steps -----------------------------------------------------------
const STEPS = [
  {
    duty: 0.5,
    note:
      "<b>τ = 0.5：一半的时间都在盖章。</b>这时脉冲串变回方波 —— 包络的零点落在 f = 2, 4, 6…，" +
      "也就是<b>偶次谐波全没了</b>。听着：很「空」的音色。",
  },
  {
    duty: 0.25,
    note:
      "<b>τ = 0.25：章变窄了。</b>零点挪到 f = 4, 8, 12…，所以<b>每第 4 根柱子消失</b>。" +
      "这就是你之前问的「为什么脉冲串的谱长这样」—— 不是巧合，是 sinc 的零点落在那里。",
  },
  {
    duty: 0.1,
    note:
      "<b>τ = 0.1：章很窄。</b>主瓣被拉到 1/τ = 10，包络几乎平着 —— 所以窄脉冲需要一大堆谐波，" +
      "声音也最亮。这就是<b>时宽与带宽成反比</b>。",
  },
];

function applyStep(index) {
  const step = STEPS[index];
  if (!step) return;
  duty = step.duty;
  els.duty.value = String(duty);
  for (const b of els.steps.querySelectorAll("button")) {
    b.classList.toggle("on", Number(b.dataset.step) === index);
  }
  els.stepNote.innerHTML = step.note;
  refresh();
  if (!playing) togglePlay();
}

els.steps.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step]");
  if (button) applyStep(Number(button.dataset.step));
});
window.addEventListener("resize", () => {
  drawTime();
  drawSpectrum();
});

{
  const p = new URLSearchParams(location.search);
  const d = Number(p.get("duty"));
  if (Number.isFinite(d) && d >= 0.02 && d <= 0.5) {
    duty = d;
    els.duty.value = String(d);
  }
}

refresh();
window.__signalLabPulse = { get state() { return { duty, frequency, playing }; }, refresh };
