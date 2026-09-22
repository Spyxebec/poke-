import { useCallback } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { registerResetCallback } from '../game/state'

/** EMA smoothing factor (0.4 = 40% raw, 60% previous smoothed) */
const ALPHA = 0.4

/** Visibility threshold below which a landmark is considered missing */
export const VISIBILITY_THRESHOLD = 0.3

/** Maximum duration (ms) to hold last-seen landmark values when missing/occluded */
export const HOLD_DURATION_MS = 250

export interface LastSeenLandmark {
  x: number
  y: number
  z?: number
  seenAt: number
}

/** Landmark indices for MediaPipe Pose */
const LEFT_HIP = 23
const RIGHT_HIP = 24
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12

export interface PlayerAssignment {
  /** Player ID: 1 (left side) or 2 (right side) */
  playerId: 1 | 2
  /** The landmarks for this player */
  landmarks: NormalizedLandmark[]
  /** Hip midpoint X (0–1, normalized, un-mirrored) */
  hipMidX: number
  /** Shoulder midpoint position (normalized, un-mirrored) — used for label placement */
  shoulderMid: { x: number; y: number }
  /** Stale flag: true when using visual hold (no fresh detection this frame) */
  isStale?: boolean
}

export interface UsePlayerAssignmentResult {
  /**
   * Given raw landmarks from usePose, returns player assignments.
   * Also logs transitions (not every frame).
   */
  assign: (landmarks: NormalizedLandmark[][]) => PlayerAssignment[]
}

// Module-level state for sticky assignment, hysteresis, and visual hold
const lastKnownSide: Record<1 | 2, 'left' | 'right' | null> = { 1: null, 2: null }
const lastSeen: Record<1 | 2, number> = { 1: 0, 2: 0 }
const lostLogged: Record<1 | 2, boolean> = { 1: true, 2: true }
const lastKnownAssignment: Record<1 | 2, PlayerAssignment | null> = { 1: null, 2: null }
const prevSmoothed: Record<1 | 2, NormalizedLandmark[] | null> = { 1: null, 2: null }
const lastSeenLandmarks: Record<1 | 2, (LastSeenLandmark | null)[]> = {
  1: Array.from({ length: 33 }, () => null),
  2: Array.from({ length: 33 }, () => null),
}
let prevAssignedIds: (1 | 2)[] = []

/**
 * Resets sticky player assignment, hysteresis, and visual hold state.
 */
export function resetPlayerAssignment(): void {
  lastKnownSide[1] = null
  lastKnownSide[2] = null
  lastSeen[1] = 0
  lastSeen[2] = 0
  lostLogged[1] = true
  lostLogged[2] = true
  lastKnownAssignment[1] = null
  lastKnownAssignment[2] = null
  prevSmoothed[1] = null
  prevSmoothed[2] = null
  lastSeenLandmarks[1].fill(null)
  lastSeenLandmarks[2].fill(null)
  prevAssignedIds = []
}

registerResetCallback(() => {
  resetPlayerAssignment()
})

function processLandmarks(
  poseLandmarks: NormalizedLandmark[],
  playerId: 1 | 2,
  hipMidX: number,
  now: number,
  isStale: boolean
): PlayerAssignment {
  const lastSeenList = lastSeenLandmarks[playerId]
  const prev = prevSmoothed[playerId]

  const count = Math.max(33, poseLandmarks.length)
  const smoothed: NormalizedLandmark[] = []

  for (let i = 0; i < count; i++) {
    const raw = poseLandmarks[i]
    const isValid =
      raw != null &&
      (raw.visibility === undefined || raw.visibility >= VISIBILITY_THRESHOLD)

    let effective: NormalizedLandmark | undefined

    if (isValid) {
      lastSeenList[i] = {
        x: raw.x,
        y: raw.y,
        z: raw.z,
        seenAt: now,
      }
      effective = raw
    } else {
      const last = lastSeenList[i]
      if (last && (now - last.seenAt) < HOLD_DURATION_MS) {
        effective = {
          x: last.x,
          y: last.y,
          z: last.z ?? 0,
          visibility: 1,
        }
      } else {
        effective = undefined
      }
    }

    if (effective) {
      const prevLm = prev?.[i]
      if (prevLm) {
        const x = ALPHA * effective.x + (1 - ALPHA) * prevLm.x
        const y = ALPHA * effective.y + (1 - ALPHA) * prevLm.y
        smoothed[i] = {
          x,
          y,
          z: effective.z,
          visibility: effective.visibility,
        }
      } else {
        smoothed[i] = {
          x: effective.x,
          y: effective.y,
          z: effective.z,
          visibility: effective.visibility,
        }
      }
    } else {
      smoothed[i] = undefined as any
    }
  }

  prevSmoothed[playerId] = smoothed

  const leftShoulder = smoothed[LEFT_SHOULDER]
  const rightShoulder = smoothed[RIGHT_SHOULDER]
  const shoulderMid = {
    x: leftShoulder && rightShoulder
      ? (leftShoulder.x + rightShoulder.x) / 2
      : hipMidX,
    y: leftShoulder && rightShoulder
      ? (leftShoulder.y + rightShoulder.y) / 2
      : 0.3,
  }

  return { playerId, landmarks: smoothed, hipMidX, shoulderMid, isStale }
}

