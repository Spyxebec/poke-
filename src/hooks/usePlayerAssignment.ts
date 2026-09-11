import { useRef, useCallback } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

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
 */
export function usePlayerAssignment(): UsePlayerAssignmentResult {
  // Track previous assignments to detect transitions
  // Map from pose-index to assigned playerId
  const prevAssignmentsRef = useRef<Map<number, 1 | 2>>(new Map())
  const prevCountRef = useRef<number>(0)

  const assign = useCallback((landmarks: NormalizedLandmark[][]): PlayerAssignment[] => {
    const assignments: PlayerAssignment[] = []

    for (const poseLandmarks of landmarks) {
      const leftHip = poseLandmarks[LEFT_HIP]
      const rightHip = poseLandmarks[RIGHT_HIP]
      if (!leftHip || !rightHip) continue

      // Hip midpoint in normalized coordinates (0–1)
      const hipMidX = (leftHip.x + rightHip.x) / 2

      // Player assignment: left half → P1, right half → P2
      const playerId: 1 | 2 = hipMidX < 0.5 ? 1 : 2

      // Shoulder midpoint for label placement
      const leftShoulder = poseLandmarks[LEFT_SHOULDER]
      const rightShoulder = poseLandmarks[RIGHT_SHOULDER]
      const shoulderMid = {
        x: leftShoulder && rightShoulder
          ? (leftShoulder.x + rightShoulder.x) / 2
          : hipMidX,
        y: leftShoulder && rightShoulder
          ? (leftShoulder.y + rightShoulder.y) / 2
          : 0.3,
      }

      assignments.push({ playerId, landmarks: poseLandmarks, hipMidX, shoulderMid })
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
