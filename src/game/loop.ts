import { detectGesture } from '../vision/gestures'
import { MOVES } from './moves'
import { useGameStore } from './state'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { LandmarkPoint } from '../vision/gestures'

export interface PlayerLike {
  playerId: 1 | 2
  landmarks: NormalizedLandmark[] | LandmarkPoint[]
}

export interface PlayerGestureTracker {
  activeGesture: 'FIRE' | null
  handIndex: 15 | 16 | null
  gestureStartedAt: number | null
  hasFired: boolean
}

export interface Projectile {
  id: string
  fromPlayer: 1 | 2
  startX: number
  startY: number
  endX: number
  endY: number
  bornAt: number
  durationMs: number
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
 * Timestamps when each player last fired FIRE (for top corner flash).
 */
export const lastFireAt: Record<1 | 2, number> = {
  1: 0,
  2: 0,
}

/**
 * Active fireball projectiles flying between players.
 */
export let projectiles: Projectile[] = []

/**
 * Reset all gesture tracking and projectiles.
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
  lastFireAt[1] = 0
  lastFireAt[2] = 0
  projectiles = []
}

/**
 * Game loop step for gesture detection, projectile impacts, damage, and cooldowns.
 *
 * STEP B - Impact resolution:
 *   - Applies damage to opponent when projectile lands
 *   - Checks block (skips damage if blockUntil > now)
 *   - Sets firing player's cooldownUntil = now + MOVES.FIRE.cooldownMs
 *   - Calls checkWin() and prunes projectile
 *
 * STEP C - Fire-time cooldown check:
 *   - Skips fire if now < player.cooldownUntil
 *   - Applies cooldown on impact (or immediately if opponent is absent)
 */
export function gameLoop(
  players: PlayerLike[],
  timestampMs: number = performance.now()
): void {
  const now = Date.now()
  const store = useGameStore.getState()

  // ── STEP B: Projectile Impact & Damage ──
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    if (now - p.bornAt >= p.durationMs) {
      // 1. Determine target player (opponent of fromPlayer)
      const targetId: 1 | 2 = p.fromPlayer === 1 ? 2 : 1
      const target = store.players[targetId - 1]

      // 2. If target.blockUntil > now: skip damage
      if (target && target.blockUntil > now) {
        console.log(`[Battle] P${targetId} blocked FIRE from P${p.fromPlayer}!`)
      } else {
        // 3. Otherwise: applyDamage(targetId, MOVES.FIRE.damage)
        store.applyDamage(targetId, MOVES.FIRE.damage)
      }

      // 4. Set the FIRING player's cooldownUntil = now + MOVES.FIRE.cooldownMs
      store.setCooldown(p.fromPlayer, MOVES.FIRE.cooldownMs)

      // 5. Call checkWin()
      store.checkWin()

      // 6. Remove the projectile from state
      projectiles.splice(i, 1)
    }
  }

  // ── STEP C: Gesture Detection & Firing Check ──
  const presentIds = new Set<1 | 2>()

  for (const player of players) {
    const id = player.playerId
    presentIds.add(id)

    const tracker = gestureTrackers[id]
    const detected = detectGesture(player.landmarks)

    const gestureChanged =
      detected?.move !== tracker.activeGesture ||
      detected?.handIndex !== tracker.handIndex

    if (gestureChanged) {
      tracker.activeGesture = detected?.move ?? null
      tracker.handIndex = detected?.handIndex ?? null
      tracker.gestureStartedAt = detected !== null ? timestampMs : null
      tracker.hasFired = false
    } else if (detected !== null && !tracker.hasFired) {
      // Cooldown check from player state (SPEC §6 & Level 6 STEP C)
      const storePlayer = store.players[id - 1]
      const cooldownUntil = storePlayer?.cooldownUntil ?? 0

      // If now < player.cooldownUntil, skip (do not fire)
      if (now < cooldownUntil) {
        continue
      }

      // If player already has an in-flight projectile, wait until it lands
      const hasProjectileInFlight = projectiles.some((p) => p.fromPlayer === id)
      if (hasProjectileInFlight) {
        continue
      }

      // Require 300ms continuous hold before firing
      if (
        tracker.gestureStartedAt !== null &&
        timestampMs - tracker.gestureStartedAt >= 300
      ) {
        // 1. Log to console
        console.log(`P${id} used FIRE!`)

        // 2. Mark fired in tracker & trigger flash
        tracker.hasFired = true
        lastFireAt[id] = now

        // 3. Opponent check
        const opponentId: 1 | 2 = id === 1 ? 2 : 1
        const opponent = players.find((p) => p.playerId === opponentId)
        const firingWrist = player.landmarks[detected.handIndex]

        if (
          opponent &&
          opponent.landmarks[11] &&
          opponent.landmarks[12] &&
          firingWrist
        ) {
          const opp11 = opponent.landmarks[11]
          const opp12 = opponent.landmarks[12]
          const endX = (opp11.x + opp12.x) / 2
          const endY = (opp11.y + opp12.y) / 2

          projectiles.push({
            id: `proj_${id}_${now}_${Math.random().toString(36).substring(2, 7)}`,
            fromPlayer: id,
            startX: firingWrist.x,
            startY: firingWrist.y,
            endX,
            endY,
            bornAt: now,
            durationMs: 500,
          })
        } else {
          // If opponent not detected (no projectile spawned), set cooldown on fire
          store.setCooldown(id, MOVES.FIRE.cooldownMs)
        }
      }
    }
  }

  // Reset tracking if an assigned player is absent this frame
  for (const id of [1, 2] as const) {
    if (!presentIds.has(id)) {
      const tracker = gestureTrackers[id]
      if (tracker.activeGesture !== null) {
        tracker.activeGesture = null
        tracker.handIndex = null
        tracker.gestureStartedAt = null
        tracker.hasFired = false
      }
    }
  }
}

export const stepGameLoop = gameLoop
