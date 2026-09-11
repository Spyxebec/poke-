import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface LandmarkPoint {
  x: number
  y: number
  z?: number
  visibility?: number
}

const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_WRIST = 15
const RIGHT_WRIST = 16

export interface DetectedGesture {
  move: 'FIRE'
  handIndex: 15 | 16
}

/**
 * Detects if the given pose landmarks match the FIRE gesture (trigger: FINGER GUN, pose-only):
 *
 * SPEC §8 FIRE rule:
 * - One wrist extended horizontally away from the body at shoulder height.
 * - Conditions using pose landmarks:
 *     |wrist.y - shoulder.y| < 0.15          (at shoulder height)
 *     |wrist.x - shoulderMidX| > 0.20        (extended away from body)
 *   where shoulderMidX = (landmarks[11].x + landmarks[12].x) / 2.
 * - Check BOTH wrists. If either matches, gesture fires.
 * - Either arm is fine. Direction does not matter for detection.
 *
 * Returns { move: 'FIRE', handIndex: 15 | 16 } if rule matches, or null otherwise.
 */
export function detectGesture(
  landmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null
): DetectedGesture | null {
  if (!landmarks || landmarks.length <= RIGHT_WRIST) {
    return null
  }

  const leftShoulder = landmarks[LEFT_SHOULDER]
  const rightShoulder = landmarks[RIGHT_SHOULDER]
  const leftWrist = landmarks[LEFT_WRIST]
  const rightWrist = landmarks[RIGHT_WRIST]

  if (!leftShoulder || !rightShoulder || !leftWrist || !rightWrist) {
    return null
  }

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2

  // Left wrist check (landmark 15 against left shoulder 11)
  const leftAtShoulderHeight = Math.abs(leftWrist.y - leftShoulder.y) < 0.15
  const leftExtendedAway = Math.abs(leftWrist.x - shoulderMidX) > 0.20
  const leftMatch = leftAtShoulderHeight && leftExtendedAway

  // Right wrist check (landmark 16 against right shoulder 12)
  const rightAtShoulderHeight = Math.abs(rightWrist.y - rightShoulder.y) < 0.15
  const rightExtendedAway = Math.abs(rightWrist.x - shoulderMidX) > 0.20
  const rightMatch = rightAtShoulderHeight && rightExtendedAway

  if (leftMatch && rightMatch) {
    // If both wrists match, pick the one extended further away from shoulder midpoint
    const leftDist = Math.abs(leftWrist.x - shoulderMidX)
    const rightDist = Math.abs(rightWrist.x - shoulderMidX)
    return {
      move: 'FIRE',
      handIndex: leftDist >= rightDist ? 15 : 16,
    }
  }

  if (leftMatch) {
    return {
      move: 'FIRE',
      handIndex: 15,
    }
  }

  if (rightMatch) {
    return {
      move: 'FIRE',
      handIndex: 16,
    }
  }

  return null
}
