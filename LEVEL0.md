# Level 0 — Project Scaffold

> **Goal:** Set up the foundational Vite + React + TypeScript project with Tailwind CSS, Zustand, and MediaPipe installed. Create the folder structure and render a minimal "PokéBattle AR" splash screen to confirm the toolchain works.

---

## What Was Created

### Project Scaffold

The project was bootstrapped with **Vite** using the `react-ts` template, giving us:

| File | Purpose |
|------|---------|
| `index.html` | HTML entry point — mounts the React app into `<div id="root">` |
| `vite.config.ts` | Vite config with the React and Tailwind CSS plugins |
| `tsconfig.json` | Root TypeScript config referencing `tsconfig.app.json` and `tsconfig.node.json` |
| `tsconfig.app.json` | TypeScript settings for the app source code (`src/`) |
| `tsconfig.node.json` | TypeScript settings for Node-side files (Vite config, etc.) |
| `package.json` | Project metadata, scripts (`dev`, `build`, `preview`), and dependencies |

### Source Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | React entry point — renders `<App />` inside `<StrictMode>` |
| `src/App.tsx` | Root component — black fullscreen div with "PokéBattle AR" title |
| `src/index.css` | Global CSS — imports Tailwind via `@import "tailwindcss"` |
| `src/App.css` | App-specific styles — intentionally empty for now |

### Placeholder Files (Empty Stubs)

These files define the folder structure for future levels. Each contains only an `export {}` and a comment describing its future purpose.

```
src/
├── components/
│   ├── Camera.tsx        → Camera capture component (Level 1+)
│   ├── Overlay.tsx       → Canvas overlay for AR rendering (Level 1+)
│   └── HUD.tsx           → Heads-up display: HP bars, timers, etc. (Level 1+)
├── hooks/
│   ├── useCamera.ts      → Hook to acquire & manage the webcam stream (Level 1+)
│   └── usePose.ts        → Hook wrapping MediaPipe pose detection (Level 1+)
├── store/
│   └── gameStore.ts      → Zustand store for global game state (Level 2+)
├── game/
│   ├── poseClassifier.ts → Maps detected poses to attack types (Level 2+)
│   └── battleEngine.ts   → Damage calc & battle turn logic (Level 2+)
├── types/
│   └── index.ts          → Shared TypeScript interfaces & types
└── utils/
    └── index.ts          → General utility functions
```

---

## What Was Changed (from Vite Defaults)

### `vite.config.ts`

```diff
 import react from '@vitejs/plugin-react'
+import tailwindcss from '@tailwindcss/vite'
 import { defineConfig } from 'vite'

 export default defineConfig({
-  plugins: [react()],
+  plugins: [react(), tailwindcss()],
 })
```

**Why:** Tailwind CSS v4 uses a Vite plugin (`@tailwindcss/vite`) instead of PostCSS. This wires Tailwind into Vite's transform pipeline so utility classes are compiled at build time.

### `src/index.css`

```diff
-/* (2000+ chars of Vite default styles) */
+@import "tailwindcss";
```

**Why:** Replaced Vite's demo CSS with the single Tailwind v4 import directive. This tells Tailwind to inject its base, components, and utilities layers.

### `src/App.tsx`

```diff
-/* Default Vite counter demo */
+function App() {
+  return (
+    <div className="flex items-center justify-center h-screen w-screen bg-black">
+      <h1 className="text-5xl font-bold text-white tracking-wider drop-shadow-lg">
+        PokéBattle AR
+      </h1>
+    </div>
+  )
+}
```

**Why:** The black fullscreen div confirms the app renders. The Tailwind utility classes (`text-5xl`, `font-bold`, `tracking-wider`, `drop-shadow-lg`) confirm Tailwind is processing CSS correctly — if the text appears large, bold, white, with letter-spacing and a shadow, the toolchain is working end-to-end.

### `src/main.tsx`

```diff
 import { StrictMode } from 'react'
 import { createRoot } from 'react-dom/client'
 import './index.css'
-import App from './App.tsx'
+import App from './App'
```

**Why:** Minor cleanup — removed the `.tsx` extension from the import (Vite resolves it automatically).

---

## Installed Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `tailwindcss` | v4 | Utility-first CSS framework |
| `@tailwindcss/vite` | v4 | Vite plugin for Tailwind v4 (replaces PostCSS setup) |
| `zustand` | latest | Lightweight state management for React (game state in future levels) |
| `@mediapipe/tasks-vision` | latest | Google's vision ML models — pose detection (future levels) |

---

## How It Works

```
┌─────────────────────────────────────────────────┐
│  Browser loads index.html                       │
│  ├── <div id="root">                            │
│  └── <script src="src/main.tsx">                │
│       ├── imports index.css → Tailwind kicks in │
│       └── renders <App /> into #root            │
│            └── <div class="bg-black h-screen">  │
│                 └── <h1> PokéBattle AR </h1>    │
└─────────────────────────────────────────────────┘
```

1. **Vite** serves `index.html`, which contains a `<div id="root">` and a module script pointing to `src/main.tsx`.
2. **main.tsx** imports `index.css` (triggering Tailwind processing) and renders the `<App />` component into the root div.
3. **App.tsx** returns a single full-viewport `<div>` with a black background and a centered heading.
4. **Tailwind CSS v4** (via the `@tailwindcss/vite` plugin) scans the source files for utility class names and generates only the CSS that's actually used.

### Running It

```bash
npm run dev        # Start dev server (http://localhost:5173)
npm run build      # Production build to dist/
npm run preview    # Preview the production build locally
```

---

## Verification Checklist

- [x] `npm run dev` starts without errors
- [x] `npx tsc --noEmit` passes with zero type errors
- [x] Page shows a black fullscreen background
- [x] "PokéBattle AR" text is white, large, bold, with letter-spacing (Tailwind works)
- [x] All placeholder directories and files exist under `src/`
- [x] `zustand` and `@mediapipe/tasks-vision` are in `node_modules` (installed, not yet used)

---

## What's Next (Level 1)

- Wire up the webcam via `useCamera` hook + `Camera` component
- Initialize MediaPipe Pose Landmarker in `usePose` hook
- Render the camera feed with a skeleton overlay on the `Overlay` canvas
