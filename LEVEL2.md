# Level 2 — Pose Detection & Skeleton Overlay

> **Goal:** Load the MediaPipe PoseLandmarker model, run detection every animation frame on the live camera feed, and draw a faint white skeleton overlay on a `<canvas>` that matches and mirrors the video. Handle zero, one, or two detected poses. No player assignment, gestures, or HP yet.

---

## What Was Created

### Model File

| File | Size | Source |
|------|------|--------|
| `public/pose_landmarker_lite.task` | 5.8 MB | [Google Storage CDN](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task) |

This is the pre-trained MediaPipe pose landmark model (lite variant, float16). It lives in `public/` so Vite serves it as a static asset at `/pose_landmarker_lite.task`.

---

### `src/hooks/usePose.ts` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/hooks/usePose.ts)

A custom hook that manages the entire lifecycle of the PoseLandmarker.

**Exports:**

```ts
function usePose(): {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  landmarks: NormalizedLandmark[][]   // one sub-array per detected person
  detect: (video: HTMLVideoElement, timestampMs: number) => void
}
```

**Initialization (runs once on mount):**

```
FilesetResolver.forVisionTasks(CDN_URL)
  → PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/pose_landmarker_lite.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 2,
    })
  → status: 'ready'
```

| Config Option | Value | Why |
|--------------|-------|-----|
| `modelAssetPath` | `/pose_landmarker_lite.task` | Local file from `public/`, avoids runtime CDN download |
| `delegate` | `'GPU'` | Uses WebGL for inference — much faster than CPU |
| `runningMode` | `'VIDEO'` | Enables temporal tracking between frames (smoother than per-image detection) |
| `numPoses` | `2` | Detect up to two players simultaneously |

**The `detect()` function:**

- Designed to be called inside a `requestAnimationFrame` loop
- Accepts the `<video>` element and `performance.now()` timestamp
- Guards against:
  - Model not ready yet (`status !== 'ready'`)
  - Video not ready (`readyState < 2`)
  - Duplicate/out-of-order timestamps (MediaPipe requires strictly increasing values)
- Calls `landmarker.detectForVideo(video, timestamp)` and stores `result.landmarks`
- Logs pose count to console: `[usePose] Detected N pose(s)`

**Cleanup on unmount:**

- Sets `cancelled = true` to prevent state updates after unmount
- Calls `landmarker.close()` to free WASM/GPU resources

---

### `src/components/Overlay.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/components/Overlay.tsx)

A transparent `<canvas>` that draws detected skeletons on top of the video feed.

**Props:**

```ts
interface OverlayProps {
  videoEl: HTMLVideoElement | null    // used to read videoWidth/videoHeight
  landmarks: NormalizedLandmark[][]   // from usePose
}
```

**How it draws:**

1. **Sizes the canvas** to match the video's native resolution (`videoWidth × videoHeight`), not the CSS display size. This ensures crisp lines at any zoom level.

2. **Mirrors the canvas** to match the mirrored video:
   ```ts
   ctx.translate(vw, 0)
   ctx.scale(-1, 1)
   ```

3. **For each detected pose**, iterates over `PoseLandmarker.POSE_CONNECTIONS` — a built-in array of `{ start, end }` pairs defining which landmarks to connect (e.g., shoulder→elbow, elbow→wrist).

4. **Draws connection lines** as faint white strokes:
   - `rgba(255, 255, 255, 0.35)` — visible but not distracting over the camera feed
   - `lineWidth: 2`, `lineCap: 'round'`
   - Skips any landmark with `visibility < 0.3` (occluded or out of frame)

5. **Draws landmark dots** as slightly brighter circles:
   - `rgba(255, 255, 255, 0.6)`, radius 3px
   - Same visibility threshold

**CSS positioning:**

```
absolute inset-0 h-full w-full object-cover pointer-events-none
```

This stacks the canvas directly on top of the video. `pointer-events-none` ensures clicks pass through to elements underneath. `object-cover` matches the video's scaling behaviour.

---

## What Was Changed

### `src/components/Camera.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/components/Camera.tsx)

This was the biggest change — the Camera component now orchestrates both the camera feed and pose detection.

**New imports and hooks:**

```diff
+import { useEffect, useCallback, useRef, useState } from 'react'
 import { useCamera } from '../hooks/useCamera'
+import { usePose } from '../hooks/usePose'
+import { Overlay } from './Overlay'
```

**New: rAF detection loop:**

```ts
const startLoop = useCallback(() => {
  function loop() {
    detect(videoRef.current, performance.now())
    rafIdRef.current = requestAnimationFrame(loop)
  }
  rafIdRef.current = requestAnimationFrame(loop)
}, [camStatus, poseStatus, detect])
```

- Starts only when both `camStatus === 'active'` AND `poseStatus === 'ready'`
- Cancels via `cancelAnimationFrame` on unmount or dependency change

**New: video readiness tracking:**

```ts
const [videoReady, setVideoReady] = useState(false)
// Listens for the 'playing' event on the video element
```

- The `<Overlay>` is only mounted once the video is actually playing, so it can read `videoWidth` / `videoHeight` reliably.

**New: Overlay integration:**

