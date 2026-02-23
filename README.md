# The Pick Me App (Web MVP)

A static, browser-based MVP:
- front camera mirror
- face count + smile detection
- lighting + framing + group closeness cues
- compliments tailored to count + a style selector
- optional text-to-speech

This is designed to run on **GitHub Pages** (HTTPS) or **localhost**.

## 1) Repository structure

Your repo should look like this:

```
pick-me-app/
  index.html
  styles.css
  app.js
  models/
    (model files go here)
```

## 2) Create the repo (GitHub)

1. On GitHub: create a new repository named `pick-me-app`
2. Clone it locally:
   - `git clone https://github.com/<YOUR_USER>/pick-me-app.git`
3. Copy these files into the repo root (the files included in this ZIP).

## 3) Add the face-api.js model files (REQUIRED)

This project uses face-api.js models loaded from `./models`.

Create a folder named `models` in the repo root (already included here), then place the following files inside:

### Required model files

**Tiny Face Detector**
- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`

**Face Expression Net**
- `face_expression_model-weights_manifest.json`
- `face_expression_model-shard1`

### Where to get the model files

Option A (recommended): download from the official face-api.js repository (weights folder).

In your browser, search for:
- `face-api.js weights tiny_face_detector_model-shard1`
- `face-api.js weights face_expression_model-shard1`

You should find a `weights/` folder that contains the exact filenames above. Download those 4 files and drop them into `models/`.

Option B: if you already have face-api weights from another project, reuse them as long as the filenames match exactly.

## 4) Run locally (camera works on localhost)

Browsers allow camera access on **localhost** without HTTPS.

### Option A: Python
From the repo folder:
- `python3 -m http.server 8000`
Open:
- `http://localhost:8000`

### Option B: VS Code Live Server
- Install the “Live Server” extension
- Right click `index.html` → “Open with Live Server”

## 5) Deploy to GitHub Pages (HTTPS)

1. `git add .`
2. `git commit -m "Pick Me App MVP"`
3. `git push`

Then in GitHub:
- Settings → Pages
- Source: Deploy from a branch
- Branch: `main` / Folder: `/ (root)`
- Save

Wait a minute, then your site should be available at:
- `https://<YOUR_USER>.github.io/pick-me-app/`

## 6) Permissions + common issues

- First load will ask for camera permission. Click **Allow**.
- If you see “Camera needs HTTPS”:
  - Use GitHub Pages URL, or run on localhost.
- If the UI loads but no faces are detected:
  - Confirm the 4 model files exist in `models/` and filenames match exactly.
  - Open DevTools Console and look for 404 errors for model files.

## 7) Customization

- Change compliment text in `app.js` (function `makeCompliment`)
- Increase/decrease how often it speaks by tuning `speakCooldownMs`
- Remove face boxes by deleting `drawBoxes(detections)` call in `detectLoop()`
