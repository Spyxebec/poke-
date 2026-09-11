$spec = @'
# PokéBattle AR - Real-Life Pokemon Battles

## 1. Project Summary
A browser-based web app that turns two people in front of a webcam into
Pokemon battlers. Pose detection tracks both players; gestures trigger
moves; HP bars deplete until one player wins.

## 2. Constraints
- Time budget: 14 hours total. Ship an MVP, not a polished product.
- Platform: Web only. Chrome/Edge desktop. No mobile, no native app.
- Network: None. Both players must be in the same camera frame.
- No backend. Everything runs client-side.
- Prefer simplicity over cleverness. Rule-based > ML. Fixed UI > AR.

## 3. Tech Stack (do not substitute)
- Vite + React 18 + TypeScript
- @mediapipe/tasks-vision (PoseLandmarker, numPoses: 2)
- Tailwind CSS for styling
- Zustand for game state
- HTML5 Canvas for overlay rendering
- Free SFX bundled as static assets
- Deploy target: Vercel

## 4. Architecture

src/
  main.tsx                 # entry
  App.tsx                  # top-level: camera + canvas + UI
  game/
    types.ts               # all TS interfaces & enums
    state.ts               # Zustand store
    loop.ts                # requestAnimationFrame game loop
    moves.ts               # move definitions
  vision/
    pose.ts                # MediaPipe PoseLandmarker
    assign.ts              # left-half=P1, right-half=P2
    gestures.ts            # gesture detection
  render/
    canvas.ts              # draw skeleton, HP bars, floating text
    effects.ts             # hit flash
  ui/
    HUD.tsx                # top bar, start/restart
    StartScreen.tsx        # "stand left = P1, right = P2"

## 5. State Machine

IDLE -> BATTLE -> GAME_OVER -> (restart) -> BATTLE

- IDLE: camera on, no tracking. Show StartScreen.
- BATTLE: tracking active, gestures fire moves, HP depletes.
- GAME_OVER: winner shown, restart button. Tracking paused.

No other states. No pause, no calibration, no menu.

## 6. Data Models

    type Phase = 'IDLE' | 'BATTLE' | 'GAME_OVER';
    type MoveId = 'FIRE' | 'TACKLE' | 'BLOCK' | 'HEAL';

    interface Move {
      id: MoveId;
      name: string;
      damage: number;        // negative = heal
      cooldownMs: number;
      sfx: string;
    }

    interface Player {
      id: 1 | 2;
      hp: number;            // starts at 100, max 100
      cooldownUntil: number;
      blockUntil: number;
      lastGesture: MoveId | null;
      lastGestureAt: number;
    }

    interface GameState {
      phase: Phase;
      players: [Player, Player];
      winner: 1 | 2 | null;
      floatingText: { text: string; x: number; y: number; bornAt: number }[];
    }

## 7. Feature Spec (acceptance criteria)

### F1 - Camera
- On mount, request webcam via navigator.mediaDevices.getUserMedia.
- Render video fullscreen. Do NOT mirror (simpler for landmark math).
- Permission denied -> show error message.

### F2 - Pose Detection
- Load PoseLandmarker with numPoses: 2, runningMode: 'VIDEO'.
- Model file at /pose_landmarker_lite.task (in public/).
- Run detectForVideo every animation frame.
- Draw faint skeleton lines on canvas overlay.

### F3 - Player Assignment
- Screen split at x = 0.5.
- Pose hip midpoint X (avg landmarks 23 and 24).
- hip mid X < 0.5 -> Player 1. Else -> Player 2.
- Draw "P1" / "P2" above each head (shoulder mid, offset up 40px).
- If a player missing > 2s, freeze HP but keep game running.

### F4 - Gesture Detection
- Run gesture check every frame per player.
- Gesture must hold 300ms continuously to fire.
- After firing, apply move cooldown; ignore further gestures until cooldown ends.

### F5 - Move Resolution
- TACKLE: opponent -10 HP, 1s cooldown.
- FIRE: opponent -15 HP, 2s cooldown.
- HEAL: self +10 HP (cap 100), 5s cooldown.
- BLOCK: self blockUntil = now + 1000ms, 3s cooldown.
- If opponent has blockUntil > now, damage = 0 and clear block.
- Clamp HP to [0, 100].
- Push floating text: "P1 used FIRE!".