/**
 * Assigns detected poses to Player 1 or Player 2 with sticky assignment,
 * hysteresis around the center (0.45 .. 0.55), and a 1000ms visual hold
 * before dropping a lost player.
 */
export function usePlayerAssignment(): UsePlayerAssignmentResult {
  const assign = useCallback((landmarks: NormalizedLandmark[][]): PlayerAssignment[] => {
    const now = performance.now()
    const validPoses: { landmarks: NormalizedLandmark[]; hipMidX: number }[] = []

    for (const poseLandmarks of landmarks) {
      const leftHip = poseLandmarks[LEFT_HIP]
      const rightHip = poseLandmarks[RIGHT_HIP]
      if (!leftHip || !rightHip) continue
      const hipMidX = (leftHip.x + rightHip.x) / 2
      validPoses.push({ landmarks: poseLandmarks, hipMidX })
    }

    // Sort poses from left to right
    validPoses.sort((a, b) => a.hipMidX - b.hipMidX)

    const assignedThisFrame = new Set<1 | 2>()
    const assignments: PlayerAssignment[] = []

    if (validPoses.length === 1) {
      const pose = validPoses[0]
      const hipMidX = pose.hipMidX
      let side: 'left' | 'right'

      // Hysteresis band around the center to prevent flipping
      if (hipMidX < 0.45) {
        side = 'left'
      } else if (hipMidX > 0.55) {
        side = 'right'
      } else {
        // Between 0.45 and 0.55: KEEP previous assignment
        if (lastKnownSide[1] === 'left' && lastKnownSide[2] !== 'right') {
          side = 'left'
        } else if (lastKnownSide[2] === 'right' && lastKnownSide[1] !== 'left') {
          side = 'right'
        } else if (lastKnownSide[1] === 'left') {
          side = 'left'
        } else if (lastKnownSide[2] === 'right') {
          side = 'right'
        } else {
          side = hipMidX < 0.5 ? 'left' : 'right'
        }
      }

      // Check last known side for each player:
      // If this pose's side matches a player's lastKnownSide, keep it as that player.
      // Otherwise, assign by current side.
      let playerId: 1 | 2
      if (side === 'left') {
        playerId = 1
        lastKnownSide[1] = 'left'
        lastKnownSide[2] = null
        lastKnownAssignment[2] = null
      } else {
        playerId = 2
        lastKnownSide[2] = 'right'
        lastKnownSide[1] = null
        lastKnownAssignment[1] = null
      }

      lastSeen[playerId] = now
      lostLogged[playerId] = false
      assignedThisFrame.add(playerId)

      const assignment = processLandmarks(pose.landmarks, playerId, hipMidX, now, false)
      assignments.push(assignment)
      lastKnownAssignment[playerId] = assignment
    } else if (validPoses.length >= 2) {
      // Multiple poses detected: left-most to P1, right-most to P2
      const leftPose = validPoses[0]
      const rightPose = validPoses[validPoses.length - 1]

      lastKnownSide[1] = 'left'
      lastSeen[1] = now
      lostLogged[1] = false
      assignedThisFrame.add(1)
      const assignment1 = processLandmarks(leftPose.landmarks, 1, leftPose.hipMidX, now, false)
      assignments.push(assignment1)
      lastKnownAssignment[1] = assignment1

      lastKnownSide[2] = 'right'
      lastSeen[2] = now
      lostLogged[2] = false
      assignedThisFrame.add(2)
      const assignment2 = processLandmarks(rightPose.landmarks, 2, rightPose.hipMidX, now, false)
      assignments.push(assignment2)
      lastKnownAssignment[2] = assignment2
    }

    // Handle visual hold for players not detected this frame
    for (const id of [1, 2] as const) {
      if (!assignedThisFrame.has(id)) {
        if (lastKnownAssignment[id] && (now - lastSeen[id] <= 1000)) {
          // Keep player assigned for up to 1000ms using last-known landmarks
          assignments.push({
            ...lastKnownAssignment[id]!,
            isStale: true,
          })
        } else if (now - lastSeen[id] > 1000) {
          // After 1000ms of no detection, mark as lost
          if (!lostLogged[id] && lastSeen[id] > 0) {
            console.log('[assign] lost player', id)
            lostLogged[id] = true
            lastKnownSide[id] = null
            lastKnownAssignment[id] = null
            prevSmoothed[id] = null
            lastSeenLandmarks[id].fill(null)
          }
        }
      }
    }

    // Sort assignments so P1 comes first, then P2
    assignments.sort((a, b) => a.playerId - b.playerId)

    // Log transitions only
    const currentAssignedIds = assignments.map((a) => a.playerId)
    const hasTransition =
      currentAssignedIds.length !== prevAssignedIds.length ||
      currentAssignedIds.some((id, idx) => id !== prevAssignedIds[idx])

    if (hasTransition) {
      if (currentAssignedIds.length === 0) {
        console.log('[playerAssignment] No players detected')
      } else {
        const labels = assignments.map((a) => `P${a.playerId}`).join(', ')
        console.log(`[playerAssignment] ${assignments.length} pose(s) → ${labels}`)
      }
      prevAssignedIds = currentAssignedIds
    }

    return assignments
  }, [])

  return { assign }
}
