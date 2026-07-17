import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";

const fileInput = document.getElementById("fileInput");
const fileLabel = document.getElementById("fileLabel");
const analyzeButton = document.getElementById("analyzeButton");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio");
const canvas = document.getElementById("pitchCanvas");
const ctx = canvas.getContext("2d");
const summaryEl = document.getElementById("summary");
const selectedInfo = document.getElementById("selectedInfo");

const detailSelect = document.getElementById("detailSelect");
const sensitivitySelect = document.getElementById("sensitivitySelect");
const zoomSelect = document.getElementById("zoomSelect");
const analysisPreset = document.getElementById("analysisPreset");
const analysisEngine = document.getElementById("analysisEngine");
const noteDisplayMode = document.getElementById("noteDisplayMode");
const saveImageButton = document.getElementById("saveImageButton");
const playSynthButton = document.getElementById("playSynthButton");
const stopSynthButton = document.getElementById("stopSynthButton");
const segmentList = document.getElementById("segmentList");
const chartDisplayMode = document.getElementById("chartDisplayMode");
const synthVolume = document.getElementById("synthVolume");
const synthTone = document.getElementById("synthTone");
const downloadOriginalButton = document.getElementById("downloadOriginalButton");
const downloadWavButton = document.getElementById("downloadWavButton");
const exportStatus = document.getElementById("exportStatus");
const downloadSynthWavButton = document.getElementById("downloadSynthWavButton");
const synthExportStatus = document.getElementById("synthExportStatus");

const recordStartButton = document.getElementById("recordStartButton");
const recordStopButton = document.getElementById("recordStopButton");
const recordStatus = document.getElementById("recordStatus");
const recordTimer = document.getElementById("recordTimer");
const recordDot = document.getElementById("recordDot");

let audioContext = null;
let audioBuffer = null;
let audioObjectUrl = null;
let currentAudioBlob = null;
let currentAudioLabel = "";
let currentSourceKind = "";
let frames = [];
let segments = [];
let drawState = null;
let selectedSegment = null;
let rafId = null;

let pitchDragState = {
  active: false,
  pointerId: null,
  segment: null,
  originalMidi: null,
  startClientY: 0,
  changed: false,
};

let synthNodes = [];
let synthEndTimer = null;
let synthStartAudioTime = null;
let synthDuration = 0;
let isSynthPlaying = false;

let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartAt = 0;
let recordingTimerId = null;

let basicPitchInstance = null;
let basicPitchModelPromise = null;
let lastAnalysisEngineLabel = "";

const BASIC_PITCH_SAMPLE_RATE = 22050;
const BASIC_PITCH_MODEL_URL = new URL("./model/model.json", window.location.href).href;

const NOTE_NAMES = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
const MOBILE_BREAKPOINT = 760;
const SYNTH_SAMPLE_RATE = 44100;

fileInput.addEventListener("change", handleSelectedAudioFile);

async function handleSelectedAudioFile(event) {
  const file = event.target.files?.[0];

  if (!file) {
    statusEl.textContent = "音声ファイルは選択されませんでした。";
    return;
  }

  const extension = extensionFromName(file.name);
  const supportedExtensions = new Set([
    "mp3", "wav", "m4a", "aac", "ogg", "oga", "webm", "mp4"
  ]);
  const looksLikeAudio = file.type.startsWith("audio/") || supportedExtensions.has(extension);

  if (!looksLikeAudio) {
    fileLabel.textContent = "音声ファイルを選択";
    statusEl.textContent = "選択したファイルは音声として認識できませんでした。MP3・WAV・M4Aなどを選択してください。";
    event.target.value = "";
    return;
  }

  fileLabel.textContent = file.name;
  statusEl.textContent = "音源を読み込み中です。";

  try {
    await loadAudioBlob(file, {
      label: file.name,
      sourceLabel: "ファイル音源",
      status: "音源を読み込み中です。",
      kind: "file",
    });
  } catch (error) {
    console.error("Audio file selection failed.", error);
    statusEl.textContent = "音声ファイルの読み込みに失敗しました。別の形式で試してください。";
  } finally {
    // 同じファイルを続けて選び直した場合もchangeが発火するようにします。
    event.target.value = "";
  }
}

recordStartButton.addEventListener("click", startRecording);
recordStopButton.addEventListener("click", stopRecording);

analyzeButton.addEventListener("click", async () => {
  if (!audioBuffer) return;

  stopSynthPlayback({ silent: true });
  analyzeButton.disabled = true;
  selectedSegment = null;
  statusEl.textContent = "解析を開始します。";

  try {
    let result;

    if (analysisEngine?.value === "basicPitch") {
      try {
        statusEl.textContent = "Basic Pitchを準備しています。初回は少し時間がかかります。";
        result = await analyzeWithBasicPitch(audioBuffer);
        lastAnalysisEngineLabel = "Basic Pitch高精度解析";
      } catch (basicPitchError) {
        console.error("Basic Pitch analysis failed. Falling back.", basicPitchError);
        statusEl.textContent = "Basic Pitch解析を利用できなかったため、通常解析へ切り替えます。";
        result = await analyzePitch(audioBuffer, {
          detail: detailSelect.value,
          sensitivity: sensitivitySelect.value,
        });
        lastAnalysisEngineLabel = "通常解析（自動切替）";
      }
    } else {
      result = await analyzePitch(audioBuffer, {
        detail: detailSelect.value,
        sensitivity: sensitivitySelect.value,
      });
      lastAnalysisEngineLabel = "通常解析";
    }

    frames = result.frames;
    segments = result.segments;

    if (segments.length === 0) {
      statusEl.textContent = "音程を検出できませんでした。声を少し大きめにした音源や、雑音の少ない音源で試してください。";
      summaryEl.textContent = "検出できた音程バーはありません。";
      renderSegmentList();
      clearCanvas();
      updateResultButtons();
      return;
    }

    statusEl.textContent = `${lastAnalysisEngineLabel}が完了しました。スマホでは下の「音の流れ」も確認できます。`;
    if (synthExportStatus) synthExportStatus.textContent = "解析されたドレミ音をWAV保存できます。";
    updateSummary(result);
    renderSegmentList();
    drawPitchBars();
  } catch (error) {
    console.error(error);
    statusEl.textContent = "解析中にエラーが起きました。短めの音源で再度試してください。";
  } finally {
    analyzeButton.disabled = false;
  }
});

audioEl.addEventListener("play", () => {
  stopSynthPlayback({ silent: true });
  startPlayhead();
});
audioEl.addEventListener("pause", stopPlayhead);
audioEl.addEventListener("ended", stopPlayhead);

canvas.addEventListener("pointerdown", handlePitchPointerDown);
canvas.addEventListener("pointermove", handlePitchPointerMove);
canvas.addEventListener("pointerup", handlePitchPointerUp);
canvas.addEventListener("pointercancel", handlePitchPointerCancel);

function handlePitchPointerDown(event) {
  if (!drawState || segments.length === 0) return;

  const point = canvasEventToLogicalPoint(event);
  const seg = hitTestSegment(point.x, point.y);
  if (!seg) return;

  stopSynthPlayback({ silent: true });
  if (!audioEl.paused) audioEl.pause();

  selectedSegment = seg;
  pitchDragState = {
    active: true,
    pointerId: event.pointerId,
    segment: seg,
    originalMidi: seg.midi,
    startClientY: event.clientY,
    changed: false,
  };

  canvas.classList.add("is-dragging");

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // 一部ブラウザでは利用できないため無視します。
  }

  selectedInfo.innerHTML = `
    <strong>${displayNoteName(seg.midi)}</strong>
    ／ 上下にドラッグして高さを変更
  `;
  renderCanvas();
}