```diff
+{videoReady && (
+  <Overlay videoEl={videoRef.current} landmarks={landmarks} />
+)}
```

**New: model loading indicator:**

```
┌──────────────────────────────────┐
│  ⟳  Loading pose model…         │  ← shown when camera active but model still loading
└──────────────────────────────────┘
```

A pill-shaped indicator at the top center, with a spinner and text. Uses `bg-black/50 backdrop-blur-sm` for a subtle glass effect over the camera feed.

**New: live pose count badge:**

```
                        ┌──────────┐
                        │ Poses: 2 │  ← top-right corner
                        └──────────┘
```

A monospaced badge showing the current number of detected poses. Updates every frame via `landmarks.length`.

**Updated: error handling:**

The error card now also handles `poseStatus === 'error'` and displays `poseError` alongside camera errors:

```diff
-{(camStatus === 'denied' || camStatus === 'error') && (
+{(camStatus === 'denied' || camStatus === 'error' || poseStatus === 'error') && (
```

---

## How It All Works Together

```
┌─────────────────────────────────────────────────────────────────┐
│                        Camera.tsx                                │
│                                                                  │
│  useCamera()  ──→  videoRef, camStatus                          │
│  usePose()    ──→  detect(), landmarks, poseStatus              │
│                                                                  │
│  ┌──── rAF loop (starts when both ready) ────┐                  │
│  │                                            │                  │
│  │  detect(videoRef.current, performance.now())│                  │
│  │     │                                      │                  │
│  │     ▼                                      │                  │
│  │  PoseLandmarker.detectForVideo(video, ts)  │                  │
│  │     │                                      │                  │
│  │     ▼                                      │                  │
│  │  setLandmarks(result.landmarks)            │                  │
│  │     │                                      │                  │
│  │     ▼                                      │                  │
│  │  React re-render → Overlay receives new    │                  │
│  │  landmarks and redraws the canvas          │                  │
│  │                                            │                  │
│  └──── requestAnimationFrame(loop) ──────────┘                  │
│                                                                  │
│  Render:                                                         │
│  ┌──────────────────────────────────┐                           │
│  │ <video> (mirrored, fullscreen)   │ ← z-index layer 0        │
│  │ <canvas> (mirrored skeleton)     │ ← z-index layer 1        │
│  │ Loading pill / Pose badge        │ ← z-index layer 2        │
│  └──────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Frame-by-frame flow:

1. `requestAnimationFrame` fires → calls `detect(video, now)`
2. `usePose.detect()` checks guards → calls `landmarker.detectForVideo(video, timestamp)`
3. MediaPipe returns `PoseLandmarkerResult` with `landmarks: NormalizedLandmark[][]`
4. `setLandmarks(...)` triggers a React re-render
5. `Overlay` receives new landmarks → clears canvas → draws connections + dots (mirrored)
6. Loop continues via `requestAnimationFrame`

### Handling different pose counts:

| Count | What happens |
|-------|-------------|
| **0** | `landmarks` is `[]` → Overlay clears canvas, nothing drawn. Badge shows "Poses: 0" |
| **1** | `landmarks` has 1 sub-array → one skeleton drawn. Badge shows "Poses: 1" |
| **2** | `landmarks` has 2 sub-arrays → two skeletons drawn independently. Badge shows "Poses: 2" |

### Why the canvas is mirrored separately:

The video is mirrored via CSS (`scale-x-[-1]`), but the canvas cannot rely on CSS mirroring because we draw using normalized landmark coordinates (0→1 left→right). If the canvas used CSS mirroring, the landmarks would be placed at the wrong positions. Instead, we apply a canvas-level mirror transform:

```ts
ctx.translate(canvasWidth, 0)   // shift origin to right edge
ctx.scale(-1, 1)                // flip horizontally
```

This ensures that landmark `x: 0.3` (30% from the left in the original frame) is drawn at 70% from the left on screen — matching the mirrored video exactly.

---

## Files Touched

| File | Action | Lines |
|------|--------|-------|
| `src/hooks/usePose.ts` | **Rewritten** (was placeholder) | 107 |
| `src/components/Overlay.tsx` | **Rewritten** (was placeholder) | 82 |
| `src/components/Camera.tsx` | **Rewritten** (expanded from Level 1) | 155 |
| `public/pose_landmarker_lite.task` | **New** (downloaded binary) | 5.8 MB |

No new npm packages were added. No config files were changed.

---

## Verification

- [x] `npx tsc --noEmit` — zero type errors
- [x] Model file exists at `public/pose_landmarker_lite.task` (5,777,746 bytes)
- [x] Dev server running — hot-reloads on save
- [x] Skeleton lines visible when 1 person is in frame
- [x] Two skeletons drawn when 2 people are in frame
- [x] Canvas clears cleanly when nobody is in frame
- [x] Console logs: `[usePose] Detected N pose(s)`
- [x] "Loading pose model…" pill shown during model initialization
- [x] "Poses: N" badge updates in real-time

---

## What's Next (Level 3)

- Assign detected poses to Player 1 (left) and Player 2 (right)
- Implement the Zustand game store with HP, cooldowns, and phase state
- Add gesture recognition from pose landmarks (fire, tackle, block, heal)
