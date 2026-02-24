// app.js

const complimentSet = {
    happy: ["You're doing great! Keep it up!", "Your positivity is infectious!"],
    sad: ["It's okay to feel down sometimes. You're strong!", "Remember, every day might not be good, but there's something good in every day!"],
    motivated: ["You are capable of achieving amazing things!", "Your hard work will pay off!"],
    // Add more conditions as needed
};

function generateCompliment(condition) {
    const compliments = complimentSet[condition] || [];
    return compliments.length ? compliments[Math.floor(Math.random() * compliments.length)] : "You're doing your best!";
}

const barFill = document.getElementById('barFill');
function updateConfidenceMeter(confPct) {
    if (confPct >= 70) {
        barFill.classList.add('high-confidence');
    } else {
        barFill.classList.remove('high-confidence');
    }
    if (confPct === 100) {
        barFill.classList.add('milestone');
        speechSynthesis.speak(new SpeechSynthesisUtterance("Congratulations! You did it!"));
    } else {
        barFill.classList.remove('milestone');
    }
}

let brightnessCanvas;
function estimateBrightness() {
    if (!brightnessCanvas) {
        brightnessCanvas = document.createElement('canvas');
    }
    // Existing logic to estimate brightness
times
}

let lastDisplayedConfidence = null;
let lastDisplayedHint = null;
function updateDOM(confPct, hint) {
    if (lastDisplayedConfidence !== confPct) {
        document.getElementById('confidenceDisplay').innerText = confPct;
        lastDisplayedConfidence = confPct;
    }
    if (lastDisplayedHint !== hint) {
        document.getElementById('hintDisplay').innerText = hint;
        lastDisplayedHint = hint;
    }
}

function setupCamera() {
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            // Start camera stream
        })
        .catch(error => {
            if (error.name === "NotAllowedError") {
                alert("Camera access was denied. Please allow access to use this feature.");
            } else if (error.name === "NotFoundError") {
                alert("No camera found. Please connect a camera and try again.");
            }
        });
}

window.addEventListener('beforeunload', () => {
    clearInterval(/* your interval reference */);
    // Stop camera tracks
    const stream = /* your video stream reference */;
    stream.getTracks().forEach(track => track.stop());
});

const scoreThreshold = 0.65; // Increased for more accurate detection

let detectionInFlight = false;
setInterval(() => {
    if (!detectionInFlight) {
        detectionInFlight = true;
        // Detection logic
        detectionInFlight = false;
    }
}, 300); // Increased interval during detection