function handlePitchPointerMove(event) {
  if (!pitchDragState.active || event.pointerId !== pitchDragState.pointerId || !drawState) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const logicalScaleY = drawState.height / Math.max(1, rect.height);
  const logicalDeltaY = (pitchDragState.startClientY - event.clientY) * logicalScaleY;

  if (Math.abs(logicalDeltaY) < 4) return;

  event.preventDefault();

  const semitoneDelta = Math.round(logicalDeltaY / drawState.rowHeight);
  const nextMidi = clampMidi(pitchDragState.originalMidi + semitoneDelta);
  const seg = pitchDragState.segment;

  if (!seg || nextMidi === seg.midi) return;

  seg.midi = nextMidi;
  seg.noteName = midiToNoteName(nextMidi);
  seg.freq = midiToFrequency(nextMidi);
  pitchDragState.changed = true;

  selectedInfo.innerHTML = `
    <strong>${displayNoteName(seg.midi)}</strong>
    ／ ${formatTime(seg.start)} 〜 ${formatTime(seg.end)}
    ／ 高さを編集中
  `;

  if (!drawState.rows.includes(nextMidi)) {
    drawPitchBars();
  } else {
    renderCanvas();
  }
}

function handlePitchPointerUp(event) {
  if (!pitchDragState.active || event.pointerId !== pitchDragState.pointerId) return;
  finishPitchPointerInteraction(event, false);
}

function handlePitchPointerCancel(event) {
  if (!pitchDragState.active || event.pointerId !== pitchDragState.pointerId) return;
  finishPitchPointerInteraction(event, true);
}

function finishPitchPointerInteraction(event, cancelled) {
  const seg = pitchDragState.segment;
  const changed = pitchDragState.changed;
  const originalMidi = pitchDragState.originalMidi;

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    // ポインターキャプチャがない場合は無視します。
  }

  canvas.classList.remove("is-dragging");

  if (!seg) {
    resetPitchDragState();
    return;
  }

  if (cancelled && changed) {
    seg.midi = originalMidi;
    seg.noteName = midiToNoteName(seg.midi);
    seg.freq = midiToFrequency(seg.midi);
  }

  if (changed && !cancelled) {
    selectedSegment = seg;
    updateSummary({ segments });
    renderSegmentList();
    drawPitchBars();

    statusEl.textContent = `バーの高さを「${displayNoteName(seg.midi)}」に変更しました。`;
    selectedInfo.innerHTML = `
      <strong>${displayNoteName(seg.midi)}</strong>
      ／ ${formatTime(seg.start)} 〜 ${formatTime(seg.end)}
      ／ 約${seg.freq.toFixed(1)}Hz
    `;

    if (synthExportStatus) {
      synthExportStatus.textContent = "編集後のドレミ音をWAV保存できます。";
    }
  } else {
    selectedSegment = seg;
    audioEl.currentTime = Math.max(0, seg.start);
    selectedInfo.innerHTML = `
      <strong>${displayNoteName(seg.midi)}</strong>
      ／ ${formatTime(seg.start)} 〜 ${formatTime(seg.end)}
      ／ 約${seg.freq.toFixed(1)}Hz
    `;
    renderCanvas();
  }

  resetPitchDragState();
}

function resetPitchDragState() {
  pitchDragState = {
    active: false,
    pointerId: null,
    segment: null,
    originalMidi: null,
    startClientY: 0,
    changed: false,
  };
}

function canvasEventToLogicalPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * (drawState.width / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (drawState.height / Math.max(1, rect.height)),
  };
}

function clampMidi(midi) {
  return Math.max(24, Math.min(96, Math.round(midi)));
}

window.addEventListener("resize", () => {
  if (segments.length > 0) drawPitchBars();
});


analysisPreset.addEventListener("change", () => {
  applyAnalysisPreset(analysisPreset.value);
});

detailSelect.addEventListener("change", markCustomPreset);
sensitivitySelect.addEventListener("change", markCustomPreset);
zoomSelect.addEventListener("change", () => {
  markCustomPreset();
  if (segments.length > 0) drawPitchBars();
});

applyAnalysisPreset("auto");

noteDisplayMode.addEventListener("change", () => {
  if (segments.length > 0) {
    updateSummary({
      segments,
    });
    renderSegmentList();
    drawPitchBars();
  }
});

chartDisplayMode.addEventListener("change", () => {
  if (segments.length > 0) {
    drawPitchBars();
    const modeText = chartDisplayMode.value === "fit" ? "全体表示" : "横スクロール表示";
    statusEl.textContent = `音程バーを${modeText}に切り替えました。`;
  }
});

saveImageButton.addEventListener("click", savePitchImage);
playSynthButton.addEventListener("click", playSynthFromBars);
stopSynthButton.addEventListener("click", () => stopSynthPlayback());
if (downloadOriginalButton) downloadOriginalButton.addEventListener("click", downloadOriginalAudio);
if (downloadWavButton) downloadWavButton.addEventListener("click", downloadWavAudio);
if (downloadSynthWavButton) downloadSynthWavButton.addEventListener("click", downloadSynthWavAudio);



function applyAnalysisPreset(value) {
  const presets = {
    auto: {
      detail: "normal",
      sensitivity: "normal",
      zoom: "95",
      message: "おまかせ：通常の鼻歌・歌声向けです。",
    },
    smallVoice: {
      detail: "normal",
      sensitivity: "high",
      zoom: "95",
      message: "声が小さいとき：小さめの声も拾いやすくします。",
    },
    noisy: {
      detail: "normal",
      sensitivity: "low",
      zoom: "95",
      message: "雑音が多いとき：小さい雑音を拾いにくくします。",
    },
    smooth: {
      detail: "rough",
      sensitivity: "normal",
      zoom: "95",
      message: "なめらか表示：細かい揺れを拾いすぎないようにします。",
    },
  };

  const preset = presets[value] || presets.auto;
  detailSelect.value = preset.detail;
  sensitivitySelect.value = preset.sensitivity;
  zoomSelect.value = preset.zoom;

  if (!audioBuffer) {
    statusEl.textContent = `${preset.message} 音源を選択するか、録音してください。`;
  } else {
    statusEl.textContent = `${preset.message} 解析できます。`;
  }

  if (segments.length > 0) drawPitchBars();
}

function markCustomPreset() {
  const presetMap = {
    auto: ["normal", "normal", "95"],
    smallVoice: ["normal", "high", "95"],
    noisy: ["normal", "low", "95"],
    smooth: ["rough", "normal", "95"],
  };

  const current = [detailSelect.value, sensitivitySelect.value, zoomSelect.value];

  for (const [name, values] of Object.entries(presetMap)) {
    if (values.every((value, index) => value === current[index])) {
      analysisPreset.value = name;
      return;
    }
  }
}

function updateExportButtons() {
  // 保存ボタンは常に押せる状態にします。
  // データがない場合は、各保存処理内で理由を表示します。
  if (downloadOriginalButton) downloadOriginalButton.disabled = false;
  if (downloadWavButton) downloadWavButton.disabled = false;
}

async function downloadSynthWavAudio() {
  if (!segments.length) {
    if (synthExportStatus) synthExportStatus.textContent = "保存できるドレミ音がありません。先に解析してください。";
    return;
  }

  try {
    if (downloadSynthWavButton) downloadSynthWavButton.classList.add("is-processing");
    if (synthExportStatus) synthExportStatus.textContent = "ドレミ音のWAVを作成中です。";

    const wavBlob = await renderSynthSegmentsToWavBlob();
    const filename = `doremi_keyboard_${timestampForFile()}.wav`;

    downloadBlob(wavBlob, filename);
    if (synthExportStatus) synthExportStatus.textContent = `ドレミ音をWAV保存しました：${filename}`;
  } catch (error) {
    console.error(error);
    if (synthExportStatus) synthExportStatus.textContent = "ドレミ音のWAV保存中にエラーが起きました。短めの音源で再度試してください。";
  } finally {
    if (downloadSynthWavButton) downloadSynthWavButton.classList.remove("is-processing");
    updateResultButtons();
  }
}

