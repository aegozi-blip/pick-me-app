# pick-me-app (Web MVP) — v4

What changed vs previous:
- No face boxes (clean mirror)
- Spicy-only compliments (non-explicit)
- Compliments adapt to face count:
  - 0 faces: stops + no speaking
  - 1 face: solo compliments
  - 2 faces: couples compliments
  - 3+ faces: group compliments
- Reacts to smiles + face-count transitions
- Confidence Meter UI
- Better voice selection (best available on device)
- Speak cooldown = 4500ms

## Files
- index.html
- styles.css
- app.js
- models/ (must contain the 4 face-api weight files)

## Required model files in /models
- tiny_face_detector_model-weights_manifest.json
- tiny_face_detector_model-shard1
- face_expression_model-weights_manifest.json
- face_expression_model-shard1

## Deploy
Upload these files to your GitHub Pages repo (replace existing index/styles/app), keep your existing /models folder as-is.
