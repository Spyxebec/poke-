import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { MoveId } from '../game/state'

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
const LEFT_HIP = 23
const RIGHT_HIP = 24

export interface DetectedGesture {
  move: MoveId
  handIndex?: 15 | 16
}

/**
 * Detects gestures from pose landmarks following SPEC §8 priority:
 * Priority: BLOCK > HEAL > FIRE > TACKLE.
 *
 * Y increases downward; "above" = smaller Y.
 * shoulderMidX = (lm[11].x + lm[12].x) / 2
 * shoulderMidY = (lm[11].y + lm[12].y) / 2
 * hipMidY      = (lm[23].y + lm[24].y) / 2
 *
 * FIRE rule enforces directionality toward the opponent:
 * - For playerId === 1 (left side): arm extended to the RIGHT (wrist.x > shoulderMidX + 0.20)
 * - For playerId === 2 (right side): arm extended to the LEFT (wrist.x < shoulderMidX - 0.20)
 */
export function detectGesture(
  landmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null,
  playerId: 1 | 2
): DetectedGesture | null {
  if (!landmarks || landmarks.length <= RIGHT_HIP) {
    return null
  }

  const leftShoulder = landmarks[LEFT_SHOULDER]
  const rightShoulder = landmarks[RIGHT_SHOULDER]
  const leftWrist = landmarks[LEFT_WRIST]
  const rightWrist = landmarks[RIGHT_WRIST]
  const leftHip = landmarks[LEFT_HIP]
  const rightHip = landmarks[RIGHT_HIP]

  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftWrist ||
    !rightWrist ||
    !leftHip ||
    !rightHip
  ) {
    return null
  }

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2
  const hipMidY = (leftHip.y + rightHip.y) / 2

  // ──────────────────────────────────────────
  // 1. BLOCK (Priority 1: arms crossed at chest)
  // |lm[15].x - lm[16].x| < 0.10
  // |lm[15].y - lm[16].y| < 0.10
  // lm[15].y > shoulderMidY AND lm[15].y < hipMidY
  // lm[16].y > shoulderMidY AND lm[16].y < hipMidY
  // ──────────────────────────────────────────
  const blockDiffX = Math.abs(leftWrist.x - rightWrist.x) < 0.10
  const blockDiffY = Math.abs(leftWrist.y - rightWrist.y) < 0.10
  const leftInChest = leftWrist.y > shoulderMidY && leftWrist.y < hipMidY
  const rightInChest = rightWrist.y > shoulderMidY && rightWrist.y < hipMidY

  if (blockDiffX && blockDiffY && leftInChest && rightInChest) {
    return { move: 'BLOCK' }
  }

  // ──────────────────────────────────────────
  // 2. HEAL (Priority 2: one hand up, one down)
  // (lm[15].y < lm[11].y - 0.15) XOR (lm[16].y < lm[12].y - 0.15)
  // AND the other wrist below hipMidY
  // ──────────────────────────────────────────
  const leftUp = leftWrist.y < leftShoulder.y - 0.15
  const rightUp = rightWrist.y < rightShoulder.y - 0.15
  const oneUp = (leftUp && !rightUp) || (!leftUp && rightUp)

  if (oneUp) {
    const otherBelowHip = leftUp ? rightWrist.y > hipMidY : leftWrist.y > hipMidY
    if (otherBelowHip) {
      return { move: 'HEAL' }
    }
  }

  // ──────────────────────────────────────────
  // 3. FIRE (Priority 3: finger gun directed toward opponent)
  // For playerId === 1: arm extended to the RIGHT
  //   wrist.x > shoulderMidX + 0.20
  //   |wrist.y - shoulderMidY| < 0.15
  // For playerId === 2: arm extended to the LEFT
  //   wrist.x < shoulderMidX - 0.20
  //   |wrist.y - shoulderMidY| < 0.15
  // ──────────────────────────────────────────
  let leftFire = false
  let rightFire = false

  if (playerId === 1) {
    leftFire =
      leftWrist.x > shoulderMidX + 0.20 &&
      Math.abs(leftWrist.y - shoulderMidY) < 0.15
    rightFire =
      rightWrist.x > shoulderMidX + 0.20 &&
      Math.abs(rightWrist.y - shoulderMidY) < 0.15
  } else {
    leftFire =
      leftWrist.x < shoulderMidX - 0.20 &&
      Math.abs(leftWrist.y - shoulderMidY) < 0.15
    rightFire =
      rightWrist.x < shoulderMidX - 0.20 &&
      Math.abs(rightWrist.y - shoulderMidY) < 0.15
  }

  if (leftFire && rightFire) {
    const handIndex =
      playerId === 1
        ? leftWrist.x >= rightWrist.x
          ? 15
          : 16
        : leftWrist.x <= rightWrist.x
          ? 15
          : 16
    return { move: 'FIRE', handIndex }
  }
  if (leftFire) {
    return { move: 'FIRE', handIndex: 15 }
  }
  if (rightFire) {
    return { move: 'FIRE', handIndex: 16 }
  }

  // ──────────────────────────────────────────
  // 4. TACKLE (Priority 4: both fists pulled in at chest)
  // lm[15].y > shoulderMidY AND lm[15].y < hipMidY
  // lm[16].y > shoulderMidY AND lm[16].y < hipMidY
  // |lm[15].x - shoulderMidX| < 0.20
  // |lm[16].x - shoulderMidX| < 0.20
  // ──────────────────────────────────────────
  const leftTackleX = Math.abs(leftWrist.x - shoulderMidX) < 0.20
  const rightTackleX = Math.abs(rightWrist.x - shoulderMidX) < 0.20

  if (leftInChest && rightInChest && leftTackleX && rightTackleX) {
    return { move: 'TACKLE' }
  }

  return null
}

/**
 * Detects if hand landmarks form a peace sign (V-sign).
 *
 * HandLandmarker gives 21 landmarks per hand:
 *  0  = wrist
 *  6  = index PIP,  8  = index tip
 *  10 = middle PIP, 12 = middle tip
 *  14 = ring PIP,   16 = ring tip
 *  18 = pinky PIP,  20 = pinky tip
 *
 * Y increases downward. A finger is "up" when its TIP is above its PIP.
 * A finger is UP only if lm[tip].y < lm[pip].y - 0.02
 * A finger is DOWN only if lm[tip].y > lm[pip].y + 0.02
 */
export function detectPeaceSign(
  handLandmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null
): boolean {
  try {
    if (!handLandmarks || handLandmarks.length < 21) {
      return false
    }

    const indexTip = handLandmarks[8]
    const indexPip = handLandmarks[6]
    const middleTip = handLandmarks[12]
    const middlePip = handLandmarks[10]
    const ringTip = handLandmarks[16]
    const ringPip = handLandmarks[14]
    const pinkyTip = handLandmarks[20]
    const pinkyPip = handLandmarks[18]

    if (
      !indexTip || !indexPip ||
      !middleTip || !middlePip ||
      !ringTip || !ringPip ||
      !pinkyTip || !pinkyPip
    ) {
      return false
    }

    const indexUp = indexTip.y < indexPip.y - 0.02
    const middleUp = middleTip.y < middlePip.y - 0.02
    const ringUp = ringTip.y < ringPip.y - 0.02
    const ringDown = ringTip.y > ringPip.y + 0.02
    const pinkyUp = pinkyTip.y < pinkyPip.y - 0.02
    const pinkyDown = pinkyTip.y > pinkyPip.y + 0.02

    return indexUp && middleUp && !ringUp && !pinkyUp && ringDown && pinkyDown
  } catch {
    return false
  }
}

