
const video=document.getElementById("video");
const complimentEl=document.getElementById("compliment");

let lastSpokenAt=0;
const speakCooldownMs=4500;

function speak(text){
const now=Date.now();
if(now-lastSpokenAt<speakCooldownMs)return;
lastSpokenAt=now;
speechSynthesis.cancel();
let u=new SpeechSynthesisUtterance(text);
u.rate=1;
u.lang="en-US";
speechSynthesis.speak(u);
}

function compliment(){
const lines=[
"You look illegally good right now.",
"Someone is going to develop a crush in about 3 minutes.",
"That mirror is lucky.",
"You are 100% the interesting person in the room.",
"Confidence level: cinematic.",
"Respectfully... wow.",
"Main character energy detected.",
"You look like trouble in the best way.",
"If charm was electricity this place would be glowing.",
"You didn't come here to be average and it shows.",
"That look works dangerously well.",
"You look like you know secrets.",
"This is unfair to the rest of humanity.",
"You just raised the temperature slightly.",
"That vibe is expensive.",
"You look like the reason plans change.",
"You are definitely someone's type right now.",
"You look better than you expected to.",
"That confidence is doing real damage.",
"You understood the assignment perfectly."
];

let t=lines[Math.floor(Math.random()*lines.length)];
complimentEl.innerText=t;
speak(t);
}

async function startCamera(){
const stream=await navigator.mediaDevices.getUserMedia({
video:{facingMode:"user"}
});
video.srcObject=stream;
}

setInterval(compliment,5000);
startCamera();
