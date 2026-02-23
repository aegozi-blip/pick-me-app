// The Pick Me App - Web MVP (static site)
//
// Features:
// - Front camera mirror
// - Face count
// - Smile detection (face expressions)
// - Lighting estimate
// - Framing + group closeness heuristics
// - Compliments tailored to count + selected style
// - Optional speech (SpeechSynthesis)
//
// Requirements:
// - Put face-api model files in /models (see README)

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const statusEl = document.getElementById("status");
const complimentEl = document.getElementById("compliment");

const facesMetric = document.getElementById("facesMetric");
const smilesMetric = document.getElementById("smilesMetric");
const lightMetric = document.getElementById("lightMetric");

const styleSelect = document.getElementById("styleSelect");
const speakToggle = document.getElementById("speakToggle");

// Throttling to avoid spam
let lastSpokenAt = 0;
const speakCooldownMs = 2800;

let lastSignalsKey = "";

// ====== Compliments ======
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function joinNicely(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function makeCompliment(style, signals) {
  const { faceCount, smileCount, brightness, facesCentered, facesCloseTogether } = signals;

  if (faceCount === 0) return "No face detected — come back, main character.";

  const resolved = (style === "auto") ? "neutral" : style;

  const notes = [];
  if (brightness > 0.62) notes.push("the lighting is great");
  else if (brightness < 0.35) notes.push("the moody lighting still works");

  if (smileCount >= Math.max(1, Math.floor(faceCount / 2))) {
    notes.push("those smiles are doing work");
  }
  if (facesCentered) notes.push("the framing is on point");
  if (faceCount >= 2 && facesCloseTogether) notes.push("the group energy feels tight");

  const noticed = notes.length ? ` I’m noticing ${joinNicely(notes)}.` : "";

  let base = "";
  if (faceCount === 1) {
    if (resolved === "feminine") {
      base = pick([
        "You look confident and put-together.",
        "That presence is powerful.",
        "You’re giving ‘I’ve got this’ energy."
      ]);
    } else if (resolved === "masculine") {
      base = pick([
        "You look confident and sharp.",
        "That calm confidence is a flex.",
        "You’re giving main-character energy."
      ]);
    } else {
      base = pick([
        "You look really confident right now.",
        "Your vibe is solid.",
        "This is a great look — effortless."
      ]);
    }
  } else if (faceCount === 2) {
    if (resolved === "feminine") {
      base = pick([
        "This duo is absolutely iconic.",
        "You two look like the fun just arrived.",
        "Double the glow, double the vibe."
      ]);
    } else if (resolved === "masculine") {
      base = pick([
        "This duo energy is elite.",
        "You two look locked in — great vibe.",
        "Strong two-person shot — clean."
      ]);
    } else {
      base = pick([
        "You two look like the best part of the room.",
        "This duo vibe is immaculate.",
        "That’s a great two-person shot."
      ]);
    }
  } else {
    base = pick([
      "This is a whole iconic group shot.",
      "Everyone understood the assignment.",
      "That group energy is unreal — great photo."
    ]);
  }

  return base + noticed;
}

// ====== Speech ======
function speak(text) {
  if (!speakToggle.checked) return;

  const now = Date.now();
  if (now - lastSpokenAt < speakCooldownMs) return;
  lastSpokenAt = now;

  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0;
  u.pitch = 1.0;
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

// ====== Signals from the frame ======
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// brightness estimate from current video frame (sample down)
function estimateBrightness() {
  const w = 64, h = 64;
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });

  tctx.drawImage(video, 0, 0, w, h);
  const img = tctx.getImageData(0, 0, w, h).data;

  let sum = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i] / 255;
    const g = img[i + 1] / 255;
    const b = img[i + 2] / 255;
    sum += (0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const avg = sum / (w * h);
  return clamp01(avg);
}

function facesCentered(boxes) {
  if (!boxes.length) return false;
  const centers = boxes.map(b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const mean = centers.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  mean.x /= centers.length;
  mean.y /= centers.length;
  return mean.x > 0.35 && mean.x < 0.65 && mean.y > 0.35 && mean.y < 0.65;
}

function facesCloseTogether(boxes) {
  if (boxes.length < 2) return false;
  const centers = boxes.map(b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const d = [];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dx = centers[i].x - centers[j].x;
      const dy = centers[i].y - centers[j].y;
      d.push(Math.sqrt(dx * dx + dy * dy));
    }
  }
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return avg < 0.28;
}

function makeSignals(detections) {
  const w = video.videoWidth || 1;
  const h = video.videoHeight || 1;

  const boxes = detections.map(d => {
    const b = d.detection.box;
    return {
      x: b.x / w,
      y: b.y / h,
      width: b.width / w,
      height: b.height / h
    };
  });

  const faceCount = detections.length;

  let smileCount = 0;
  for (const d of detections) {
    const happy = d.expressions?.happy ?? 0;
    if (happy > 0.6) smileCount += 1;
  }

  const brightness = estimateBrightness();
  const centered = facesCentered(boxes);
  const close = facesCloseTogether(boxes);

  return { faceCount, smileCount, brightness, facesCentered: centered, facesCloseTogether: close };
}

function signalsKey(signals) {
  const bBucket = Math.round(signals.brightness * 10);
  return `${signals.faceCount}|${signals.smileCount}|${bBucket}|${signals.facesCentered ? 1 : 0}|${signals.facesCloseTogether ? 1 : 0}|${styleSelect.value}`;
}

// ====== Camera + detection loop ======
async function setupCamera() {
  statusEl.textContent = "Requesting camera…";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  video.srcObject = stream;

  await new Promise(resolve => {
    video.onloadedmetadata = () => resolve();
  });

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  statusEl.textContent = "Camera ready.";
}

async function loadModels() {
  statusEl.textContent = "Loading models…";
  await faceapi.nets.tinyFaceDetector.loadFromUri("./models");
  await faceapi.nets.faceExpressionNet.loadFromUri("./models");
  statusEl.textContent = "Models loaded.";
}

function drawBoxes(detections) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Mirror drawing so boxes match mirrored video
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";

  for (const d of detections) {
    const b = d.detection.box;
    ctx.strokeRect(b.x, b.y, b.width, b.height);
  }

  ctx.restore();
}

async function detectLoop() {
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.5
  });

  while (true) {
    if (video.readyState >= 2) {
      const detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceExpressions();

      drawBoxes(detections);

      const signals = makeSignals(detections);
      const key = signalsKey(signals);

      facesMetric.textContent = `Faces: ${signals.faceCount}`;
      smilesMetric.textContent = `Smiles: ${signals.smileCount}`;
      lightMetric.textContent = `Light: ${Math.round(signals.brightness * 100)}%`;

      if (key !== lastSignalsKey) {
        lastSignalsKey = key;
        const text = makeCompliment(styleSelect.value, signals);
        complimentEl.textContent = text;
        speak(text);
      }

      statusEl.textContent = signals.faceCount === 0 ? "No face detected" : "Live";
    }

    await new Promise(r => setTimeout(r, 140));
  }
}

async function boot() {
  try {
    if (!window.isSecureContext) {
      statusEl.textContent = "Camera needs HTTPS (GitHub Pages) or localhost.";
      return;
    }

    await loadModels();
    await setupCamera();
    detectLoop();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error: " + (err?.message ?? String(err));
  }
}

boot();
