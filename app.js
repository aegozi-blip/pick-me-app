// pick-me-app v6
// UI simplified:
// - Keep Confidence Meter + compliment only (no extra pills/selects/checkboxes)
// - Remove 'chef's kiss' phrase entirely
// Logic kept:
// - Solo/Couple/Group compliments
// - Stop speaking when no faces
// - Speak cooldown 4500ms

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

// ---------- Brightness estimate ----------
function estimateBrightness(){
  const w = 64, h = 64;
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(video, 0, 0, w, h);
  const data = tctx.getImageData(0,0,w,h).data;

  let sum = 0;
  for(let i=0;i<data.length;i+=4){
    const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
    sum += (0.2126*r + 0.7152*g + 0.0722*b);
  }
  return clamp01(sum / (w*h));
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

function updateConfidenceUI(confPct, signals){
  confidenceValue.textContent = `${confPct}%`;
  barFill.style.width = `${confPct}%`;

  if(signals.faceCount === 0){
    confidenceHint.textContent = "Show your face to start.";
    return;
  }

  const hints = [];
  if(signals.brightness < 0.35) hints.push("Try a little more light.");
  if(!signals.centered) hints.push("Center the shot.");
  if(signals.smileCount === 0) hints.push("Drop a tiny smile (it helps).");
  if(signals.faceCount === 2 && !signals.close) hints.push("Get a bit closer together.");
  if(hints.length === 0) hints.push("You’re basically unreasonably photogenic right now.");
  confidenceHint.textContent = hints[0];
}

// ---------- Compliments (spicy-only, non-explicit) ----------
function makeCompliment(signals, transitions){
  const { faceCount, smileCount, brightness, centered, close } = signals;
  if(faceCount === 0) return "";

  const extraSpicyChance = 0.18;

  const notes = [];
  if(smileCount >= Math.max(1, Math.floor(faceCount/2))) notes.push("those smiles are causing problems");
  if(brightness > 0.62) notes.push("the lighting is doing you favors");
  if(brightness < 0.35) notes.push("moody lighting… bold choice, it works");
  if(centered) notes.push("the framing is clean");
  if(faceCount === 2 && close) notes.push("the duo energy is dangerously synced");
  if(faceCount >= 3) notes.push("this group is clearly a headline");

  const noticed = notes.length ? ` I’m noticing ${joinNicely(notes)}.` : "";

  const solo = [
    "Okay. That vibe? Illegal.",
    "You look like the reason plans change.",
    "Main-character energy detected. Loudly.",
    "This is not a normal amount of charm to have.",
    "Respectfully… wow.",
    "You look like you know secrets (and keep them well).",
    "Your confidence just walked in before you did.",
    "This camera is basically blushing."
  ];

  const soloExtra = [
    "If confidence was a crime, you’d be on a billboard.",
    "You’re one wink away from starting rumors.",
    "This is not a face you can just casually have.",
    "Someone’s going to misbehave because of this."
  ];

  const couple = [
    "Oh. It’s a duo now. This just got interesting.",
    "You two look like a plot twist.",
    "Double trouble, but make it stylish.",
    "The chemistry is loud. The camera heard it.",
    "This duo energy is absolutely not safe for boring people."
  ];

  const coupleExtra = [
    "You two are one look away from starting a legend.",
    "This duo could get into a VIP line without speaking.",
    "People are going to stare. Let them."
  ];

  const group = [
    "This is a full-on iconic group shot. Everyone understood the assignment.",
    "The group energy here is outrageous. In the best way.",
    "This looks like a poster for the fun part of the night.",
    "This group is giving ‘we have stories’ energy.",
    "Somewhere, a party just got better because of this."
  ];

  const groupExtra = [
    "This group could cause a minor social event.",
    "If this is the squad, I’m scared (respectfully).",
    "The vibe is coordinated. Suspiciously."
  ];

  // Transitions
  if(transitions.becameCouple){
    return pick([
      "Oh hello—now it’s a duo. Dangerous.",
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
  if(faceCount === 1){
    base = (Math.random() < extraSpicyChance) ? pick(soloExtra) : pick(solo);
    return base + smileTag + noticed;
  }

  if(faceCount === 2){
    base = (Math.random() < extraSpicyChance) ? pick(coupleExtra) : pick(couple);
    return base + smileTag + noticed;
  }

  base = (Math.random() < extraSpicyChance) ? pick(groupExtra) : pick(group);
  return base + smileTag + noticed;
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

// ---------- Camera + models ----------
async function loadModels(){
  statusEl.textContent = "Loading AI…";
  await faceapi.nets.tinyFaceDetector.loadFromUri("./models");
  await faceapi.nets.faceExpressionNet.loadFromUri("./models");
  modelsLoaded = true;
  statusEl.textContent = "AI ready.";
}

async function setupCamera(){
  statusEl.textContent = "Requesting camera…";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  await new Promise(r => video.onloadedmetadata = r);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  statusEl.textContent = "Live.";
}

function clearOverlay(){
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
}

async function detectOnce(){
  if(!modelsLoaded) return null;
  if(video.readyState < 2) return null;

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
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
  complimentEl.textContent = "No face detected. Come back when you’re ready to be admired.";
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

    setInterval(loop, 200);
  } catch(e){
    console.error(e);
    statusEl.textContent = "Error: " + (e?.message ?? String(e));
  }
}

boot();