async function renderSynthSegmentsToWavBlob() {
  const lastEnd = Math.max(...segments.map((seg) => seg.end));
  const duration = Math.max(0.5, lastEnd + 0.45);
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  if (OfflineCtx) {
    try {
      const length = Math.ceil(duration * SYNTH_SAMPLE_RATE);
      const offline = new OfflineCtx(2, length, SYNTH_SAMPLE_RATE);
      const masterGain = offline.createGain();
      const compressor = offline.createDynamicsCompressor();
      const volumeMultiplier = Number(synthVolume?.value || 2.6);

      masterGain.gain.setValueAtTime(volumeMultiplier, 0);
      compressor.threshold.setValueAtTime(-12, 0);
      compressor.knee.setValueAtTime(18, 0);
      compressor.ratio.setValueAtTime(7, 0);
      compressor.attack.setValueAtTime(0.006, 0);
      compressor.release.setValueAtTime(0.22, 0);

      masterGain.connect(compressor);
      compressor.connect(offline.destination);

      const temporaryNodes = [];
      for (const seg of segments) {
        const start = Math.max(0, seg.start);
        const end = Math.max(seg.start + 0.05, seg.end);
        scheduleKeyboardNote(offline, masterGain, seg.midi, start, end, synthTone?.value || "keyboard", temporaryNodes);
      }

      const rendered = await offline.startRendering();
      return audioBufferToWavBlob(rendered);
    } catch (error) {
      console.warn("OfflineAudioContext rendering failed. Falling back to manual synth.", error);
    }
  }

  return renderSynthSegmentsToManualWavBlob(duration);
}

function renderSynthSegmentsToManualWavBlob(duration) {
  const sampleRate = SYNTH_SAMPLE_RATE;
  const channels = 2;
  const length = Math.ceil(duration * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const tone = synthTone?.value || "keyboard";
  const volume = Number(synthVolume?.value || 2.6);
  const toneConfig = getManualToneConfig(tone);

  for (const seg of segments) {
    const startIndex = Math.max(0, Math.floor(seg.start * sampleRate));
    const endIndex = Math.min(length, Math.ceil((seg.end + toneConfig.release) * sampleRate));
    const freq = midiToFrequency(seg.midi);

    for (let i = startIndex; i < endIndex; i++) {
      const t = (i - startIndex) / sampleRate;
      const noteTime = i / sampleRate - seg.start;
      const noteDuration = Math.max(0.05, seg.end - seg.start);
      const env = keyboardEnvelope(noteTime, noteDuration, toneConfig);
      if (env <= 0.00001) continue;

      let sample = 0;
      for (const partial of toneConfig.partials) {
        sample += Math.sin(2 * Math.PI * freq * partial.ratio * t) * partial.gain;
      }

      sample = Math.tanh(sample * env * toneConfig.gain * volume);
      left[i] += sample;
      right[i] += sample;
    }
  }

  let peak = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const normalize = peak > 0.98 ? 0.98 / peak : 1;

  const pseudoBuffer = {
    numberOfChannels: channels,
    sampleRate,
    length,
    getChannelData(ch) {
      const source = ch === 0 ? left : right;
      if (normalize !== 1) {
        const normalized = new Float32Array(source.length);
        for (let i = 0; i < source.length; i++) normalized[i] = source[i] * normalize;
        return normalized;
      }
      return source;
    },
  };

  return audioBufferToWavBlob(pseudoBuffer);
}

function getManualToneConfig(tone) {
  if (tone === "simple") {
    return {
      gain: 0.18,
      attack: 0.012,
      decay: 0.18,
      sustain: 0.64,
      release: 0.14,
      partials: [
        { ratio: 1, gain: 1.0 },
        { ratio: 2, gain: 0.14 },
      ],
    };
  }

  if (tone === "bright") {
    return {
      gain: 0.19,
      attack: 0.008,
      decay: 0.26,
      sustain: 0.46,
      release: 0.18,
      partials: [
        { ratio: 1, gain: 1.0 },
        { ratio: 2, gain: 0.34 },
        { ratio: 3, gain: 0.12 },
        { ratio: 4, gain: 0.05 },
      ],
    };
  }

  return {
    gain: 0.18,
    attack: 0.01,
    decay: 0.34,
    sustain: 0.42,
    release: 0.20,
    partials: [
      { ratio: 1, gain: 1.0 },
      { ratio: 2, gain: 0.27 },
      { ratio: 3, gain: 0.10 },
      { ratio: 5, gain: 0.035 },
    ],
  };
}

function keyboardEnvelope(t, duration, config) {
  if (t < 0) return 0;

  if (t < config.attack) {
    return t / config.attack;
  }

  const decayEnd = config.attack + config.decay;
  if (t < decayEnd) {
    const p = (t - config.attack) / config.decay;
    return 1 + (config.sustain - 1) * p;
  }

  if (t < duration) {
    return config.sustain;
  }

  const releaseT = t - duration;
  if (releaseT < config.release) {
    return config.sustain * (1 - releaseT / config.release);
  }

  return 0;
}

function downloadOriginalAudio() {
  if (!currentAudioBlob) {
    if (exportStatus) exportStatus.textContent = "保存できる音源がありません。先に録音または音源読み込みをしてください。";
    return;
  }

  const extension = extensionFromMime(currentAudioBlob.type) || extensionFromName(currentAudioLabel) || "webm";
  const baseName = currentSourceKind === "recording" ? "doremi_recording" : cleanFileBaseName(currentAudioLabel || "doremi_audio");
  const filename = `${baseName}_${timestampForFile()}.${extension}`;

  downloadBlob(currentAudioBlob, filename);
  if (exportStatus) exportStatus.textContent = `元の音源を保存しました：${filename}`;
}

function downloadWavAudio() {
  if (!audioBuffer) {
    if (exportStatus) exportStatus.textContent = "WAV保存できる音源がありません。先に録音または音源読み込みをしてください。";
    return;
  }

  try {
    const wavBlob = audioBufferToWavBlob(audioBuffer);
    const baseName = currentSourceKind === "recording" ? "doremi_recording" : cleanFileBaseName(currentAudioLabel || "doremi_audio");
    const filename = `${baseName}_${timestampForFile()}.wav`;

    downloadBlob(wavBlob, filename);
    if (exportStatus) exportStatus.textContent = `WAVで保存しました：${filename}`;
  } catch (error) {
    console.error(error);
    if (exportStatus) exportStatus.textContent = "WAV保存中にエラーが起きました。短めの音源で再度試してください。";
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function audioBufferToWavBlob(buffer) {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function extensionFromMime(mimeType) {
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";

  return "";
}

function extensionFromName(name) {
  const match = String(name || "").match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function cleanFileBaseName(name) {
  const withoutExt = String(name || "doremi_audio").replace(/\.[^/.]+$/, "");
  return withoutExt
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "doremi_audio";
}

function timestampForFile() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
}

async function loadAudioBlob(blob, options = {}) {
  resetResult();

  const label = options.label || "音源";
  const sourceLabel = options.sourceLabel || "音源";
  currentAudioBlob = blob;
  currentAudioLabel = label;
  currentSourceKind = options.kind || "audio";
  fileLabel.textContent = label;
  statusEl.textContent = options.status || "音源を読み込み中です。";
  updateExportButtons();

  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(blob);
  audioEl.src = audioObjectUrl;
  audioEl.classList.add("is-visible");

  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const duration = audioBuffer.duration;
    analyzeButton.disabled = false;
    statusEl.textContent = `${sourceLabel}の読み込み完了：${formatTime(duration)}。解析できます。`;
    if (exportStatus) exportStatus.textContent = `${sourceLabel}を保存できます。作曲アプリ用にはWAV保存がおすすめです。`;
    updateExportButtons();
  } catch (error) {
    console.error(error);
    audioBuffer = null;
    currentAudioBlob = null;
    currentAudioLabel = "";
    currentSourceKind = "";
    analyzeButton.disabled = true;
    fileLabel.textContent = "音声ファイルを選択";
    statusEl.textContent = "音源を読み込めませんでした。別の形式のファイルで試してください。";
    if (exportStatus) exportStatus.textContent = "音源を読み込めなかったため、保存できません。";
    updateExportButtons();
  }
}

async function startRecording() {
  currentAudioBlob = null;
  currentAudioLabel = "";
  currentSourceKind = "";
  audioBuffer = null;
  updateExportButtons();
  if (exportStatus) exportStatus.textContent = "録音中です。停止後に音源を保存できます。";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "このブラウザでは録音機能が使えません。Chrome / Edge / Safariの最新版で試してください。";
    return;
  }

  resetResult();

  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();

    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    recordedChunks = [];

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : undefined;
    mediaRecorder = new MediaRecorder(recordingStream, options);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", async () => {
      const blobType = mediaRecorder.mimeType || "audio/webm";
      const recordingBlob = new Blob(recordedChunks, { type: blobType });

      stopRecordingTracks();
      stopRecordingTimer();

      recordDot.classList.remove("is-recording");
      recordStatus.textContent = "録音完了";
      recordStartButton.disabled = false;
      recordStopButton.disabled = true;

      if (recordingBlob.size === 0) {
        statusEl.textContent = "録音データを作成できませんでした。もう一度試してください。";
        return;
      }

      await loadAudioBlob(recordingBlob, {
        label: "録音した音源",
        sourceLabel: "録音音源",
        status: "録音音源を読み込み中です。",
        kind: "recording",
      });
    });

    mediaRecorder.start();
    recordingStartAt = Date.now();
    startRecordingTimer();

    recordDot.classList.add("is-recording");
    recordStatus.textContent = "録音中";
    recordTimer.textContent = "0:00";
    recordStartButton.disabled = true;
    recordStopButton.disabled = false;
    analyzeButton.disabled = true;
    statusEl.textContent = "録音中です。鼻歌や歌声を入れて、終わったら録音停止を押してください。";
  } catch (error) {
    console.error(error);
    stopRecordingTracks();
    stopRecordingTimer();
    recordDot.classList.remove("is-recording");
    recordStatus.textContent = "録音できませんでした";
    recordStartButton.disabled = false;
    recordStopButton.disabled = true;

    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      statusEl.textContent = "録音にはHTTPSまたはlocalhost環境が必要な場合があります。Vercelなどに公開するか、ローカルサーバーで開いてください。";
    } else {
      statusEl.textContent = "マイクを使えませんでした。ブラウザのマイク許可を確認してください。";
    }
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.stop();
  recordStatus.textContent = "録音を保存中";
  recordStopButton.disabled = true;
  statusEl.textContent = "録音データを作成しています。";
}

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      return type;
    }
  }

  return "";
}

