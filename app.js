// pick-me-app v7
// IMPROVEMENTS:
// - Confidence meter animations and milestone effects
// - Fixed memory leak on page unload
// - Improved compliment generation with condition-based logic
// - Cached brightness canvas for performance
// - Better error messages for camera/permissions
// - Caching DOM updates for performance

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const statusEl = document.getElementById("status");

const complimentEl = document.getElementById("compliment");
const confidenceValue = document.getElementById("confidenceValue");
const barFill = document.getElementById("barFill");
const confidenceHint = document.getElementById("confidenceHint");

let selectedVoice = null;
let voices = [];

// Cadence
let lastSpokenAt = 0;
const speakCooldownMs = 4500;
let lastComplimentAt = 0;
const complimentMinIntervalMs = 8000;

// State
let lastFaceCount = 0;
let lastSmileCount = 0;
let lastBrightnessBucket = -1;
let detectionInFlight = false;
let modelsLoaded = false;

// Cache for performance
let brightnessCanvas = null;
let lastDisplayedConfidence = -1;
let lastDisplayedHint = "";
let loopInterval = null;

// ---------- Helpers ----------
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function joinNicely(items){
  if(items.length === 1) return items[0];
  if(items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(", ")}, and ${items[items.length-1]}`;
}

// ---------- Voice: pick best available automatically ----------
function scoreVoice(v){
  const name = (v.name || "").toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  let s = 0;

  if(lang.startsWith("en")) s += 5;
  if(lang.includes("en-us")) s += 2;

  if(name.includes("siri")) s += 6;
  if(name.includes("premium")) s += 6;
  if(name.includes("enhanced")) s += 5;
  if(name.includes("natural")) s += 5;

  if(name.includes("samantha")) s += 4;
  if(name.includes("daniel")) s += 4;
  if(name.includes("karen")) s += 3;
  if(name.includes("tessa")) s += 3;
  if(name.includes("moira")) s += 3;

  if(name.includes("compact")) s -= 2;
  if(name.includes("espeak")) s -= 10;
  if(v.localService) s += 1;

  return s;
}

function initVoice(){
  if(!window.speechSynthesis) return;

  const populate = () => {
    voices = (window.speechSynthesis.getVoices() || []).slice();
    if(!voices.length) return;
    voices.sort((a,b)=>scoreVoice(b)-scoreVoice(a));
    selectedVoice = voices[0] || null;
  };

  populate();
  window.speechSynthesis.onvoiceschanged = populate;
}

// ---------- Speech ----------
function speak(text){
  if(!window.speechSynthesis) return;

  const now = Date.now();
  if(now - lastSpokenAt < speakCooldownMs) return;
  lastSpokenAt = now;

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.02;
  u.pitch = 1.06;
  if(selectedVoice) u.voice = selectedVoice;
  window.speechSynthesis.speak(u);
}

function stopSpeakingHard(){
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  lastSpokenAt = Date.now();
}

// ---------- Brightness estimate (CACHED) ----------
function estimateBrightness(){
  if(!brightnessCanvas) {
    brightnessCanvas = document.createElement("canvas");
    brightnessCanvas.width = 64;
    brightnessCanvas.height = 64;
  }
  const tctx = brightnessCanvas.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(video, 0, 0, 64, 64);
  const data = tctx.getImageData(0, 0, 64, 64).data;

  let sum = 0;
  for(let i=0;i<data.length;i+=4){
    const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
    sum += (0.2126*r + 0.7152*g + 0.0722*b);
  }
  return clamp01(sum / 4096);
}

function facesCentered(normBoxes){
  if(!normBoxes.length) return false;
  const centers = normBoxes.map(b => ({x:b.x+b.w/2, y:b.y+b.h/2}));
  const mean = centers.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
  mean.x/=centers.length; mean.y/=centers.length;
  return mean.x > 0.35 && mean.x < 0.65 && mean.y > 0.35 && mean.y < 0.65;
}

function facesCloseTogether(normBoxes){
  if(normBoxes.length < 2) return false;
  const centers = normBoxes.map(b => ({x:b.x+b.w/2, y:b.y+b.h/2}));
  const d=[];
  for(let i=0;i<centers.length;i++){
    for(let j=i+1;j<centers.length;j++){ 
      const dx = centers[i].x-centers[j].x;
      const dy = centers[i].y-centers[j].y;
      d.push(Math.sqrt(dx*dx+dy*dy));
    }
  }
  const avg = d.reduce((a,b)=>a+b,0)/d.length;
  return avg < 0.28;
}

// ---------- Confidence score ----------
function computeConfidence({faceCount, smileCount, brightness, centered, close}){
  if(faceCount === 0) return 0;
  let score = 0.38;
  score += clamp01(brightness) * 0.25;
  score += centered ? 0.15 : 0;
  score += (smileCount > 0 ? 0.18 : 0);
  if(faceCount === 2 && close) score += 0.10;
  if(faceCount >= 3) score += 0.06;
  return Math.round(clamp01(score) * 100);
}

// ---------- Improved Compliments (CONDITION-BASED) ----------
function makeCompliment(signals, transitions){
  const { faceCount, smileCount, brightness, centered, close } = signals;
  if(faceCount === 0) return "";

  const extraSpicyChance = 0.18;

  // Helper: check if conditions are met
  function meetsConditions(conditions) {
    if(conditions.minSmile && smileCount === 0) return false;
    if(conditions.maxSmile && smileCount >= Math.max(1, Math.floor(faceCount/2))) return false;
    if(conditions.centered && !centered) return false;
    if(conditions.notCentered && centered) return false;
    if(conditions.brightLight && brightness <= 0.62) return false;
    if(conditions.dimLight && brightness >= 0.35) return false;
    if(conditions.duoClose && !(faceCount === 2 && close)) return false;
    return true;
  }

  // Condition-based solo compliments (more coherent)
  const soloCompliments = [
    { conditions: { minSmile: true, centered: true, brightLight: true }, 
      text: "That smile with perfect centering and lighting? You're absolutely radiant." },
    { conditions: { minSmile: true, centered: true }, 
      text: "Centered, smiling, and flawless. You know exactly what you're doing." },
    { conditions: { minSmile: true, brightLight: true }, 
      text: "That smile in this light is just devastating in the best way." },
    { conditions: { minSmile: true }, 
      text: "That smile is weaponized in the best way possible." },
    { conditions: { centered: true, brightLight: true }, 
      text: "Perfectly framed with incredible lighting. You're working it." },
    { conditions: { centered: true }, 
      text: "You know how to frame a moment perfectly." },
    { conditions: { brightLight: true }, 
      text: "The lighting loves you, and honestly, so do I." },
    { conditions: { dimLight: true }, 
      text: "Moody lighting? Bold choice. And it absolutely works." },
    { conditions: {}, 
      text: "Okay. That vibe? Illegal." },
    { conditions: {}, 
      text: "You look like the reason plans change." },
    { conditions: {}, 
      text: "Main-character energy detected. Loudly." }
  ];

  const soloExtra = [
    { conditions: { minSmile: true, centered: true, brightLight: true }, 
      text: "If this level of perfection was a crime, you'd be on every billboard." },
    { conditions: { minSmile: true }, 
      text: "You're one wink away from starting an actual legend." },
    { conditions: { centered: true }, 
      text: "This frame is so good, it should be framed (literally)." },
    { conditions: {}, 
      text: "If confidence was a crime, you'd be on a billboard." }
  ];

  // Couple compliments
  const couple = [
    { conditions: { duoClose: true, minSmile: true }, 
      text: "You two look dangerously connected, and that smile seals it." },
    { conditions: { duoClose: true }, 
      text: "That duo energy is dangerously synced. Wow." },
    { conditions: { minSmile: true }, 
      text: "Oh. It's a duo now with smiles? This is officially legendary." },
    { conditions: {}, 
      text: "Oh. It's a duo now. This just got interesting." },
    { conditions: {}, 
      text: "You two look like a plot twist." },
    { conditions: {}, 
      text: "Double trouble, but make it stylish." }
  ];

  const coupleExtra = [
    { conditions: { duoClose: true, minSmile: true }, 
      text: "Two smiling faces, perfectly synced? You two could cause a scene." },
    { conditions: { duoClose: true }, 
      text: "This duo could get into a VIP line without speaking." },
    { conditions: {}, 
      text: "You two are one look away from starting a legend." }
  ];

  // Group compliments
  const group = [
    { conditions: { minSmile: true, centered: true }, 
      text: "This group understood the assignment—centered, smiling, iconic." },
    { conditions: { minSmile: true }, 
      text: "This group with all those smiles? Outrageous in the best way." },
    { conditions: { centered: true }, 
      text: "This perfectly framed group? Everyone's clearly a headline." },
    { conditions: {}, 
      text: "This is a full-on iconic group shot. Everyone understood the assignment." },
    { conditions: {}, 
      text: "The group energy here is outrageous. In the best way." },
    { conditions: {}, 
      text: "This looks like a poster for the fun part of the night." }
  ];

  const groupExtra = [
    { conditions: { minSmile: true }, 
      text: "A smiling group this good could cause a minor social event." },
    { conditions: {}, 
      text: "This group could cause a minor social event." }
  ];

  // Transitions (special cases)
  if(transitions.becameCouple){
    return pick([
      "Oh hello—now it's a duo. Dangerous.",
      "Second face entered the chat. This just upgraded.",
      "Couple mode activated. Everybody stay calm."
    ]);
  }
  if(transitions.becameGroup){
    return pick([
      "Okay wow—group mode. This is officially a situation.",
      "Three+ faces detected. The party just arrived.",
      "Group shot? Yeah. This is going to be a memory."
    ]);
  }

  const smileTag = (smileCount > 0)
    ? pick([" That smile is a menace.", " Smile detected—brace yourself.", " That smile? Weaponized."])
    : "";

  let base = "";
  let complimentSet = [];

  if(faceCount === 1){
    complimentSet = (Math.random() < extraSpicyChance) ? soloExtra : soloCompliments;
  } else if(faceCount === 2){
    complimentSet = (Math.random() < extraSpicyChance) ? coupleExtra : couple;
  } else {
    complimentSet = (Math.random() < extraSpicyChance) ? groupExtra : group;
  }

  // Filter compliments that match current conditions
  const filtered = complimentSet.filter(c => meetsConditions(c.conditions));
  if(filtered.length > 0) {
    base = pick(filtered).text;
  } else {
    // Fallback if no conditions match
    base = pick(complimentSet.filter(c => Object.keys(c.conditions).length === 0)).text;
  }

  return base + smileTag;
}

// ---------- Compliment triggers ----------
function shouldGenerateCompliment(signals){
  const now = Date.now();
  const brightnessBucket = Math.round(signals.brightness * 10);

  const faceCountChanged = signals.faceCount !== lastFaceCount;
  const smilesChanged = signals.smileCount !== lastSmileCount;
  const brightnessChanged = brightnessBucket !== lastBrightnessBucket;

  const timeElapsed = (now - lastComplimentAt) > complimentMinIntervalMs;

  return faceCountChanged || smilesChanged || (timeElapsed && (brightnessChanged || signals.faceCount > 0));
}

function updateState(signals){
  lastFaceCount = signals.faceCount;
  lastSmileCount = signals.smileCount;
  lastBrightnessBucket = Math.round(signals.brightness * 10);
}

// ---------- Confidence UI (WITH ANIMATIONS & CACHING) ----------
function updateConfidenceUI(confPct, signals){
  // Only update DOM if confidence actually changed
  if(lastDisplayedConfidence !== confPct) {
    confidenceValue.textContent = `${confPct}%`;
    barFill.style.transition = "width 0.3s ease-out";
    barFill.style.width = `${confPct}%`;
    lastDisplayedConfidence = confPct;

    // Add effects at milestones
    barFill.classList.remove("high-confidence", "milestone");
    if(confPct >= 80) {
      barFill.classList.add("high-confidence");
      if(confPct === 100) {
        barFill.classList.add("milestone");
        speak("Perfect! You're absolutely glowing right now!");
      }
    }
  }

  if(signals.faceCount === 0){
    const hint = "Show your face to start.";
    if(lastDisplayedHint !== hint) {
      confidenceHint.textContent = hint;
      lastDisplayedHint = hint;
    }
    return;
  }

  const hints = [];
  if(signals.brightness < 0.35) hints.push("Try a little more light.");
  if(!signals.centered) hints.push("Center the shot.");
  if(signals.smileCount === 0) hints.push("Drop a tiny smile (it helps).");
  if(signals.faceCount === 2 && !signals.close) hints.push("Get a bit closer together.");
  if(hints.length === 0) hints.push("You're basically unreasonably photogenic right now.");
  
  const hint = hints[0];
  if(lastDisplayedHint !== hint) {
    confidenceHint.textContent = hint;
    lastDisplayedHint = hint;
  }
}

// ---------- Camera + models ----------
async function loadModels(){
  statusEl.textContent = "Loading AI…";
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri("./models");
    await faceapi.nets.faceExpressionNet.loadFromUri("./models");
    modelsLoaded = true;
    statusEl.textContent = "AI ready.";
  } catch(e) {
    statusEl.textContent = "Error loading AI models. Please refresh.";
    console.error("Model loading failed:", e);
    throw e;
  }
}

async function setupCamera(){
  statusEl.textContent = "Requesting camera…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    statusEl.textContent = "Live.";
  } catch(e) {
    if(e.name === 'NotAllowedError') {
      statusEl.textContent = "Camera access denied. Please enable camera permissions in settings.";
    } else if(e.name === 'NotFoundError') {
      statusEl.textContent = "No camera found on this device.";
    } else if(e.name === 'NotReadableError') {
      statusEl.textContent = "Camera is busy or not accessible. Try closing other apps.";
    } else {
      statusEl.textContent = "Error: " + (e?.message ?? "Could not access camera");
    }
    console.error("Camera setup failed:", e);
    throw e;
  }
}

function clearOverlay(){
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
}

async function detectOnce(){
  if(!modelsLoaded) return null;
  if(video.readyState < 2) return null;

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.65 });
  const detections = await faceapi.detectAllFaces(video, options).withFaceExpressions();

  const w = video.videoWidth || 1;
  const h = video.videoHeight || 1;

  const normBoxes = detections.map(d => {
    const b = d.detection.box;
    return { x: b.x / w, y: b.y / h, w: b.width / w, h: b.height / h };
  });

  let smileCount = 0;
  for(const d of detections){
    const happy = d.expressions?.happy ?? 0;
    if(happy > 0.6) smileCount += 1;
  }

  const brightness = estimateBrightness();
  const centered = facesCentered(normBoxes);
  const close = facesCloseTogether(normBoxes);

  return { faceCount: detections.length, smileCount, brightness, centered, close };
}

function onNoFaces(){
  stopSpeakingHard();
  statusEl.textContent = "No face detected";
  complimentEl.textContent = "No face detected. Come back when you're ready to be admired.";
  const zero = { faceCount:0, smileCount:0, brightness:0, centered:false, close:false };
  updateConfidenceUI(0, zero);
}

async function loop(){
  if(detectionInFlight) return;
  detectionInFlight = true;

  try{
    const signals = await detectOnce();
    clearOverlay();
    if(!signals){
      detectionInFlight = false;
      return;
    }

    const conf = computeConfidence({
      faceCount: signals.faceCount,
      smileCount: signals.smileCount,
      brightness: signals.brightness,
      centered: signals.centered,
      close: signals.close
    });
    updateConfidenceUI(conf, signals);

    if(signals.faceCount === 0){
      onNoFaces();
      updateState(signals);
      detectionInFlight = false;
      return;
    }

    statusEl.textContent = "Live";

    const transitions = {
      becameCouple: (lastFaceCount !== 2 && signals.faceCount === 2),
      becameGroup: (lastFaceCount < 3 && signals.faceCount >= 3)
    };

    if(shouldGenerateCompliment(signals)){ 
      const text = makeCompliment(signals, transitions);
      if(text){
        complimentEl.textContent = text;
        lastComplimentAt = Date.now();
        speak(text);
      }
    }

    updateState(signals);
  } catch(e){
    console.error(e);
    statusEl.textContent = "Error (see console)";
  } finally{
    detectionInFlight = false;
  }
}

// ---------- Cleanup on page unload (FIX MEMORY LEAK) ----------
function cleanup(){
  if(loopInterval) clearInterval(loopInterval);
  if(video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  if(window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);

async function boot(){
  if(!window.isSecureContext){
    statusEl.textContent = "Camera needs HTTPS (GitHub Pages) or localhost.";
    return;
  }

  initVoice();

  try{
    await loadModels();
    await setupCamera();

    complimentEl.textContent = "Show your face to start.";
    confidenceHint.textContent = "Show your face to start.";
    statusEl.textContent = "Live";

    loopInterval = setInterval(loop, 200);
  } catch(e){
    console.error(e);
    statusEl.textContent = "Error: " + (e?.message ?? String(e));
  }
}

boot();