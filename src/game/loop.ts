import { detectGesture } from '../vision/gestures'
import { MOVES } from './moves'
import { useGameStore } from './state'
import type { MoveId } from './state'
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
  projectiles = []
}

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
  const now = Date.now()
  const store = useGameStore.getState()

  // ── STEP C: Projectile Impact & Effect Resolution ──
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    if (now - p.bornAt >= p.durationMs) {
      const move = MOVES[p.moveId]
      const targetId: 1 | 2 = p.fromPlayer === 1 ? 2 : 1
      const target = store.players[targetId - 1]

      if (p.moveId === 'FIRE' || p.moveId === 'TACKLE') {
        if (target && target.blockUntil > now) {
          // Block consumed: no damage, clear target block
          store.setBlock(targetId, 0)
          console.log(`[Battle] P${targetId} blocked ${p.moveId} from P${p.fromPlayer}!`)
        } else {
          store.applyDamage(targetId, move.damage)
        }
      } else if (p.moveId === 'BLOCK') {
        // Sets blockUntil = now + 1000 on self. No opponent damage.
        store.setBlock(p.fromPlayer, 1000)
      } else if (p.moveId === 'HEAL') {
        // Heals self 10 HP. No opponent damage.
        store.heal(p.fromPlayer, 10)
      }

      // Set firing player's cooldownUntil = now + move.cooldownMs
      store.setCooldown(p.fromPlayer, move.cooldownMs)

      // Call checkWin()
      store.checkWin()

      // Remove projectile
      projectiles.splice(i, 1)
    }
  }

  // ── Gesture Detection & Firing Check ──
  const presentIds = new Set<1 | 2>()

  for (const player of players) {
    const id = player.playerId
    presentIds.add(id)

    const tracker = gestureTrackers[id]
    const detected = detectGesture(player.landmarks)

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
        console.log(`P${id} used ${moveId}!`)

        tracker.hasFired = true
        lastFireAt[id] = { move: moveId, timestamp: now }

        const lm = player.landmarks
        const shoulder11 = lm[11]
        const shoulder12 = lm[12]
        const chestX = shoulder11 && shoulder12 ? (shoulder11.x + shoulder12.x) / 2 : 0.5
        const chestY = shoulder11 && shoulder12 ? (shoulder11.y + shoulder12.y) / 2 : 0.4

        const opponentId: 1 | 2 = id === 1 ? 2 : 1
        const opponent = players.find((p) => p.playerId === opponentId)

        if (moveId === 'FIRE') {
          const firingWrist = detected.handIndex ? lm[detected.handIndex] : lm[15]
          if (
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
              durationMs: 500,
            })
          } else {
            // No opponent detected: set cooldown on fire so player doesn't spam
            store.setCooldown(id, MOVES.FIRE.cooldownMs)
          }
        } else if (moveId === 'TACKLE') {
          if (opponent && opponent.landmarks[11] && opponent.landmarks[12]) {
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
    }
  }
}

export const stepGameLoop = gameLoop