function startRecordingTimer() {
  stopRecordingTimer();
  recordingTimerId = setInterval(() => {
    const elapsed = (Date.now() - recordingStartAt) / 1000;
    recordTimer.textContent = formatTime(elapsed);
  }, 250);
}

function stopRecordingTimer() {
  if (recordingTimerId) clearInterval(recordingTimerId);
  recordingTimerId = null;
}

function stopRecordingTracks() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
  }
  recordingStream = null;
}

function resetResult() {
  stopSynthPlayback({ silent: true });
  frames = [];
  segments = [];
  lastAnalysisEngineLabel = "";
  drawState = null;
  selectedSegment = null;
  resetPitchDragState();
  canvas.classList.remove("is-dragging");
  summaryEl.textContent = "解析結果はここに表示されます。";
  selectedInfo.textContent = "バーをタップすると選択、上下にドラッグすると音の高さを変更できます。";
  if (segmentList) segmentList.textContent = "解析後に、音の流れがここに表示されます。";
  if (synthExportStatus) synthExportStatus.textContent = "解析後に保存できます。";
  updateResultButtons();
  clearCanvas();
}

function clearCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const safeWidth = Math.max(240, Math.min(wrap?.getBoundingClientRect().width || window.innerWidth - 18, window.innerWidth - 18));
  const safeHeight = 240;

  if (wrap) {
    wrap.style.width = "100%";
    wrap.style.maxWidth = "100%";
    wrap.style.setProperty("--canvas-width", `${safeWidth}px`);
    wrap.style.setProperty("--canvas-height", `${safeHeight}px`);
    wrap.style.height = `${safeHeight}px`;
    wrap.scrollLeft = 0;
  }

  canvas.style.width = `${safeWidth}px`;
  canvas.style.height = `${safeHeight}px`;
  canvas.width = Math.floor(safeWidth * ratio);
  canvas.height = safeHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, safeWidth, safeHeight);
}

async function getBasicPitchInstance() {
  if (basicPitchInstance) return basicPitchInstance;

  if (!basicPitchModelPromise) {
    basicPitchModelPromise = Promise.resolve().then(() => {
      basicPitchInstance = new BasicPitch(BASIC_PITCH_MODEL_URL);
      return basicPitchInstance;
    });
  }

  return basicPitchModelPromise;
}

async function analyzeWithBasicPitch(buffer) {
  const instance = await getBasicPitchInstance();
  const mono = toMono(buffer);
  const resampled = resampleLinear(mono, buffer.sampleRate, BASIC_PITCH_SAMPLE_RATE);

  const modelFrames = [];
  const modelOnsets = [];
  const modelContours = [];

  await instance.evaluateModel(
    resampled,
    (frameChunk, onsetChunk, contourChunk) => {
      modelFrames.push(...frameChunk);
      modelOnsets.push(...onsetChunk);
      modelContours.push(...contourChunk);
    },
    (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      statusEl.textContent = `Basic Pitchで解析中... ${percent}%`;
    },
  );

  if (!modelFrames.length || !modelOnsets.length) {
    throw new Error("Basic Pitch returned no model output.");
  }

  const config = getBasicPitchThresholds();
  const rawNotes = outputToNotesPoly(
    modelFrames,
    modelOnsets,
    config.onsetThreshold,
    config.frameThreshold,
    config.minNoteLengthFrames,
    true,
    null,
    75,
    true,
    config.energyTolerance,
  );

  const notesWithBends = addPitchBendsToNoteEvents(modelContours, rawNotes);
  const timedNotes = noteFramesToTime(notesWithBends);
  const basicFrames = basicPitchNotesToMonophonicFrames(timedNotes, buffer.duration);
  const basicSegments = framesToSegments(basicFrames, config.minSegmentSeconds);

  return {
    frames: basicFrames,
    segments: basicSegments,
    duration: buffer.duration,
    engine: "basic-pitch",
  };
}