### F6 - Rendering
- Skeleton: faint white lines for both players.
- HP bar above each player's head: rounded, black border, 120x10px.
- Color: green > 50, yellow > 20, red <= 20.
- Floating text drifts up 40px, fades over 1200ms.

### F7 - Win Condition
- Any player HP <= 0 -> phase GAME_OVER, set winner.
- Overlay: "PLAYER N WINS" + Restart button.
- Restart -> reset() -> phase BATTLE.

### F8 - Audio
- Play move SFX on fire.
- Play hit.mp3 on damage.
- Play win.mp3 on game over.
- Volume 0.5. No background music.

## 8. Gesture Rules (exact math)

MediaPipe landmark indices:
  11, 12 = shoulders
  13, 14 = elbows
  15, 16 = wrists
  23, 24 = hips

Y increases downward. "Above" means SMALLER Y.

| Move   | Rule |
|--------|------|
| FIRE (trigger: FINGER GUN, pose-only):<br>- One wrist extended horizontally away from the body at shoulder height.<br>- Conditions using pose landmarks:<br>  \|wrist.y - shoulder.y\| < 0.15          (at shoulder height)<br>  \|wrist.x - shoulderMidX\| > 0.20        (extended away from body)<br>  where shoulderMidX = (landmarks[11].x + landmarks[12].x) / 2.<br>- Check BOTH wrists. If either matches, gesture fires.<br>- Either arm is fine. Direction does not matter for detection.<br>  (Fireball direction is computed separately, see STEP C.) |
| TACKLE | both fists pulled in at chest:<br>lm[15].y > shoulderMidY AND lm[15].y < hipMidY<br>lm[16].y > shoulderMidY AND lm[16].y < hipMidY<br>\|lm[15].x - shoulderMidX\| < 0.20<br>\|lm[16].x - shoulderMidX\| < 0.20 |
| BLOCK  | arms crossed at chest:<br>\|lm[15].x - lm[16].x\| < 0.10<br>\|lm[15].y - lm[16].y\| < 0.10<br>lm[15].y > shoulderMidY AND lm[15].y < hipMidY<br>lm[16].y > shoulderMidY AND lm[16].y < hipMidY |
| HEAL   | one hand up, one down:<br>(lm[15].y < lm[11].y - 0.15) XOR (lm[16].y < lm[12].y - 0.15)<br>AND the other wrist below hipMidY |

If no rule matches, no gesture.
Priority if multiple match: BLOCK > HEAL > FIRE > TACKLE.

## 9. Out of Scope (DO NOT BUILD)

- Multiplayer over network
- DeepSORT / ReID / appearance tracking
- AR perspective transforms for HP bars
- Type effectiveness system
- Stamina / energy
- Combos or gesture chains
- Spectator mode
- Calibration screen
- Character selection
- Custom models / ML training
- Backend of any kind
- Mobile responsiveness

If it is not in section 7, do not build it.

## 10. Build Order

1. Vite + React + TS + Tailwind scaffold.
2. Webcam -> video element.
3. MediaPipe PoseLandmarker init + draw skeleton on canvas.
4. Split-screen assignment -> log "P1 detected" / "P2 detected".
5. Zustand store with two Players, HP, phase.
6. Gesture detection for FIRE only. Log fires.
7. Move resolution + damage. Test with two people.
8. Add TACKLE, HEAL, BLOCK.
9. HP bar rendering.
10. Floating text + SFX.
11. Win condition + restart.
12. Polish pass.
13. Deploy to Vercel.

## 11. Definition of Done

- [ ] Two people detected reliably from a single webcam
- [ ] Left/right split assigns P1/P2 correctly
- [ ] All 4 gestures fire their moves with < 500ms perceived latency
- [ ] HP bars deplete and reach 0
- [ ] Win screen shows correct winner
- [ ] Restart works without page reload
- [ ] Deployed to a public URL
- [ ] Works in Chrome on a laptop

## 12. Notes for the Agent

- Do not add features from section 9 for polish. Ship the spec.
- If something is ambiguous, pick the simpler interpretation.
- Prefer inline code over abstractions.
- Use requestAnimationFrame for the game loop; do not use setInterval.
- Every frame: infer pose -> assign players -> check gestures -> resolve -> render.
'@

Set-Content -Path "C:\Users\User\OneDrive\Documents\anti\SPEC.md" -Value $spec -Encoding UTF8

Get-Item "C:\Users\User\OneDrive\Documents\anti\SPEC.md" | Select-Object Name, Length