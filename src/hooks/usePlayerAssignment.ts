import { useRef, useCallback } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

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
}

export interface UsePlayerAssignmentResult {
  /**
   * Given raw landmarks from usePose, returns player assignments.
   * Also logs transitions (not every frame).
   */
  assign: (landmarks: NormalizedLandmark[][]) => PlayerAssignment[]
}

/**
 * Assigns detected poses to Player 1 (left half) or Player 2 (right half)
 * based on the hip midpoint X coordinate. Logs transitions only.
 * Applies missing-landmark hold and landmark EMA smoothing per-player before passing to gestures or rendering.
 */
export function usePlayerAssignment(): UsePlayerAssignmentResult {
  // Track previous assignments to detect transitions
  // Map from pose-index to assigned playerId
  const prevAssignmentsRef = useRef<Map<number, 1 | 2>>(new Map())
  const prevCountRef = useRef<number>(0)

  // Per-player previous smoothed landmarks (33 entries)
  const prevSmoothedRef = useRef<Record<1 | 2, NormalizedLandmark[] | null>>({
    1: null,
    2: null,
  })

  // Per-player, per-landmark-index last-seen values (x, y, seenAt)
  const lastSeenLandmarksRef = useRef<Record<1 | 2, (LastSeenLandmark | null)[]>>({
    1: Array.from({ length: 33 }, () => null),
    2: Array.from({ length: 33 }, () => null),
  })

  // Timestamp when each player was last detected (ms)
  const lastSeenRef = useRef<Record<1 | 2, number>>({
    1: 0,
    2: 0,
  })

  const assign = useCallback((landmarks: NormalizedLandmark[][]): PlayerAssignment[] => {
    const now = performance.now()
    const assignments: PlayerAssignment[] = []
    const seenIds = new Set<1 | 2>()

    for (const poseLandmarks of landmarks) {
      const leftHip = poseLandmarks[LEFT_HIP]
      const rightHip = poseLandmarks[RIGHT_HIP]
      if (!leftHip || !rightHip) continue

      // Hip midpoint in normalized coordinates (0–1)
      const hipMidX = (leftHip.x + rightHip.x) / 2

      // Player assignment: left half → P1, right half → P2
      const playerId: 1 | 2 = hipMidX < 0.5 ? 1 : 2

      // Prevent duplicate assignment if multiple poses on same side
      if (seenIds.has(playerId)) continue
      seenIds.add(playerId)

      // Missing-landmark hold + EMA smoothing per player
      const lastSeenList = lastSeenLandmarksRef.current[playerId]
      const prev = prevSmoothedRef.current[playerId]

      const count = Math.max(33, poseLandmarks.length)
      const smoothed: NormalizedLandmark[] = []

      for (let i = 0; i < count; i++) {
        const raw = poseLandmarks[i]
        const isValid =
          raw != null &&
          (raw.visibility === undefined || raw.visibility >= VISIBILITY_THRESHOLD)

        let effective: NormalizedLandmark | undefined

        if (isValid) {
          // When MediaPipe returns a valid landmark: update lastSeen and seenAt
          lastSeenList[i] = {
            x: raw.x,
            y: raw.y,
            z: raw.z,
            seenAt: now,
          }
          effective = raw
        } else {
          // When MediaPipe returns a landmark with visibility < 0.3 OR the landmark is null
          const last = lastSeenList[i]
          if (last && (now - last.seenAt) < HOLD_DURATION_MS) {
            // If (now - seenAt) < 250ms: reuse lastSeen value
            effective = {
              x: last.x,
              y: last.y,
              z: last.z,
              visibility: 1,
            }
          } else {
            // Else: mark as truly missing (do not use in gesture detection)
            effective = undefined
          }
        }

        if (effective) {
          const prevLm = prev?.[i]
          if (prevLm) {
            // Apply EMA: smoothed[i].x = 0.4 * raw[i].x + 0.6 * prevSmoothed[i].x
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
          // Truly missing
          smoothed[i] = undefined as any
        }
      }

      prevSmoothedRef.current[playerId] = smoothed

      lastSeenRef.current[playerId] = now

      // Shoulder midpoint for label placement
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

      assignments.push({ playerId, landmarks: smoothed, hipMidX, shoulderMid })
    }

    // If a player is lost for > 500ms, clear their smoothed buffer and held landmarks so re-entry starts fresh
    for (const id of [1, 2] as const) {
      if (!seenIds.has(id)) {
        if (now - lastSeenRef.current[id] > 500) {
          prevSmoothedRef.current[id] = null
          lastSeenLandmarksRef.current[id].fill(null)
        }
      }
    }

    // Log transitions only
    const currentCount = assignments.length
    const prevCount = prevCountRef.current
    const prevMap = prevAssignmentsRef.current

    let hasTransition = currentCount !== prevCount

    if (!hasTransition) {
      // Check if any assignment changed
      for (let i = 0; i < assignments.length; i++) {
        const prev = prevMap.get(i)
        if (prev !== assignments[i].playerId) {
          hasTransition = true
          break
        }
      }
    }

    if (hasTransition) {
      if (currentCount === 0) {
        console.log('[playerAssignment] No players detected')
      } else {
        const labels = assignments.map(a => `P${a.playerId}`).join(', ')
        console.log(`[playerAssignment] ${currentCount} pose(s) → ${labels}`)
      }
    }

    // Update previous state
    prevCountRef.current = currentCount
    const newMap = new Map<number, 1 | 2>()
    assignments.forEach((a, i) => newMap.set(i, a.playerId))
    prevAssignmentsRef.current = newMap

    return assignments
  }, [])

  return { assign }
}