function getBasicPitchThresholds() {
  const preset = analysisPreset?.value || "auto";

  const presets = {
    auto: {
      onsetThreshold: 0.25,
      frameThreshold: 0.25,
      minNoteLengthFrames: 5,
      energyTolerance: 7,
      minSegmentSeconds: 0.05,
    },
    smallVoice: {
      onsetThreshold: 0.18,
      frameThreshold: 0.18,
      minNoteLengthFrames: 4,
      energyTolerance: 8,
      minSegmentSeconds: 0.05,
    },
    noisy: {
      onsetThreshold: 0.34,
      frameThreshold: 0.32,
      minNoteLengthFrames: 6,
      energyTolerance: 6,
      minSegmentSeconds: 0.05,
    },
    smooth: {
      onsetThreshold: 0.28,
      frameThreshold: 0.30,
      minNoteLengthFrames: 8,
      energyTolerance: 7,
      minSegmentSeconds: 0.05,
    },
  };

  return presets[preset] || presets.auto;
}

function basicPitchNotesToMonophonicFrames(noteEvents, duration) {
  const hopSeconds = 0.05;
  const notes = noteEvents
    .map((note) => ({
      start: Number(note.startTimeSeconds),
      end: Number(note.startTimeSeconds) + Number(note.durationSeconds),
      midi: Math.round(Number(note.pitchMidi)),
      amplitude: Number(note.amplitude || 0),
      pitchBends: Array.isArray(note.pitchBends) ? note.pitchBends : [],
    }))
    .filter((note) =>
      Number.isFinite(note.start) &&
      Number.isFinite(note.end) &&
      Number.isFinite(note.midi) &&
      note.end > note.start &&
      note.midi >= 24 &&
      note.midi <= 96
    );

  const output = [];
  let previousMidi = null;

  for (let time = 0; time < duration; time += hopSeconds) {
    const center = time + hopSeconds / 2;
    const active = notes.filter((note) => note.start <= center && note.end > center);

    if (!active.length) {
      output.push(createBasicPitchFrame(time, hopSeconds, null, 0));
      previousMidi = null;
      continue;
    }

    active.sort((a, b) => {
      const amplitudeDifference = b.amplitude - a.amplitude;
      if (Math.abs(amplitudeDifference) > 0.001) {
        return amplitudeDifference;
      }
      return b.start - a.start;
    });

    const selected = active[0];
    const bend = getAveragePitchBend(selected.pitchBends);
    const midi = clampMidi(selected.midi + bend);
    output.push(createBasicPitchFrame(time, hopSeconds, midi, selected.amplitude));
    previousMidi = midi;
  }

  return smoothBasicPitchFrames(output);
}

function createBasicPitchFrame(time, duration, midi, confidence) {
  if (!Number.isFinite(midi)) {
    return {
      time,
      duration,
      freq: null,
      midi: null,
      noteName: null,
      confidence: 0,
    };
  }

  return {
    time,
    duration,
    freq: midiToFrequency(midi),
    midi,
    noteName: midiToNoteName(midi),
    confidence: Math.max(0, Math.min(1, confidence || 0)),
  };
}

function getAveragePitchBend(pitchBends) {
  if (!pitchBends?.length) return 0;

  const sorted = pitchBends
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const median = sorted[Math.floor(sorted.length / 2)];
  // Basic Pitchのbendは1/3半音単位。バー表示は半音単位なので丸めます。
  return Math.round(median / 3);
}

function smoothBasicPitchFrames(inputFrames) {
  const output = inputFrames.map((frame) => ({ ...frame }));

  for (let i = 1; i < output.length - 1; i++) {
    const prev = output[i - 1];
    const current = output[i];
    const next = output[i + 1];

    if (!current.midi && prev.midi && next.midi && prev.midi === next.midi) {
      output[i] = {
        ...current,
        midi: prev.midi,
        noteName: midiToNoteName(prev.midi),
        freq: midiToFrequency(prev.midi),
        confidence: Math.min(prev.confidence, next.confidence) * 0.9,
      };
      continue;
    }

    if (current.midi && prev.midi && next.midi) {
      const values = [prev.midi, current.midi, next.midi].sort((a, b) => a - b);
      const median = values[1];
      if (Math.abs(current.midi - median) >= 2) {
        output[i].midi = median;
        output[i].noteName = midiToNoteName(median);
        output[i].freq = midiToFrequency(median);
      }
    }
  }

  return output;
}

async function analyzePitch(buffer, options) {
  const sourceSampleRate = buffer.sampleRate;
  const mono = toMono(buffer);
  const targetSampleRate = 12000;
  const samples = resampleLinear(mono, sourceSampleRate, targetSampleRate);

  const detail = {
    rough: { hopSec: 0.14, minSegmentSec: 0.14 },
    normal: { hopSec: 0.09, minSegmentSec: 0.10 },
    fine: { hopSec: 0.06, minSegmentSec: 0.08 },
  }[options.detail] || { hopSec: 0.09, minSegmentSec: 0.10 };

  const sensitivity = {
    low: { rms: 0.028, yinThreshold: 0.13, clarity: 0.76 },
    normal: { rms: 0.018, yinThreshold: 0.16, clarity: 0.70 },
    high: { rms: 0.010, yinThreshold: 0.19, clarity: 0.62 },
  }[options.sensitivity] || { rms: 0.018, yinThreshold: 0.16, clarity: 0.70 };

  const windowSize = 1024;
  const hopSize = Math.max(1, Math.round(detail.hopSec * targetSampleRate));
  const minFreq = 75;
  const maxFreq = 1000;

  const outFrames = [];
  const totalSteps = Math.max(1, Math.floor((samples.length - windowSize) / hopSize));

  for (let start = 0, i = 0; start + windowSize < samples.length; start += hopSize, i++) {
    const time = start / targetSampleRate;

    const rms = frameRms(samples, start, windowSize);
    if (rms < sensitivity.rms) {
      outFrames.push({
        time,
        duration: hopSize / targetSampleRate,
        freq: null,
        midi: null,
        noteName: null,
        confidence: 0,
      });
    } else {
      const pitch = detectPitchYin(samples, start, windowSize, targetSampleRate, {
        minFreq,
        maxFreq,
        yinThreshold: sensitivity.yinThreshold,
      });

      if (pitch && pitch.confidence >= sensitivity.clarity) {
        const midi = frequencyToMidi(pitch.frequency);
        outFrames.push({
          time,
          duration: hopSize / targetSampleRate,
          freq: pitch.frequency,
          midi,
          noteName: midiToNoteName(midi),
          confidence: pitch.confidence,
        });
      } else {
        outFrames.push({
          time,
          duration: hopSize / targetSampleRate,
          freq: null,
          midi: null,
          noteName: null,
          confidence: pitch?.confidence || 0,
        });
      }
    }

    if (i % 25 === 0) {
      const progress = Math.min(99, Math.round((i / totalSteps) * 100));
      statusEl.textContent = `解析中... ${progress}%`;
      await sleep(0);
    }
  }

  const smoothed = smoothFrames(outFrames);
  const outSegments = framesToSegments(smoothed, detail.minSegmentSec);

  return {
    frames: smoothed,
    segments: outSegments,
    sampleCount: samples.length,
    sampleRate: targetSampleRate,
    duration: buffer.duration,
  };
}

