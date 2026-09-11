# Level 1 — Live Camera Feed

> **Goal:** Display a fullscreen, mirrored webcam feed. Handle permission denied and camera errors gracefully. No pose detection or canvas overlay yet.

---

## What Was Created

### `src/hooks/useCamera.ts` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/hooks/useCamera.ts)

A custom React hook that encapsulates all webcam logic.

**Exports:**

```ts
function useCamera(): {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: 'idle' | 'requesting' | 'active' | 'denied' | 'error'
  error: string | null
}
```

**What it does:**

1. On mount, calls `navigator.mediaDevices.getUserMedia()` requesting the front-facing camera at 1280×720.
2. Attaches the resulting `MediaStream` to the `videoRef` and starts playback.
3. Tracks status through a state machine: `idle` → `requesting` → `active` (success) or `denied` / `error` (failure).
4. Parses specific `DOMException` names to produce human-readable error messages:

| DOMException | Status | Message |
|-------------|--------|---------|
| `NotAllowedError` | `denied` | Camera permission was denied… |
| `NotFoundError` | `error` | No camera found on this device. |
| `NotReadableError` / `AbortError` | `error` | Camera is already in use… |
| Other | `error` | Camera error: \<message\> |

5. On unmount, stops all media tracks to release the camera.

---

### `src/components/Camera.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/components/Camera.tsx)

The UI component that renders the camera feed and all status states.

**Structure:**

```
<div>  (fullscreen black container)
├── <video>         always in DOM, mirrored, fades in when active
├── Loading UI      shown when status === 'requesting'
├── Idle UI         brief flash before request fires
└── Error card      shown when status === 'denied' or 'error'
```

**Key styling decisions:**

| Feature | Implementation | Why |
|---------|---------------|-----|
| Mirroring | `scale-x-[-1]` (Tailwind arbitrary value) | Selfie-mode: user expects mirror behavior |
| Fullscreen fill | `absolute inset-0 h-full w-full object-cover` | Covers viewport regardless of camera aspect ratio |
| Fade-in | `opacity-0` → `opacity-100` with `transition-opacity duration-500` | Avoids a jarring flash when the feed starts |
| Error card | `bg-red-950/80 backdrop-blur-md border border-red-500/30 rounded-2xl` | Glassmorphic style, clearly communicates failure |
| Spinner | `border-4 border-white/20 border-t-white animate-spin rounded-full` | Pure CSS spinner, no extra deps |
| Retry button | Calls `window.location.reload()` | Simplest way to re-trigger the permission prompt |

---

## What Was Changed

### `src/App.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/App.tsx)

```diff
+import { Camera } from './components/Camera'
+
 function App() {
-  return (
-    <div className="flex items-center justify-center h-screen w-screen bg-black">
-      <h1 className="text-5xl font-bold text-white tracking-wider drop-shadow-lg">
-        PokéBattle AR
-      </h1>
-    </div>
-  )
+  return <Camera />
 }
```

**Why:** The Level 0 splash screen is replaced by the live camera feed. `App` is now just a thin shell that renders the `Camera` component.

---

## How It Works

```
User opens page
      │
      ▼
  App.tsx renders <Camera />
      │
      ▼
  Camera.tsx calls useCamera()
      │
      ▼
  useCamera runs useEffect on mount
      │
      ├── status: 'idle' → 'requesting'
      │
      ▼
  getUserMedia({ video: { facingMode: 'user' } })
      │
      ├─── ✅ Success ──────────────────────────┐
      │    stream → videoRef.current.srcObject   │
      │    videoRef.current.play()               │
      │    status → 'active'                     │
      │    <video> fades in (opacity transition) │
      │                                          │
      ├─── ❌ NotAllowedError ──────────────┐    │
      │    status → 'denied'                │    │
      │    error → "Camera permission…"     │    │
      │    Red error card shown             │    │
      │                                     │    │
      └─── ❌ Other DOMException ──────┐    │    │
           status → 'error'            │    │    │
           error → specific message    │    │    │
           Red error card shown        │    │    │
                                       │    │    │
  ┌────────────────────────────────────┘    │    │
  │  [Retry] button → reload page          │    │
  └────────────────────────────────────────┘    │
                                                │
  Component unmounts ◄──────────────────────────┘
      │
      ▼
  Cleanup: stream.getTracks().forEach(t => t.stop())
  Camera hardware is released
```

### The Video Element

The `<video>` tag is always present in the DOM (not conditionally rendered). This is intentional:

1. The `ref` must be attached **before** `getUserMedia` resolves, so there's a valid element to assign `srcObject` to.
2. When status is not `active`, the video has `opacity-0` — it's invisible but still exists.
3. When the stream starts, it transitions to `opacity-100` over 500ms for a smooth fade-in.

### The Mirror Transform

```
scale-x-[-1]  →  transform: scaleX(-1)
```

This flips the video horizontally. Without it, moving your right hand would move the on-screen hand to the left, which feels unnatural in a selfie/AR context. This is standard for any front-facing camera application.

---

## Files Touched

| File | Action | Lines |
|------|--------|-------|
| `src/hooks/useCamera.ts` | **Rewritten** (was placeholder) | 80 |
| `src/components/Camera.tsx` | **Rewritten** (was placeholder) | 90 |
| `src/App.tsx` | **Modified** — renders `<Camera />` | 7 |

No new dependencies were added. No config files were changed.

---

## Verification

- [x] `npx tsc --noEmit` — zero type errors
- [x] Dev server runs at `http://localhost:5174/`
- [x] Granting camera permission → fullscreen mirrored feed fades in
- [x] Denying camera permission → red glassmorphic error card with retry button
- [x] No pose detection or canvas elements in the DOM

---

## What's Next (Level 2)

- Add a `<canvas>` overlay on top of the video (in `Overlay.tsx`)
- Initialize MediaPipe Pose Landmarker in `usePose.ts`
- Draw detected skeleton landmarks on the canvas
