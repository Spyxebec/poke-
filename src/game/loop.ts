import { detectGesture, detectPeaceSign } from '../vision/gestures'
import { latestHandResult } from '../vision/hands'
import { MOVES } from './moves'
import { useGameStore } from './state'
import type { MoveId, Phase, Particle, Player, ConfettiPiece } from './state'
import { playSfx } from './audio'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { LandmarkPoint } from '../vision/gestures'

export interface PlayerLike {
  playerId: 1 | 2
  landmarks: NormalizedLandmark[] | LandmarkPoint[]
}

export interface PlayerGestureTracker {
  activeGesture: MoveId | null
  handIndex: 15 | 16 | null
  gestureStartedAt: number | null
  hasFired: boolean
}

export interface Projectile {
  id: string
  fromPlayer: 1 | 2
  moveId: MoveId
  startX: number
  startY: number
  endX: number
  endY: number
  bornAt: number
  durationMs: number
  isLowStamina?: boolean
}

export interface LastFireInfo {
  move: MoveId
  timestamp: number
}

/**
 * Per-player gesture tracker state.
 */
export const gestureTrackers: Record<1 | 2, PlayerGestureTracker> = {
  1: {
    activeGesture: null,
    handIndex: null,
    gestureStartedAt: null,
    hasFired: false,
  },
  2: {
    activeGesture: null,
    handIndex: null,
    gestureStartedAt: null,
    hasFired: false,
  },
}

/**
 * Charging state (peace sign gesture)
 */
export const chargingSince: Record<1 | 2, number> = {
  1: 0,
  2: 0,
}

export const chargingUntil: Record<1 | 2, number> = {
  1: 0,
  2: 0,
}

export const hasShownChargingText: Record<1 | 2, boolean> = {
  1: false,
  2: false,
}

let lastStaminaUpdateAt = 0

/**
 * Information when each player last fired a move (for top-corner flash).
 */
export const lastFireAt: Record<1 | 2, LastFireInfo | null> = {
  1: null,
  2: null,
}

/**
 * Active projectiles / visual effects flying or casting.
 */
export let projectiles: Projectile[] = []

/**
 * Reset all gesture tracking, projectiles, and flash state.
 */
export function resetGestureTracking(): void {
  gestureTrackers[1] = {
    activeGesture: null,
    handIndex: null,
    gestureStartedAt: null,
    hasFired: false,
  }
  gestureTrackers[2] = {
    activeGesture: null,
    handIndex: null,
    gestureStartedAt: null,
    hasFired: false,
  }
  lastFireAt[1] = null
  lastFireAt[2] = null
  projectiles.length = 0
  chargingSince[1] = 0
  chargingSince[2] = 0
  chargingUntil[1] = 0
  chargingUntil[2] = 0
  hasShownChargingText[1] = false
  hasShownChargingText[2] = false
  lastStaminaUpdateAt = 0
}

// Reset gesture tracking and projectiles on restart
useGameStore.subscribe((state, prevState) => {
  if (state.phase === 'BATTLE' && prevState.phase === 'GAME_OVER') {
    resetGestureTracking()
  }
})

declare global {
  interface Window {
    __lastFrameMs?: number
  }
}

let measurementFrameCount = 0

/**
 * Game loop step for gesture detection, projectile impacts, move effects, and cooldowns.
 *
 * STEP C:
 * - On impact (t >= 1):
 *     FIRE / TACKLE:
 *       if target.blockUntil > now: no damage, clear target.blockUntil
 *       else: applyDamage(targetId, move.damage)
 *     BLOCK:
 *       setBlock(firingPlayerId, 1000). No opponent damage.
 *     HEAL:
 *       heal(firingPlayerId, 10). No opponent damage.
 *     Set firing player cooldownUntil = now + move.cooldownMs
 *     checkWin()
 *     Remove projectile
 */