function toMono(buffer) {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

function resampleLinear(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;

  const ratio = sourceRate / targetRate;
  const newLength = Math.floor(input.length / ratio);
  const output = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const index = Math.floor(srcIndex);
    const frac = srcIndex - index;
    const a = input[index] || 0;
    const b = input[index + 1] || a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

function frameRms(samples, start, size) {
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const v = samples[start + i];
    sum += v * v;
  }
  return Math.sqrt(sum / size);
}

function detectPitchYin(samples, start, windowSize, sampleRate, options) {
  const minTau = Math.max(2, Math.floor(sampleRate / options.maxFreq));
  const maxTau = Math.min(windowSize - 2, Math.ceil(sampleRate / options.minFreq));
  const yinBuffer = new Float32Array(maxTau + 1);

  yinBuffer[0] = 1;

  for (let tau = minTau; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < windowSize - tau; i++) {
      const delta = samples[start + i] - samples[start + i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  let runningSum = 0;
  for (let tau = minTau; tau <= maxTau; tau++) {
    runningSum += yinBuffer[tau];
    if (runningSum === 0) {
      yinBuffer[tau] = 1;
    } else {
      yinBuffer[tau] = yinBuffer[tau] * tau / runningSum;
    }
  }

  let tauEstimate = -1;
  for (let tau = minTau + 1; tau < maxTau; tau++) {
    if (yinBuffer[tau] < options.yinThreshold && yinBuffer[tau] <= yinBuffer[tau + 1]) {
      while (tau + 1 < maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    let minValue = Infinity;
    let minIndex = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (yinBuffer[tau] < minValue) {
        minValue = yinBuffer[tau];
        minIndex = tau;
      }
    }
    if (minValue > 0.26) return null;
    tauEstimate = minIndex;
  }

  const betterTau = parabolicInterpolation(yinBuffer, tauEstimate);
  const frequency = sampleRate / betterTau;
  const confidence = Math.max(0, Math.min(1, 1 - yinBuffer[tauEstimate]));

  if (!Number.isFinite(frequency) || frequency < options.minFreq || frequency > options.maxFreq) {
    return null;
  }

  return { frequency, confidence };
}

function parabolicInterpolation(buffer, tau) {
  const x0 = tau < 1 ? tau : tau - 1;
  const x2 = tau + 1 < buffer.length ? tau + 1 : tau;

  if (x0 === tau || x2 === tau) return tau;

  const s0 = buffer[x0];
  const s1 = buffer[tau];
  const s2 = buffer[x2];
  const denominator = 2 * (2 * s1 - s2 - s0);

  if (denominator === 0) return tau;
  return tau + (s2 - s0) / denominator;
}

function smoothFrames(inputFrames) {
  const output = inputFrames.map((frame) => ({ ...frame }));

  for (let i = 1; i < output.length - 1; i++) {
    const prev = output[i - 1];
    const cur = output[i];
    const next = output[i + 1];

    if (!cur.midi && prev.midi && next.midi && prev.midi === next.midi) {
      output[i].midi = prev.midi;
      output[i].noteName = prev.noteName;
      output[i].freq = prev.freq;
      output[i].confidence = Math.min(prev.confidence, next.confidence) * 0.92;
    }

    if (cur.midi && prev.midi && next.midi) {
      const sorted = [prev.midi, cur.midi, next.midi].sort((a, b) => a - b);
      const median = sorted[1];

      if (Math.abs(cur.midi - median) >= 2) {
        output[i].midi = median;
        output[i].noteName = midiToNoteName(median);
        output[i].freq = midiToFrequency(median);
      }
    }
  }

  return output;
}

function framesToSegments(inputFrames, minSegmentSec) {
  const result = [];
  let current = null;

  for (const frame of inputFrames) {
    if (!frame.midi) {
      if (current) {
        current.end = frame.time;
        result.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = createSegmentFromFrame(frame);
      continue;
    }

    const gap = frame.time - current.end;
    const isSameOrNear = Math.abs(frame.midi - current.midi) <= 0;
    const isContinuous = gap <= frame.duration * 1.8;

    if (isSameOrNear && isContinuous) {
      current.end = frame.time + frame.duration;
      current.freqValues.push(frame.freq);
      current.confValues.push(frame.confidence);
      current.freq = average(current.freqValues);
      current.confidence = average(current.confValues);
    } else {
      result.push(current);
      current = createSegmentFromFrame(frame);
    }
  }

  if (current) result.push(current);

  return result
    .filter((seg) => seg.end - seg.start >= minSegmentSec)
    .map((seg) => ({
      ...seg,
      noteName: midiToNoteName(seg.midi),
      freq: average(seg.freqValues),
      confidence: average(seg.confValues),
    }));
}

function createSegmentFromFrame(frame) {
  return {
    start: frame.time,
    end: frame.time + frame.duration,
    midi: frame.midi,
    noteName: frame.noteName,
    freq: frame.freq,
    confidence: frame.confidence,
    freqValues: [frame.freq],
    confValues: [frame.confidence],
  };
}

function getDisplayMidiRange(targetSegments) {
  const midiValues = targetSegments
    .map((seg) => seg.midi)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!midiValues.length) {
    return { minMidi: 48, maxMidi: 72 };
  }

  // 解析ミスによる極端な外れ値があると、スマホで縦長になりすぎるため、
  // 表示範囲だけは中央寄りの音域を優先します。解析データ自体は消しません。
  const rawMin = midiValues[0];
  const rawMax = midiValues[midiValues.length - 1];
  let minMidi = rawMin;
  let maxMidi = rawMax;

  if (rawMax - rawMin > 28 && midiValues.length >= 8) {
    minMidi = percentileValue(midiValues, 0.08);
    maxMidi = percentileValue(midiValues, 0.92);
  }

  minMidi = Math.max(24, Math.floor(minMidi) - 2);
  maxMidi = Math.min(96, Math.ceil(maxMidi) + 2);

  // それでも広すぎる場合は、中央値を中心に最大約2オクターブ半に収めます。
  if (maxMidi - minMidi > 30) {
    const center = percentileValue(midiValues, 0.5);
    minMidi = Math.max(24, Math.floor(center - 15));
    maxMidi = Math.min(96, Math.ceil(center + 15));
  }

  if (maxMidi <= minMidi) {
    maxMidi = minMidi + 4;
  }

  return { minMidi, maxMidi };
}

function percentileValue(sortedValues, ratio) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * ratio))
  );
  return sortedValues[index];
}

function drawPitchBars() {
  if (!segments.length) {
    clearCanvas();
    updateResultButtons();
    return;
  }
  updateResultButtons();

  const duration = audioBuffer?.duration || segments[segments.length - 1].end || 1;
  const displayRange = getDisplayMidiRange(segments);
  const minMidi = displayRange.minMidi;
  const maxMidi = displayRange.maxMidi;
  const rows = [];

  for (let midi = maxMidi; midi >= minMidi; midi--) {
    rows.push(midi);
  }

  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const isFitMode = chartDisplayMode.value === "fit";
  const dpr = window.devicePixelRatio || 1;
  const left = isMobile ? 56 : 68;
  const right = isMobile ? 16 : 24;
  const top = isMobile ? 30 : 26;
  const bottom = isMobile ? 40 : 34;
  const rowHeight = isMobile ? 34 : 30;
  const selectedPxPerSec = Number(zoomSelect.value || 95);
  const wrapRectWidth = canvas.parentElement?.getBoundingClientRect().width || 0;
  const viewportSafeWidth = Math.max(240, Math.min(wrapRectWidth || window.innerWidth - 18, window.innerWidth - 18));
  const availableWidth = Math.max(220, viewportSafeWidth - left - right);
  const pxPerSec = isFitMode
    ? Math.max(8, availableWidth / Math.max(duration, 1))
    : selectedPxPerSec;
  const chartWidth = isFitMode
    ? availableWidth
    : Math.max(availableWidth, duration * pxPerSec);
  const width = Math.ceil(left + chartWidth + right);
  const height = Math.ceil(top + rows.length * rowHeight + bottom);

  const wrap = canvas.parentElement;
  if (wrap) {
    wrap.style.width = "100%";
    wrap.style.maxWidth = "100%";
    wrap.style.setProperty("--canvas-width", `${width}px`);
    wrap.style.setProperty("--canvas-height", `${height}px`);
    wrap.style.height = `${height}px`;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawState = {
    duration,
    minMidi,
    maxMidi,
    rows,
    left,
    right,
    top,
    bottom,
    rowHeight,
    chartWidth,
    width,
    height,
    pxPerSec,
    isMobile,
    isFitMode,
  };

  renderCanvas();
}

function renderCanvas() {
  if (!drawState) return;

  const s = drawState;
  ctx.clearRect(0, 0, s.width, s.height);

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, s.width, s.height);

  drawGrid(s);
  drawBars(s);
  drawPlayhead(s);
}

