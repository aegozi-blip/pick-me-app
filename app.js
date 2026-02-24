// pick-me-app v8
// IMPROVEMENTS:
// - Confidence meter animations and milestone effects
// - Fixed memory leak on page unload
// - Improved compliment generation with condition-based logic
// - Cached brightness canvas for performance
// - Better error messages for camera/permissions
// - Caching DOM updates for performance
// - Dual voice modes: Daria (sparkle) & Dan (drinks)
// - Improved face detection thresholds
// - Glitter animation support

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const statusEl = document.getElementById("status");

const complimentEl = document.getElementById("compliment");
const confidenceValue = document.getElementById("confidenceValue");
const barFill = document.getElementById("barFill");
const confidenceHint = document.getElementById("confidenceHint");

let selectedVoice = null;
let selectedMaleVoice = null;
let selectedFemaleVoice = null;
let voices = [];
let currentVoiceMode = "daria"; // "daria" or "dan"

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
let firstComplimentShown = false; // tracks if first contextual compliment has been given

// Cache for performance
let brightnessCanvas = null;
let lastDisplayedConfidence = -1;
let lastDisplayedHint = "";
let loopInterval = null;
let lastSignals = null; // cache last detection result for button handler

// ---------- Helpers ----------
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function stripEmojis(text){
  return text.replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]|\uFE0F/gu, "").trim();
}
function joinNicely(items){
  if(items.length === 1) return items[0];
  if(items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(", ")}, and ${items[items.length-1]}`;
}

// ---------- Voice mode selector ----------
function initVoiceSelector(){
  const sel = document.getElementById("voiceSelector");
  if(!sel) return;
  sel.addEventListener("change", () => {
    currentVoiceMode = sel.value;
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    lastSpokenAt = 0; // reset cooldown so next compliment speaks immediately
  });
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

function scoreMaleVoice(v){
  const name = (v.name || "").toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  let s = 0;
  if(lang.startsWith("en")) s += 5;
  if(lang.includes("en-us")) s += 2;
  if(name.includes("daniel")) s += 10;
  if(name.includes("david")) s += 9;
  if(name.includes("alex")) s += 8;
  if(name.includes("aaron")) s += 8;
  if(name.includes("paul")) s += 7;
  if(name.includes("mark")) s += 7;
  if(name.includes("premium")) s += 6;
  if(name.includes("enhanced")) s += 5;
  if(name.includes("natural")) s += 5;
  if(name.includes("compact")) s -= 2;
  if(name.includes("espeak")) s -= 10;
  if(v.localService) s += 1;
  return s;
}

function scoreFemaleVoice(v){
  const name = (v.name || "").toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  let s = 0;
  if(lang.startsWith("en")) s += 5;
  if(lang.includes("en-us")) s += 2;
  if(name.includes("victoria")) s += 10;
  if(name.includes("samantha")) s += 9;
  if(name.includes("karen")) s += 8;
  if(name.includes("moira")) s += 8;
  if(name.includes("tessa")) s += 7;
  if(name.includes("siri")) s += 6;
  if(name.includes("premium")) s += 6;
  if(name.includes("enhanced")) s += 5;
  if(name.includes("natural")) s += 5;
  if(name.includes("compact")) s -= 2;
  if(name.includes("espeak")) s -= 10;
  if(v.localService) s += 1;
  return s;
}

function initVoice(){
  if(!window.speechSynthesis) return;

  const populate = () => {
    const v = (window.speechSynthesis.getVoices() || []).slice();
    if(!v.length) return;
    voices = v;
    const sorted = voices.slice().sort((a,b) => scoreVoice(b) - scoreVoice(a));
    selectedVoice = sorted[0] || null;
    const maleSorted = voices.slice().sort((a,b) => scoreMaleVoice(b) - scoreMaleVoice(a));
    selectedMaleVoice = maleSorted[0] || selectedVoice;
    const femaleSorted = voices.slice().sort((a,b) => scoreFemaleVoice(b) - scoreFemaleVoice(a));
    selectedFemaleVoice = femaleSorted[0] || selectedVoice;
  };

  populate();
  window.speechSynthesis.onvoiceschanged = populate;
  // Retry for browsers where onvoiceschanged fires late or unreliably (e.g. mobile Safari)
  setTimeout(populate, 500);
  setTimeout(populate, 1500);
}

// ---------- Speech ----------
function speak(text){
  if(!window.speechSynthesis) return;

  const now = Date.now();
  if(now - lastSpokenAt < speakCooldownMs) return;
  lastSpokenAt = now;

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(stripEmojis(text));
  u.lang = "en-US";
  u.rate = 1.02;
  u.pitch = 1.06;
  const voice = currentVoiceMode === "dan" ? selectedMaleVoice : selectedFemaleVoice;
  if(voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

function speakForced(text){
  if(!window.speechSynthesis) return;
  lastSpokenAt = Date.now();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(stripEmojis(text));
  u.lang = "en-US";
  u.rate = 1.02;
  u.pitch = 1.06;
  const voice = currentVoiceMode === "dan" ? selectedMaleVoice : selectedFemaleVoice;
  if(voice) u.voice = voice;
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

// ---------- Compliment repositories (module-level for performance) ----------
const dariaRepo = {
  highConfidence: [
    "Absolutely sparkling  — that energy is pure glitter magic.",
    "You are radiating today.",
    "Honestly? Radiant. The kind of radiant that starts trends.",
    "Pure sparkle energy. The frame literally can't handle it.",
    "That glow is outrageous right now. Shimmering from here. ",
    "Everything about this. Flawless.",
  ],
  smile: [
    "Your smile is throwing glitter into the universe right now.",
    "That smile? Weaponised glitter. The best kind.",
    "You smiled and the room got shinier. That's just a fact.",
    "You have the sexiest smile.",
  ],
  centered: [
    "You know how to own a frame. Glitter would just be extra.",
    "You were made for this shot. ",
    "Centred and glowing.",
    "Nailed it.",
  ],
  lighting: [
    "The light is catching every sparkle on you right now.",
    "This lighting was made for you — or you were made for it.",
    "Glowing like a disco ball in the absolute best way. ✨",
    "Radiant under the lights. Every shimmer accounted for.",
    "Bright, shimmering, and completely in your element right now.",
  ],
  couple: [
    "Two of you? The glitter is doubling. This just got fun. ✨",
    "You two look like a sparkle plot twist.",
    "Double glitter trouble. Absolutely stylish.",
    "That duo energy is sparkling — dangerously synced.",
    "Two smiles, one shimmer moment. You two are dangerously glittery. ✨",
    "A duo dripping in glitter vibes? This is officially iconic.",
    "Side by side and radiating. The glitter approves of this pairing.",
  ],
  group: [
    "Full sparkle mode — everyone in this group understood the assignment. ✨",
    "The glitter energy in this group is genuinely outrageous.",
    "This looks like the glittery bit of the night everyone came for.",
    "All those faces, all that shimmer. The universe approves. ✨",
    "This group is radiating. Every single one of you sparkling.",
    "Collectively radiant. The glitter doesn't know where to start. ✨",
  ],
  generic: [
    "Okay. Pure sparkle. The frame literally can't handle it.",
    "You arrived and the glitter followed. Obviously.",
    "Mysterious, sexy, and somehow still shimmering. Very you.",
    "Your vibe is immaculate.",
    "Casual glitter aura. Not everyone has it. You do.",
  ],
};
// Pre-computed solo pool for variety after first compliment
const dariaSoloPool = [
  ...dariaRepo.highConfidence, ...dariaRepo.smile, ...dariaRepo.centered,
  ...dariaRepo.lighting, ...dariaRepo.generic,
];

const danRepo = {
  highConfidence: [
    "Gin and tonic energy. Perfection. 🍹",
    "I'm taking you out for Wednesday drinks! 🍹",
    "Looking this good at the bar should come with a free round. No doubt.",
    "That look. We are going to find ourselves on a balcoy at 5 in the morning again. 🍸",
    "That energy is what Wednesday drinks was invented for. Iconic. 🍹",
  ],
  smile: [
    "That smile says the G&T hit exactly right. 🍹",
    "Looking better than the perfect G&T!", 
    "Smile like that? Someone definitely ordered the good gin.",
    "You smiled and the place just got better. That's just how it works.",
  ],
  centered: [
    "That is exactly the energy needed for mid-week drinks.",
    "Right in the middle of the shot, right in the middle of the night. 🍸",
    "Dead centre and looking like you own the place. Respect.",
    "Perfect like a well-made G&T.",
  ],
  lighting: [
    "Looking bright on a Wednesday — the cocktails are clearly working. 🍹",
    "This lighting was made for a drinks photo, and you were made for this lighting.",
    "Glowing under the pub lights. The G&T is doing its job.",
    "Lit up just right. The bar ambience is working in your favour.",
    "Bright and radiant — the perfect Wednesday drinks look. 🍸",
  ],
  couple: [
    "Wednesday drinks duo — now it's officially a session. 🍸",
    "You two look like you've found the best table on a Wednesday night.",
    "Double trouble, but make it Wednesday gin & tonics. Stylish.",
    "That duo energy at mid-week drinks is dangerously good.",
    "Two of you at the bar? The round just got more interesting. 🍹",
    "A solid drinks duo. The cocktail menu doesn't stand a chance.",
    "Side by side at the pub — this is peak Wednesday energy.",
  ],
  group: [
    "Wednesday drinks group? Everyone in this shot is absolutely iconic. 🍸",
    "The mid-week cocktail energy in this group is genuinely outrageous.",
    "This looks like the session everyone was trying to get invited to.",
    "Full pub crew assembled. The round is going to be legendary. 🍹",
    "A group this good deserves a dedicated table and a round on the house.",
    "Collectively brilliant at mid-week drinks. The bar is lucky. 🍸",
  ],
  generic: [
    "Wednesday vibes and cocktails? You've got this absolutely sorted. 🍹",
    "You look like someone who could convincingly order the whole drinks menu.",
    "Mid-week. Full charm. G&T in hand (probably). Unbeatable combo.",
    "Moody bar lighting? That's just the Wednesday evening atmosphere.",
    "The pub energy is immaculate right now. Truly. 🍸",
    "Casual mid-week cocktail aura. Not everyone has it. You do.",
  ],
};
// Pre-computed solo pool for variety after first compliment
const danSoloPool = [
  ...danRepo.highConfidence, ...danRepo.smile, ...danRepo.centered,
  ...danRepo.lighting, ...danRepo.generic,
];

// ---------- Daria Mode Compliments (sparkle & glitter themed) ----------
function makeComplimentDaria(signals, transitions){
  const { faceCount, smileCount, brightness, centered } = signals;
  if(faceCount === 0) return "";

  // Transitions (special cases)
  if(transitions.becameCouple){
    return pick(["Oh hello — duo mode! Double the sparkle. 🌟", "Second face entered the glitter chat.", "Couple mode. The confetti is ready. ✨"]);
  }
  if(transitions.becameGroup){
    return pick(["Okay wow — full sparkle group mode. ✨", "Three+ faces? The glitter just multiplied.", "Group shot. This is going to shimmer in the memory. 🌟"]);
  }

  // Rule 5: Group / couple override (always category-specific)
  if(faceCount >= 3) return pick(dariaRepo.group);
  if(faceCount === 2) return pick(dariaRepo.couple);

  // After first solo compliment, pick randomly from the entire solo pool for variety
  if(firstComplimentShown) return pick(dariaSoloPool);

  // Solo rules – condition-based for first compliment (faceCount === 1)
  const confidence = computeConfidence(signals);
  if(confidence >= 70) return pick(dariaRepo.highConfidence);  // Rule 1
  if(smileCount > 0) return pick(dariaRepo.smile);             // Rule 2
  if(centered) return pick(dariaRepo.centered);                // Rule 3
  if(brightness > 0.62) return pick(dariaRepo.lighting);       // Rule 4
  return pick(dariaRepo.generic);                              // Rule 6: fallback
}

// ---------- Dan Mode Compliments (drinks & social themed) ----------
function makeComplimentDan(signals, transitions){
  const { faceCount, smileCount, brightness, centered } = signals;
  if(faceCount === 0) return "";

  // Transitions (special cases)
  if(transitions.becameCouple){
    return pick(["Oh hello — Wednesday duo mode. G&T for two? 🍹", "Second face. Now it's a proper session.", "Couple mode activated. Someone call the bartender."]);
  }
  if(transitions.becameGroup){
    return pick(["Okay wow — full pub group mode. 🍹", "Three+ faces? The round just got bigger.", "Group drinks? Yeah. This is the one."]);
  }

  // Rule 5: Group / couple override (always category-specific)
  if(faceCount >= 3) return pick(danRepo.group);
  if(faceCount === 2) return pick(danRepo.couple);

  // After first solo compliment, pick randomly from the entire solo pool for variety
  if(firstComplimentShown) return pick(danSoloPool);

  // Solo rules – condition-based for first compliment (faceCount === 1)
  const confidence = computeConfidence(signals);
  if(confidence >= 70) return pick(danRepo.highConfidence);  // Rule 1
  if(smileCount > 0) return pick(danRepo.smile);             // Rule 2
  if(centered) return pick(danRepo.centered);                // Rule 3
  if(brightness > 0.62) return pick(danRepo.lighting);       // Rule 4
  return pick(danRepo.generic);                              // Rule 6: fallback
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

// ---------- User Response Repository ----------
const userResponseRepo = {
  negativeAppearance: [
    "Your look is absolutely amazing!",
    "You look incredible — don't let that thought in!",
    "That's not what I see at all. You look stunning.",
    "You are way harder on yourself than you should be.",
  ],
  badHair: [
    "Your hair looks fantastic from here!",
    "That hair has great energy — I'm seeing it.",
    "Honestly? The hair is giving exactly the right vibes.",
    "Bad hair day? I'm not seeing it. Looks great.",
  ],
  notPhotogenic: [
    "You photograph beautifully — the camera loves you!",
    "Not photogenic? That's just wrong. You're made for this.",
    "I'm looking right at you and you're stunning. Trust me.",
  ],
  lookingGood: [
    "Yes! You look absolutely amazing right now.",
    "You look great — that's not even a question.",
    "Looking good? You're looking incredible.",
    "Genuinely, yes. You're looking fantastic.",
  ],
  thankYou: [
    "You're so welcome! You make it easy.",
    "The pleasure is genuinely mine.",
    "Anytime! You deserve every word.",
    "Don't mention it — you're a joy to compliment.",
  ],
  youreNice: [
    "Well, you're even nicer to look at!",
    "That means so much — thank you for saying that.",
    "You're pretty wonderful yourself!",
    "Aw, stop it — actually no, keep going. You're lovely.",
  ],
  generic: [
    "I hear you — and you look amazing, by the way.",
    "That's valid. And you're still looking great.",
    "Noted! You're doing wonderfully.",
    "Absolutely. And might I add — you look brilliant today.",
  ],
};

// ---------- Intent Detection ----------
function analyzeUserInput(text){
  const lower = text.toLowerCase();
  if(/hair/.test(lower)) return "badHair";
  if(/not photogenic|don.t look good in photo|bad in photo/.test(lower)) return "notPhotogenic";
  if(/(look|am|feel).*(terrible|ugly|awful|horrible|bad|worst|gross)|terrible|ugly|awful|horrible|i look bad/.test(lower)) return "negativeAppearance";
  if(/do i look|look good|look nice|look okay|am i pretty|am i handsome/.test(lower)) return "lookingGood";
  if(/thank|thanks/.test(lower)) return "thankYou";
  if(/nice|sweet|kind|lovely|great app|love you|you.re (great|amazing|wonderful)/.test(lower)) return "youreNice";
  return "generic";
}

// ---------- Generate Response ----------
function generateResponse(intent){
  const responses = userResponseRepo[intent] || userResponseRepo.generic;
  return pick(responses);
}

// ---------- Mic UI helpers ----------
function updateMicUI(recording){
  const micBtn = document.getElementById("micBtn");
  const recordingIndicator = document.getElementById("recordingIndicator");
  const responseArea = document.getElementById("responseArea");
  if(!micBtn || !recordingIndicator || !responseArea) return;
  responseArea.style.display = "block";
  micBtn.classList.toggle("recording", recording);
  recordingIndicator.style.display = recording ? "flex" : "none";
}

function showUserInput(text){
  const el = document.getElementById("userInputDisplay");
  if(!el) return;
  el.textContent = `"${text}"`;
  el.style.display = "block";
}

function showResponse(text){
  const el = document.getElementById("responseDisplay");
  if(!el) return;
  el.textContent = text;
  el.style.display = "block";
}

// ---------- Speech Recognition ----------
let recognition = null;
let isRecording = false;

function startRecording(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    showResponse("Speech recognition is not supported in this browser.");
    updateMicUI(false);
    return;
  }

  if(recognition) recognition.abort();
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    updateMicUI(true);
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    showUserInput(transcript);
    const intent = analyzeUserInput(transcript);
    const response = generateResponse(intent);
    showResponse(response);
    speakForced(response);
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    isRecording = false;
    updateMicUI(false);
  };

  recognition.onend = () => {
    isRecording = false;
    updateMicUI(false);
  };

  recognition.start();
}

function stopRecording(){
  if(recognition && isRecording) recognition.stop();
}

function initMicButton(){
  const micBtn = document.getElementById("micBtn");
  if(!micBtn) return;
  micBtn.addEventListener("click", () => {
    if(isRecording){
      stopRecording();
    } else {
      startRecording();
    }
  });
}

// ---------- Compliment triggers ----------
function shouldGenerateCompliment(signals){
  // Only generate when face first appears or group size transitions
  const faceJustAppeared = (lastFaceCount === 0 && signals.faceCount > 0);
  const becameCouple = (lastFaceCount !== 2 && signals.faceCount === 2);
  const becameGroup = (lastFaceCount < 3 && signals.faceCount >= 3);
  return faceJustAppeared || becameCouple || becameGroup;
}

function updateState(signals){
  lastFaceCount = signals.faceCount;
  lastSmileCount = signals.smileCount;
  lastBrightnessBucket = Math.round(signals.brightness * 10);
}

// ---------- More Compliments button ----------
function initMoreComplimentsBtn(){
  const btn = document.getElementById("moreComplimentsBtn");
  if(!btn) return;
  btn.addEventListener("click", () => {
    if(!lastSignals || lastSignals.faceCount === 0) return;
    const transitions = { becameCouple: false, becameGroup: false };
    const text = currentVoiceMode === "dan"
      ? makeComplimentDan(lastSignals, transitions)
      : makeComplimentDaria(lastSignals, transitions);
    if(text){
      complimentEl.textContent = text;
      speakForced(text);
    }
  });
}

function updateMoreComplimentsBtn(faceCount){
  const btn = document.getElementById("moreComplimentsBtn");
  if(!btn) return;
  btn.style.display = (firstComplimentShown && faceCount > 0) ? "block" : "none";
}


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

  try {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.50 }); // lowered from 0.65 for better recognition
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
      if(happy > 0.5) smileCount += 1; // lowered from 0.6 for better smile detection
    }

    const brightness = estimateBrightness();
    const centered = facesCentered(normBoxes);
    const close = facesCloseTogether(normBoxes);

    return { faceCount: detections.length, smileCount, brightness, centered, close };
  } catch(e) {
    console.error("Detection error:", e);
    return null;
  }
}

function onNoFaces(){
  stopSpeakingHard();
  firstComplimentShown = false;
  statusEl.textContent = "No face detected";
  complimentEl.textContent = "No face detected. Come back when you're ready to be admired.";
  const zero = { faceCount:0, smileCount:0, brightness:0, centered:false, close:false };
  updateConfidenceUI(0, zero);
  updateMoreComplimentsBtn(0);
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
      const text = currentVoiceMode === "dan"
        ? makeComplimentDan(signals, transitions)
        : makeComplimentDaria(signals, transitions);
      if(text){
        complimentEl.textContent = text;
        lastComplimentAt = Date.now();
        firstComplimentShown = true;
        speak(text);
      }
    }

    lastSignals = signals;
    updateMoreComplimentsBtn(signals.faceCount);
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
  initVoiceSelector();
  initMicButton();
  initMoreComplimentsBtn();

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
