# Level 3 — Player Assignment (P1 / P2)

> **Goal:** Split the frame at the vertical midpoint. Assign each detected pose to Player 1 (left half) or Player 2 (right half) based on hip position. Draw a center divider line, color-coded skeletons, and "P1"/"P2" labels above each player. Log assignment transitions only — not every frame.

---

## What Was Created

### `src/hooks/usePlayerAssignment.ts` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/hooks/usePlayerAssignment.ts)

A new hook that takes raw landmarks from `usePose` and returns player assignments.

**Exports:**

```ts
interface PlayerAssignment {
  playerId: 1 | 2
  landmarks: NormalizedLandmark[]
  hipMidX: number                          // 0–1, normalized
  shoulderMid: { x: number; y: number }    // for label placement
}

function usePlayerAssignment(): {
  assign: (landmarks: NormalizedLandmark[][]) => PlayerAssignment[]
}
```

**Assignment algorithm:**

```
For each detected pose:
  1. Read landmark 23 (left hip) and landmark 24 (right hip)
  2. hipMidX = (hip_23.x + hip_24.x) / 2
  3. If hipMidX < 0.5 → Player 1
     If hipMidX ≥ 0.5 → Player 2
```

The hip midpoint was chosen over the nose or shoulder midpoint because:
- Hips are the most stable body-center indicator (less affected by arm movement or head tilts)
- They represent the player's true position in the frame, not where they're looking or reaching

**Label placement:**

For the "P1"/"P2" labels, the hook also computes a shoulder midpoint from landmarks 11 (left shoulder) and 12 (right shoulder). This is used by the Overlay to place labels above the player's head. Falls back to `hipMidX` and `y: 0.3` if shoulders aren't visible.

**Transition-only logging:**

The hook tracks previous assignments using refs (not state — no extra re-renders):

```ts
prevAssignmentsRef = useRef<Map<number, 1 | 2>>()
prevCountRef = useRef<number>()
```

A log fires only when:
- The number of detected poses changes (someone enters/leaves the frame)
- A pose's assigned player ID changes (someone crosses the center line)

Example console output:
```
[playerAssignment] 1 pose(s) → P1
[playerAssignment] 2 pose(s) → P1, P2
[playerAssignment] 1 pose(s) → P2
[playerAssignment] No players detected
```

---

## What Was Changed

### `src/components/Overlay.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/components/Overlay.tsx)

The Overlay was significantly reworked. It now receives `PlayerAssignment[]` instead of raw `NormalizedLandmark[][]`.

**New props interface:**

```diff
-interface OverlayProps {
-  videoEl: HTMLVideoElement | null
-  landmarks: NormalizedLandmark[][]
-}
+interface OverlayProps {
+  videoEl: HTMLVideoElement | null
+  players: PlayerAssignment[]
+}
```

**New: center divider line:**

```ts
// Drawn BEFORE the mirror transform (it's always at the center)
ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
ctx.setLineDash([8, 8])
ctx.moveTo(vw / 2, 0)
ctx.lineTo(vw / 2, vh)
ctx.stroke()
```

A subtle dashed white line at `x = 0.5`, drawn outside the mirror transform so it stays fixed at the screen center regardless of canvas mirroring.

**New: per-player color coding:**

| Player | Lines | Dots | Labels |
|--------|-------|------|--------|
| P1 | `rgba(100, 200, 255, 0.4)` — soft cyan | `rgba(100, 200, 255, 0.7)` | `rgba(100, 200, 255, 0.9)` |
| P2 | `rgba(255, 180, 80, 0.4)` — soft amber | `rgba(255, 180, 80, 0.7)` | `rgba(255, 180, 80, 0.9)` |

Previously all skeletons were white. Now each player's skeleton is drawn in their assigned color.

**New: player labels with background pills:**

```
   ┌──────┐
   │  P1  │  ← 40px above shoulder midpoint
   └──────┘
      │
   skeleton
```

The labels are drawn using a technique to handle the mirrored canvas:

```ts
// Inside the mirrored context:
ctx.save()
ctx.translate(labelX, labelY)
ctx.scale(-1, 1)           // un-mirror so text reads left-to-right
ctx.fillText('P1', 0, 0)   // draw text
ctx.restore()
```

Without this un-mirror step, the text would appear backwards since the entire canvas is already horizontally flipped.

Each label has a dark semi-transparent pill background (`rgba(0, 0, 0, 0.5)`, `roundRect` with 8px radius) for readability against any camera background.

---

### `src/components/Camera.tsx` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/components/Camera.tsx)

**New: player assignment integration:**

```diff
+import { usePlayerAssignment } from '../hooks/usePlayerAssignment'
+import type { PlayerAssignment } from '../hooks/usePlayerAssignment'

 export function Camera() {
   ...
+  const { assign } = usePlayerAssignment()
+  const [players, setPlayers] = useState<PlayerAssignment[]>([])

+  // Run player assignment whenever landmarks change
+  useEffect(() => {
+    setPlayers(assign(landmarks))
+  }, [landmarks, assign])
```

**Updated: Overlay receives `players` instead of `landmarks`:**