function drawGrid(s) {
  ctx.font = s.isMobile ? "14px sans-serif" : "13px sans-serif";
  ctx.textBaseline = "middle";

  s.rows.forEach((midi, index) => {
    const y = s.top + index * s.rowHeight;
    const isNatural = !midiToNoteName(midi).includes("#");

    ctx.fillStyle = isNatural ? "#fffaf2" : "#fffdf8";
    ctx.fillRect(0, y, s.width, s.rowHeight);

    ctx.strokeStyle = "#f0e1d2";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.left, y + s.rowHeight);
    ctx.lineTo(s.width - s.right, y + s.rowHeight);
    ctx.stroke();

    ctx.fillStyle = isNatural ? "#7a5740" : "#b79678";
    ctx.textAlign = "right";
    ctx.fillText(displayNoteName(midi), s.left - 12, y + s.rowHeight / 2);
  });

  const seconds = Math.ceil(s.duration);
  const timeStep = s.isFitMode
    ? Math.max(1, Math.ceil(s.duration / 6))
    : 1;

  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let sec = 0; sec <= seconds; sec += timeStep) {
    const x = s.left + sec * s.pxPerSec;

    ctx.strokeStyle = sec % 5 === 0 ? "#dcc5ad" : "#f1e4d6";
    ctx.lineWidth = sec % 5 === 0 ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, s.top);
    ctx.lineTo(x, s.height - s.bottom);
    ctx.stroke();

    ctx.fillStyle = "#9b7c61";
    ctx.fillText(`${sec}s`, x, s.height - s.bottom + 8);
  }

  if (s.isMobile && !s.isFitMode) {
    drawRepeatedMobileNoteLabels(s);
  }

  ctx.strokeStyle = "#d3b89e";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(s.left, s.top, s.chartWidth, s.rows.length * s.rowHeight);
}

function drawRepeatedMobileNoteLabels(s) {
  const repeatEverySec = 4;
  const repeatCount = Math.ceil(s.duration / repeatEverySec);

  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  for (let r = 1; r <= repeatCount; r++) {
    const x = s.left + r * repeatEverySec * s.pxPerSec + 4;
    if (x > s.width - s.right - 24) continue;

    s.rows.forEach((midi, index) => {
      const label = displayNoteName(midi);
      const isNatural = !midiToNoteName(midi).includes("#");
      if (!isNatural) return;

      const y = s.top + index * s.rowHeight + s.rowHeight / 2;
      ctx.fillStyle = "rgba(122, 87, 64, 0.38)";
      ctx.fillText(label, x, y);
    });
  }
}

function drawBars(s) {
  for (const seg of segments) {
    const rowIndex = s.rows.indexOf(seg.midi);
    if (rowIndex < 0) continue;

    const x = s.left + seg.start * s.pxPerSec;
    const y = s.top + rowIndex * s.rowHeight + 6;
    const w = Math.max(6, (seg.end - seg.start) * s.pxPerSec);
    const h = s.rowHeight - 12;
    const isSelected = selectedSegment === seg;

    ctx.fillStyle = isSelected ? "#d4661f" : "#ef8f35";
    roundedRect(ctx, x, y, w, h, 7);
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = pitchDragState.active ? "#7f3b13" : "#a84d16";
      ctx.lineWidth = pitchDragState.active ? 3 : 2;
      ctx.stroke();
    }

    if (w > (s.isFitMode ? 42 : 34)) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.font = s.isMobile ? "13px sans-serif" : "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayNoteName(seg.midi).replace(/\d/g, ""), x + w / 2, y + h / 2);
    }
  }
}

function drawPlayhead(s) {
  const time = getDisplayPlayheadTime();
  if (time === null) return;

  const x = s.left + time * s.pxPerSec;
  if (x < s.left || x > s.width - s.right) return;

  ctx.strokeStyle = isSynthPlaying ? "#7d5f2e" : "#c43b22";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, s.top - 6);
  ctx.lineTo(x, s.height - s.bottom);
  ctx.stroke();

  ctx.fillStyle = isSynthPlaying ? "#7d5f2e" : "#c43b22";
  ctx.beginPath();
  ctx.arc(x, s.top - 8, 5, 0, Math.PI * 2);
  ctx.fill();
}

function getDisplayPlayheadTime() {
  if (isSynthPlaying && synthStartAudioTime !== null && audioContext) {
    return Math.max(0, Math.min(synthDuration, audioContext.currentTime - synthStartAudioTime));
  }

  if (audioEl.src && (!audioEl.paused || audioEl.currentTime > 0)) {
    return audioEl.currentTime;
  }

  return null;
}

function hitTestSegment(x, y) {
  const s = drawState;
  for (const seg of segments) {
    const rowIndex = s.rows.indexOf(seg.midi);
    if (rowIndex < 0) continue;

    const bx = s.left + seg.start * s.pxPerSec;
    const by = s.top + rowIndex * s.rowHeight + 4;
    const bw = Math.max(6, (seg.end - seg.start) * s.pxPerSec);
    const bh = s.rowHeight - 8;

    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
      return seg;
    }
  }
  return null;
}