export function gameLoop(
  players: PlayerLike[],
  timestampMs: number = performance.now()
): void {
  const frameStart = performance.now()
  try {
    const store = useGameStore.getState()

    // STEP D: Loop guard — only run game logic during BATTLE
    if (store.phase !== 'BATTLE') {
      return
    }

  const now = Date.now()

  // ── TRAINING: Dummy regen (5 HP/sec, stops at death) ──
  if (store.mode === 'TRAINING' && store.dummy.hp > 0) {
    const dtSec = 1 / 60 // approximate frame time
    const newDummyHp = Math.min(store.dummy.maxHp, store.dummy.hp + 5 * dtSec)
    store.setDummyHp(newDummyHp)
  }

  // ── STEP C: Projectile Impact & Effect Resolution ──
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    if (now - p.bornAt >= p.durationMs) {
      const move = MOVES[p.moveId]
      const targetId: 1 | 2 = p.fromPlayer === 1 ? 2 : 1
      const target = store.players[targetId - 1]

      if (p.moveId === 'FIRE' || p.moveId === 'TACKLE') {
        // ── TRAINING: Damage dummy instead of opponent ──
        if (store.mode === 'TRAINING') {
          if (p.fromPlayer === 1) {
            const newDummyHp = Math.max(0, store.dummy.hp - move.damage)
            store.setDummyHp(newDummyHp)
            playSfx('hit')

            // Particle burst at dummy position
            const dummyX = store.dummy.anchorX
            const dummyY = store.dummy.anchorY
            const burstParticles: Particle[] = []
            for (let pi = 0; pi < 8; pi++) {
              const angle = (Math.PI * 2 * pi) / 8 + Math.random() * 0.3
              const speed = 0.5 + Math.random() * 0.5
              burstParticles.push({
                x: dummyX,
                y: dummyY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                bornAt: now,
                lifeMs: 500,
                color: '#ef4444',
              })
            }
            store.addParticles(burstParticles)

            store.addFloatingText({
              text: `-${move.damage}`,
              x: dummyX,
              y: dummyY,
              bornAt: now,
              color: '#ef4444',
              fontSize: 28,
              durationMs: 900,
              driftPx: 30,
            })

            // Screen shake
            useGameStore.setState({
              shakeUntil: { ...store.shakeUntil, 1: now + 120 },
              hitstopUntil: now + 70,
            })

            // If dummy dead: trigger GAME_OVER
            if (newDummyHp <= 0 && store.phase === 'BATTLE') {
              console.log('[ko] dummy died, koStartedAt =', now)
              playSfx('win')
              const colors = ['#ef4444','#22c55e','#eab308','#3b82f6','#a855f7','#f97316']
              const confetti: ConfettiPiece[] = []
              for (let ci = 0; ci < 60; ci++) {
                confetti.push({
                  x: Math.random(),
                  y: -0.1,
                  vy: 0.3 + Math.random() * 0.4,
                  vx: (Math.random() - 0.5) * 0.2,
                  rotation: Math.random() * Math.PI * 2,
                  spin: (Math.random() - 0.5) * 4,
                  color: colors[Math.floor(Math.random() * colors.length)],
                  width: 8,
                  height: 14,
                  bornAt: now,
                })
              }
              setTimeout(() => {
                useGameStore.setState({ showWinOverlay: true })
              }, 600)
              useGameStore.setState({
                phase: 'GAME_OVER',
                winner: 1,
                confetti,
                koStartedAt: now,
                koFlashUntil: now + 400,
                showWinOverlay: false,
              })
            }
          }
          // Player 2 does not exist in training — ignore
        } else {
        // ── BATTLE mode: normal opponent damage ──
        if (target && target.blockUntil > now) {
          // Block consumed: no damage, clear target block
          store.setBlock(targetId, 0)
          console.log(`[Battle] P${targetId} blocked ${p.moveId} from P${p.fromPlayer}!`)
        } else {
          store.applyDamage(targetId, move.damage)
          playSfx('hit')

          // STEP B: On damage applied, push floating text at TARGET's shoulder midpoint
          const targetPlayer = players.find((pl) => pl.playerId === targetId)
          const tLm = targetPlayer?.landmarks
          const targetShoulderMidX =
            tLm && tLm[11] && tLm[12]
              ? (tLm[11].x + tLm[12].x) / 2
              : targetId === 1
                ? 0.35
                : 0.65
          const targetShoulderMidY =
            tLm && tLm[11] && tLm[12]
              ? (tLm[11].y + tLm[12].y) / 2
              : 0.40

          // FEATURE 2: Particle burst on hit
          const burstParticles: Particle[] = []
          for (let pi = 0; pi < 8; pi++) {
            const angle = (Math.PI * 2 * pi) / 8 + Math.random() * 0.3
            const speed = 0.5 + Math.random() * 0.5
            burstParticles.push({
              x: targetShoulderMidX,
              y: targetShoulderMidY,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              bornAt: now,
              lifeMs: 500,
              color: '#ef4444',
            })
          }
          store.addParticles(burstParticles)

          store.addFloatingText({
            text: `-${move.damage}`,
            x: targetShoulderMidX,
            y: targetShoulderMidY,
            bornAt: now,
            color: '#ef4444',
            fontSize: 28,
            durationMs: 900,
            driftPx: 30,
          })
        }
        } // end BATTLE else
      } else if (p.moveId === 'BLOCK') {
        // Sets blockUntil = now + 1000 on self. No opponent damage.
        store.setBlock(p.fromPlayer, 1000)
      } else if (p.moveId === 'HEAL') {
        // Heals self 10 HP. No opponent damage.
        store.heal(p.fromPlayer, 10)
      }

      // Set firing player's cooldownUntil = now + move.cooldownMs
      store.setCooldown(p.fromPlayer, move.cooldownMs)

      // Call checkWin() (skipped in TRAINING by checkWin itself)
      store.checkWin()

      // Remove projectile
      projectiles.splice(i, 1)
    }
  }

  // ── Gesture Detection & Firing Check ──
  const presentIds = new Set<1 | 2>()

  for (const player of players) {
    const id = player.playerId

    // STEP 5: Skip Player 2 gesture detection in training
    if (store.mode === 'TRAINING' && id === 2) continue

    presentIds.add(id)

    // ── CHARGE: Peace sign hand detection ──
    let chargingInputActive = false

    // Step D: Guard against missing hands / pose landmarks
    // If a hand is visible but pose landmarks for that player are missing, ignore hand
    const hasValidPose = Boolean(player.landmarks && player.landmarks.length >= 33)
    if (hasValidPose && latestHandResult?.landmarks && latestHandResult.landmarks.length > 0) {
      for (const hand of latestHandResult.landmarks) {
        if (!hand || hand.length < 21) continue
        const wrist = hand[0]
        if (!wrist) continue
        // Wrist position: wrist.x < 0.5 -> P1, else P2
        const handPlayerId: 1 | 2 = wrist.x < 0.5 ? 1 : 2
        if (handPlayerId === id) {
          if (detectPeaceSign(hand)) {
            chargingInputActive = true
            break
          }
        }
      }
    }

    if (chargingInputActive) {
      if (chargingSince[id] === 0) {
        chargingSince[id] = now
      }

      const elapsed = now - chargingSince[id]
      // Max 5 seconds of charge per activation (1000ms delay + 5000ms charge = 6000ms total)
      if (elapsed >= 1000 && elapsed <= 6000) {
        chargingUntil[id] = now + 100

        if (!hasShownChargingText[id]) {
          hasShownChargingText[id] = true
          const lm = player.landmarks
          const shoulder11 = lm[11]
          const shoulder12 = lm[12]
          const chestX =
            shoulder11 && shoulder12
              ? (shoulder11.x + shoulder12.x) / 2
              : id === 1
                ? 0.35
                : 0.65
          const chestY =
            shoulder11 && shoulder12
              ? (shoulder11.y + shoulder12.y) / 2
              : 0.4

          store.addFloatingText({
            text: `P${id} CHARGING!`,
            x: chestX,
            y: chestY - 0.10,
            bornAt: now,
            color: '#eab308',
            fontSize: 24,
            durationMs: 1200,
            driftPx: 40,
          })
        }
      } else if (elapsed > 6000) {
        chargingUntil[id] = 0
      }
    } else {
      chargingSince[id] = 0
      chargingUntil[id] = 0
      hasShownChargingText[id] = false
    }

    const isCharging = now < chargingUntil[id]

    // Stamina regen: 20/sec while charging, base 3/sec
    const dt =
      lastStaminaUpdateAt === 0
        ? 16
        : Math.min(100, Math.max(0, now - lastStaminaUpdateAt))
    const currentStamina = store.players[id - 1]?.stamina ?? 100
    const regenRate = isCharging ? 20 : 3
    const newStamina = Math.min(100, currentStamina + (regenRate * dt) / 1000)
    if (newStamina !== currentStamina) {
      useGameStore.setState((state) => ({
        players: state.players.map((p) =>
          p.id === id ? { ...p, stamina: newStamina } : p
        ) as [Player, Player],
      }))
    }

    // Aura VFX (particles rising from chest)
    if (isCharging) {
      const lm = player.landmarks
      const shoulder11 = lm[11]
      const shoulder12 = lm[12]
      const chestX =
        shoulder11 && shoulder12
          ? (shoulder11.x + shoulder12.x) / 2
          : id === 1
            ? 0.35
            : 0.65
      const chestY =
        shoulder11 && shoulder12
          ? (shoulder11.y + shoulder12.y) / 2
          : 0.4

      store.addParticles([
        {
          x: chestX + (Math.random() - 0.5) * 0.15,
          y: chestY + 0.05 + (Math.random() - 0.5) * 0.15,
          vx: (Math.random() - 0.5) * 0.1,
          vy: -0.4 - Math.random() * 0.2,
          bornAt: now,
          lifeMs: 400,
          color: '#fbbf24',
        },
      ])

      // Cannot fire other moves while charging
      const tracker = gestureTrackers[id]
      tracker.activeGesture = null
      tracker.handIndex = null
      tracker.gestureStartedAt = null
      tracker.hasFired = false
      continue
    }

    const tracker = gestureTrackers[id]
    const detected = detectGesture(player.landmarks, id)

    const gestureChanged =
      detected?.move !== tracker.activeGesture ||
      (detected?.handIndex !== undefined && detected.handIndex !== tracker.handIndex)

    if (gestureChanged) {
      tracker.activeGesture = detected?.move ?? null
      tracker.handIndex = detected?.handIndex ?? null
      tracker.gestureStartedAt = detected !== null ? timestampMs : null
      tracker.hasFired = false
    } else if (detected !== null && !tracker.hasFired) {
      // Cooldown check from store
      const storePlayer = store.players[id - 1]
      const cooldownUntil = storePlayer?.cooldownUntil ?? 0

      if (now < cooldownUntil) {
        continue
      }

      // If player already has an in-flight projectile, wait until impact
      const hasProjectileInFlight = projectiles.some((p) => p.fromPlayer === id)
      if (hasProjectileInFlight) {
        continue
      }

      // Continuous 300ms hold required
      if (
        tracker.gestureStartedAt !== null &&
        timestampMs - tracker.gestureStartedAt >= 300
      ) {
        const moveId = detected.move
        const move = MOVES[moveId]
        const currentStamina = storePlayer?.stamina ?? 100

        // Stamina check: fails silently + shows "NO STAMINA" floating text if stamina < move.staminaCost
        if (currentStamina < move.staminaCost) {
          tracker.hasFired = true
          const lm = player.landmarks
          const shoulder11 = lm[11]
          const shoulder12 = lm[12]
          const chestX =
            shoulder11 && shoulder12
              ? (shoulder11.x + shoulder12.x) / 2
              : id === 1
                ? 0.35
                : 0.65
          const chestY =
            shoulder11 && shoulder12
              ? (shoulder11.y + shoulder12.y) / 2
              : 0.4

          store.addFloatingText({
            text: 'NO STAMINA',
            x: chestX,
            y: chestY - 0.1,
            bornAt: now,
            color: '#ef4444',
            fontSize: 20,
            durationMs: 800,
            driftPx: 30,
          })
          continue
        }

        // Deduct stamina cost BEFORE projectile spawns
        const newPlayerStamina = Math.max(0, currentStamina - move.staminaCost)
        useGameStore.setState((state) => ({
          players: state.players.map((p) =>
            p.id === id ? { ...p, stamina: newPlayerStamina } : p
          ) as [Player, Player],
        }))

        // Soft cost for firing FIRE while stamina is between 20 and 40:
        // do NOT block, but projectile speed is reduced by 20% and trail is thinner
        const isLowStamina =
          moveId === 'FIRE' && currentStamina >= 20 && currentStamina <= 40
        const fireDurationMs = isLowStamina ? 625 : 500

        const moveName = MOVES[moveId].name.toUpperCase()
        console.log(`P${id} used ${moveId}!`)
        playSfx(move.id.toLowerCase() as any)

        tracker.hasFired = true
        lastFireAt[id] = { move: moveId, timestamp: now }

        // Update lastGesture for training panel feedback
        console.log('[loop] moveName about to be used:', moveName)
        useGameStore.setState((state) => ({
          lastGesture: { ...state.lastGesture, [id]: moveName },
        }))

        const lm = player.landmarks
        const shoulder11 = lm[11]
        const shoulder12 = lm[12]
        const chestX = shoulder11 && shoulder12 ? (shoulder11.x + shoulder12.x) / 2 : 0.5
        const chestY = shoulder11 && shoulder12 ? (shoulder11.y + shoulder12.y) / 2 : 0.4

        // STEP A: On move fire, push floating text at shoulder midpoint - 0.10
        store.addFloatingText({
          text: `P${id} used ${moveName}!`,
          x: chestX,
          y: chestY - 0.10,
          bornAt: now,
          color: '#ffffff',
          fontSize: 24,
          durationMs: 1200,
          driftPx: 40,
        })

        const opponentId: 1 | 2 = id === 1 ? 2 : 1
        const opponent = players.find((p) => p.playerId === opponentId)

        if (moveId === 'FIRE') {
          const firingWrist = detected.handIndex ? lm[detected.handIndex] : lm[15]

          // In training mode, target the dummy
          if (store.mode === 'TRAINING' && id === 1 && firingWrist) {
            projectiles.push({
              id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
              fromPlayer: id,
              moveId: 'FIRE',
              startX: firingWrist.x,
              startY: firingWrist.y,
              endX: store.dummy.anchorX,
              endY: store.dummy.anchorY,
              bornAt: now,
              durationMs: fireDurationMs,
              isLowStamina,
            })
          } else if (
            opponent &&
            opponent.landmarks[11] &&
            opponent.landmarks[12] &&
            firingWrist
          ) {
            const opp11 = opponent.landmarks[11]
            const opp12 = opponent.landmarks[12]
            projectiles.push({
              id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
              fromPlayer: id,
              moveId: 'FIRE',
              startX: firingWrist.x,
              startY: firingWrist.y,
              endX: (opp11.x + opp12.x) / 2,
              endY: (opp11.y + opp12.y) / 2,
              bornAt: now,
              durationMs: fireDurationMs,
              isLowStamina,
            })
          } else {
            // No opponent detected: set cooldown on fire so player doesn't spam
            store.setCooldown(id, MOVES.FIRE.cooldownMs)
          }
        } else if (moveId === 'TACKLE') {
          // In training mode, target the dummy
          if (store.mode === 'TRAINING' && id === 1) {
            projectiles.push({
              id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
              fromPlayer: id,
              moveId: 'TACKLE',
              startX: chestX,
              startY: chestY,
              endX: store.dummy.anchorX,
              endY: store.dummy.anchorY,
              bornAt: now,
              durationMs: 300,
            })
          } else if (opponent && opponent.landmarks[11] && opponent.landmarks[12]) {
            const opp11 = opponent.landmarks[11]
            const opp12 = opponent.landmarks[12]
            projectiles.push({
              id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
              fromPlayer: id,
              moveId: 'TACKLE',
              startX: chestX,
              startY: chestY,
              endX: (opp11.x + opp12.x) / 2,
              endY: (opp11.y + opp12.y) / 2,
              bornAt: now,
              durationMs: 300, // faster (300ms)
            })
          } else {
            store.setCooldown(id, MOVES.TACKLE.cooldownMs)
          }
        } else if (moveId === 'BLOCK') {
          // Self-cast expanding blue ring at chest (400ms)
          projectiles.push({
            id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
            fromPlayer: id,
            moveId: 'BLOCK',
            startX: chestX,
            startY: chestY + 0.05,
            endX: chestX,
            endY: chestY + 0.05,
            bornAt: now,
            durationMs: 400,
          })
        } else if (moveId === 'HEAL') {
          // Self-cast green plus rising above head (600ms)
          projectiles.push({
            id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
            fromPlayer: id,
            moveId: 'HEAL',
            startX: chestX,
            startY: chestY - 0.05,
            endX: chestX,
            endY: chestY - 0.20,
            bornAt: now,
            durationMs: 600,
          })
        }
      }
    }
  }

  lastStaminaUpdateAt = now

  // Reset tracking if an assigned player is absent
  for (const id of [1, 2] as const) {
    if (!presentIds.has(id)) {
      const tracker = gestureTrackers[id]
      if (tracker.activeGesture !== null) {
        tracker.activeGesture = null
        tracker.handIndex = null
        tracker.gestureStartedAt = null
        tracker.hasFired = false
      }
      chargingSince[id] = 0
      chargingUntil[id] = 0
      hasShownChargingText[id] = false
    }
  }
  } finally {
    window.__lastFrameMs = performance.now() - frameStart
    measurementFrameCount++
    if (measurementFrameCount % 120 === 0) {
      console.log('frame time:', window.__lastFrameMs.toFixed(1), 'ms')
    }
  }
}

export const stepGameLoop = gameLoop