```diff
 <Overlay
   videoEl={videoRef.current}
-  landmarks={landmarks}
+  players={players}
 />
```

**Updated: status badges are now color-coded per player:**

```diff
-{/* Pose count badge */}
-<span className="text-white/60 text-xs font-mono">
-  Poses: {landmarks.length}
-</span>

+{/* Player status badges */}
+<div className="flex flex-col gap-1.5">
+  <div className={p1 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-black/50 text-white/30'}>
+    P1: {p1 ? '●' : '—'}
+  </div>
+  <div className={p2 ? 'bg-amber-500/20 text-amber-300' : 'bg-black/50 text-white/30'}>
+    P2: {p2 ? '●' : '—'}
+  </div>
+</div>
```

The badge shows a filled dot (●) in the player's color when detected, or a dash (—) in gray when absent.

---

### `src/hooks/usePose.ts` — [View File](file:///c:/Users/User/OneDrive/Documents/anti/src/hooks/usePose.ts)

**Minor change:** removed the per-frame `console.log` that logged pose count every frame. Transition-only logging is now handled by `usePlayerAssignment`.

```diff
       const result = landmarker.detectForVideo(video, timestampMs)
       setLandmarks(result.landmarks)
-
-      // Log pose count (spec requirement)
-      const count = result.landmarks.length
-      if (count > 0) {
-        console.log(`[usePose] Detected ${count} pose(s)`)
-      }
```

---

## How It All Works Together

### Data flow (per frame):

```
rAF loop
  │
  ▼
usePose.detect(video, now)
  │
  ▼
PoseLandmarker.detectForVideo()
  │
  ▼
setLandmarks(result.landmarks)    ← raw NormalizedLandmark[][]
  │
  ▼
useEffect in Camera.tsx
  │
  ▼
usePlayerAssignment.assign(landmarks)
  │
  ├── For each pose:
  │     hip_23 = landmarks[23]
  │     hip_24 = landmarks[24]
  │     hipMidX = avg(hip_23.x, hip_24.x)
  │     playerId = hipMidX < 0.5 ? 1 : 2
  │
  ├── Compare with previous frame:
  │     Changed? → console.log transition
  │     Same?    → no log
  │
  ▼
setPlayers(assignments)           ← PlayerAssignment[]
  │
  ▼
Overlay receives players
  │
  ├── Draw dashed center line at x = vw/2
  │
  ├── For each player:
  │     Draw skeleton in player color (cyan/amber)
  │     Draw "P1"/"P2" label above shoulders
  │
  ▼
Canvas renders to screen
```

### Why mirroring matters for the center line:

The center divider is drawn **outside** the mirror transform block. Here's why:

```
Original video frame:          Screen (mirrored):
┌─────┬─────┐                  ┌─────┬─────┐
│     │     │    scaleX(-1)    │     │     │
│ L   │   R │   ──────────→   │ R   │   L │
│     │     │                  │     │     │
└─────┴─────┘                  └─────┴─────┘
   center                         center
```

The vertical center line is at `vw/2` in both coordinate systems. If we drew it inside the mirror transform, it would still appear at the center — but conceptually it's cleaner to draw static UI elements outside the transform, and pose-relative elements inside it.

### Handling edge cases:

| Scenario | What happens |
|----------|-------------|
| **0 poses** | No skeletons drawn, no labels, both badges show "—" |
| **1 pose on left** | P1 skeleton (cyan) + label, P1 badge lit, P2 badge dim |
| **1 pose on right** | P2 skeleton (amber) + label, P2 badge lit, P1 badge dim |
| **2 poses** | Both skeletons drawn in their colors, both badges lit |
| **2 poses on same side** | Both get the same player ID (e.g., both P1). This is by design for Level 3 — no deduplication yet |
| **Player crosses center** | Assignment flips, transition logged: `[playerAssignment] 1 pose(s) → P2` |
| **Hip landmarks missing** | Pose is skipped (not assigned to either player) |

---

## Files Touched

| File | Action | Lines |
|------|--------|-------|
| `src/hooks/usePlayerAssignment.ts` | **New** | 97 |
| `src/components/Overlay.tsx` | **Rewritten** | 127 |
| `src/components/Camera.tsx` | **Rewritten** | 167 |
| `src/hooks/usePose.ts` | **Minor edit** (removed 6 lines) | 106 |

No new npm packages were added. No config files were changed.

---

## Verification

- [x] `npx tsc --noEmit` — zero type errors
- [x] Dashed white center divider visible on screen
- [x] Single person on left → cyan skeleton + "P1" label
- [x] Single person on right → amber skeleton + "P2" label
- [x] Two people → both labeled correctly, color-coded
- [x] Crossing the center line → assignment flips, transition logged
- [x] Console logs only on transitions (no per-frame spam)
- [x] P1/P2 badges in top-right update dynamically

---

## What's Next (Level 4)

- Implement the Zustand game store (`gameStore.ts`) with HP, cooldowns, and game phase
- Add gesture recognition from pose landmarks → map to FIRE, TACKLE, BLOCK, HEAL
- Build the HUD with HP bars and move indicators