function startPlayhead() {
  stopPlayhead();
  const loop = () => {
    renderCanvas();
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

function stopPlayhead() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  renderCanvas();
}

function renderSegmentList() {
  if (!segmentList) return;

  if (!segments.length) {
    segmentList.textContent = "解析後に、音の流れがここに表示されます。";
    return;
  }

  const maxVisible = window.innerWidth <= MOBILE_BREAKPOINT ? 28 : 60;
  const visibleSegments = segments.slice(0, maxVisible);
  const html = visibleSegments.map((seg, index) => {
    const note = escapeHtml(displayNoteName(seg.midi));
    const time = `${formatTime(seg.start)}〜${formatTime(seg.end)}`;
    return `<button class="segment-chip" type="button" data-index="${index}"><strong>${note}</strong><span>${time}</span></button>`;
  }).join("");

  const extra = segments.length > maxVisible
    ? `<span class="segment-chip">+${segments.length - maxVisible}個</span>`
    : "";

  segmentList.innerHTML = html + extra;

  segmentList.querySelectorAll(".segment-chip[data-index]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const seg = segments[Number(chip.dataset.index)];
      if (!seg) return;

      stopSynthPlayback({ silent: true });
      audioEl.currentTime = Math.max(0, seg.start);
      selectedSegment = seg;
      selectedInfo.innerHTML = `
        <strong>${displayNoteName(seg.midi)}</strong>
        ／ ${formatTime(seg.start)} 〜 ${formatTime(seg.end)}
        ／ 約${seg.freq.toFixed(1)}Hz
      `;
      drawPitchBars();

      if (audioEl.src) {
        audioEl.play().catch(() => {
          statusEl.textContent = "音源の再生はブラウザ側で許可が必要な場合があります。";
        });
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateResultButtons() {
  const hasResult = segments.length > 0;

  if (saveImageButton) saveImageButton.disabled = !hasResult;
  // ドレミ音WAV保存ボタンは常に押せる状態にします。
  // 解析結果がない場合は、保存処理内で理由を表示します。
  if (downloadSynthWavButton) downloadSynthWavButton.disabled = false;
  if (playSynthButton) playSynthButton.disabled = !hasResult || isSynthPlaying;
  if (stopSynthButton) stopSynthButton.disabled = !isSynthPlaying;
}

async function playSynthFromBars() {
  if (!segments.length) {
    statusEl.textContent = "再生できる音程バーがありません。先に解析してください。";
    return;
  }

  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    if (!audioEl.paused) {
      audioEl.pause();
    }

    stopSynthPlayback({ silent: true });

    const startAt = audioContext.currentTime + 0.08;
    const lastEnd = Math.max(...segments.map((seg) => seg.end));
    synthDuration = Math.max(audioBuffer?.duration || 0, lastEnd);
    synthStartAudioTime = startAt;
    isSynthPlaying = true;
    synthNodes = [];

    const volumeMultiplier = Number(synthVolume?.value || 2.6);
    const masterGain = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();

    compressor.threshold.setValueAtTime(-12, startAt);
    compressor.knee.setValueAtTime(18, startAt);
    compressor.ratio.setValueAtTime(7, startAt);
    compressor.attack.setValueAtTime(0.006, startAt);
    compressor.release.setValueAtTime(0.22, startAt);

    masterGain.gain.setValueAtTime(volumeMultiplier, startAt);
    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);
    synthNodes.push(masterGain, compressor);

    for (const seg of segments) {
      const start = startAt + Math.max(0, seg.start);
      const end = startAt + Math.max(seg.start + 0.05, seg.end);
      scheduleKeyboardNote(audioContext, masterGain, seg.midi, start, end, synthTone?.value || "keyboard", synthNodes);
    }

    updateResultButtons();
    statusEl.textContent = "解析したバーをキーボード風のドレミ音で再生中です。";
    selectedInfo.textContent = "ドレミ音で再生中です。電子音よりも柔らかく減衰するキーボード風の音色にしています。";
    startPlayhead();

    const finishAfterMs = Math.max(100, (synthDuration + 0.35) * 1000);
    synthEndTimer = setTimeout(() => {
      finishSynthPlayback();
    }, finishAfterMs);
  } catch (error) {
    console.error(error);
    stopSynthPlayback({ silent: true });
    statusEl.textContent = "ドレミ音の再生中にエラーが起きました。ブラウザの音声再生許可を確認してください。";
  }
}

function scheduleKeyboardNote(context, destination, midi, start, end, tone, nodeStore) {
  const freq = midiToFrequency(midi);
  const duration = Math.max(0.06, end - start);
  const releaseEnd = end + 0.16;
  const toneConfig = getToneConfig(tone);

  toneConfig.partials.forEach((partial) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    osc.type = partial.type;
    osc.frequency.setValueAtTime(freq * partial.ratio, start);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(toneConfig.filterStart, start);
    filter.frequency.exponentialRampToValueAtTime(toneConfig.filterEnd, releaseEnd);
    filter.Q.setValueAtTime(toneConfig.filterQ, start);

    const peak = partial.gain * toneConfig.gain;
    const sustain = peak * toneConfig.sustain;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + toneConfig.attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustain), start + Math.min(duration * 0.7, toneConfig.decay));
    gain.gain.setValueAtTime(Math.max(0.0002, sustain), Math.max(start + toneConfig.attack, end - 0.03));
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    osc.start(start);
    osc.stop(releaseEnd + 0.02);

    nodeStore.push(osc, gain, filter);
  });
}

function getToneConfig(tone) {
  if (tone === "simple") {
    return {
      gain: 0.22,
      attack: 0.01,
      decay: 0.18,
      sustain: 0.72,
      filterStart: 2600,
      filterEnd: 1800,
      filterQ: 0.4,
      partials: [
        { ratio: 1, gain: 1.0, type: "triangle" },
        { ratio: 2, gain: 0.18, type: "sine" },
      ],
    };
  }

  if (tone === "bright") {
    return {
      gain: 0.25,
      attack: 0.006,
      decay: 0.32,
      sustain: 0.52,
      filterStart: 5200,
      filterEnd: 2600,
      filterQ: 0.55,
      partials: [
        { ratio: 1, gain: 1.0, type: "triangle" },
        { ratio: 2, gain: 0.34, type: "sine" },
        { ratio: 3, gain: 0.13, type: "sine" },
        { ratio: 4, gain: 0.07, type: "sine" },
      ],
    };
  }

  return {
    gain: 0.24,
    attack: 0.008,
    decay: 0.42,
    sustain: 0.46,
    filterStart: 4200,
    filterEnd: 1700,
    filterQ: 0.65,
    partials: [
      { ratio: 1, gain: 1.0, type: "triangle" },
      { ratio: 2, gain: 0.28, type: "sine" },
      { ratio: 3, gain: 0.11, type: "sine" },
      { ratio: 5, gain: 0.04, type: "sine" },
    ],
  };
}

function finishSynthPlayback() {
  clearSynthNodes();
  isSynthPlaying = false;
  synthStartAudioTime = null;
  synthDuration = 0;

  if (synthEndTimer) clearTimeout(synthEndTimer);
  synthEndTimer = null;

  updateResultButtons();
  stopPlayhead();
  statusEl.textContent = "ドレミ音の再生が完了しました。";
}

function stopSynthPlayback(options = {}) {
  const wasPlaying = isSynthPlaying;

  clearSynthNodes();
  isSynthPlaying = false;
  synthStartAudioTime = null;
  synthDuration = 0;

  if (synthEndTimer) clearTimeout(synthEndTimer);
  synthEndTimer = null;

  updateResultButtons();

  if (wasPlaying) {
    stopPlayhead();
    if (!options.silent) {
      statusEl.textContent = "ドレミ音の再生を停止しました。";
    }
  }
}

function clearSynthNodes() {
  for (const node of synthNodes) {
    try {
      if (typeof node.stop === "function") node.stop(0);
    } catch (error) {
      // すでに停止済みのノードは無視します。
    }

    try {
      if (typeof node.disconnect === "function") node.disconnect();
    } catch (error) {
      // すでに切断済みのノードは無視します。
    }
  }

  synthNodes = [];
}

function updateSummary(result) {
  const targetSegments = result.segments || segments;
  const usedNotes = [...new Set(targetSegments.map((s) => displayNoteName(s.midi)))];
  const minNote = displayNoteName(Math.min(...targetSegments.map((s) => s.midi)));
  const maxNote = displayNoteName(Math.max(...targetSegments.map((s) => s.midi)));
  const detailNote = noteDisplayMode.value === "simple"
    ? "音名はドレミだけで表示しています。詳しく見たい時は「詳しめ表示」に切り替えられます。"
    : "音名はオクターブ番号つきで表示しています。";

  const engineNote = lastAnalysisEngineLabel
    ? `解析方式：<strong>${lastAnalysisEngineLabel}</strong><br>`
    : "";

  summaryEl.innerHTML = `
    ${engineNote}
    <strong>${targetSegments.length}個</strong>の音程バーを検出しました。
    音域は <strong>${minNote}</strong> 〜 <strong>${maxNote}</strong> あたりです。
    使われている音：${usedNotes.join("、")}<br>
    ${detailNote}
  `;
}

function displayNoteName(midi) {
  const detailed = midiToNoteName(midi);
  if (noteDisplayMode.value === "detailed") return detailed;
  return detailed.replace(/[0-9-]/g, "");
}

function savePitchImage() {
  if (!segments.length || !drawState) {
    statusEl.textContent = "保存できる音程バーがありません。先に解析してください。";
    return;
  }

  renderCanvas();

  const link = document.createElement("a");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");

  link.download = `doremi_bar_${stamp}.png`;
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  statusEl.textContent = "音程バー画像を保存しました。";
}

function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

clearCanvas();
updateExportButtons();
