import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { MoveId } from '../game/state'

export interface LandmarkPoint {
  x: number
  y: number
  z?: number
  visibility?: number
}

export const FIST_NOT_UP_THRESHOLD = 0.02
export const FIST_MAX_DIST_TO_WRIST = 0.20

export const FINGER_GUN_INDEX_UP_THRESHOLD = 0.02
export const FINGER_GUN_INDEX_MIN_DIST = 0.15
export const FINGER_GUN_CURL_NOT_UP_THRESHOLD = 0.02
export const FINGER_GUN_CURL_MAX_DIST = 0.20

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
 * Detects gestures following SPEC §8 priority:
 * Priority: BLOCK > HEAL > FIRE > PUNCH.
 *
 * Y increases downward; "above" = smaller Y.
 * shoulderMidX = (lm[11].x + lm[12].x) / 2
 * shoulderMidY = (lm[11].y + lm[12].y) / 2
 * hipMidY      = (lm[23].y + lm[24].y) / 2
 */
export function detectGesture(
  landmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null,
  playerId: 1 | 2,
  handLandmarks?: NormalizedLandmark[] | LandmarkPoint[] | null,
  targetX?: number
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
  // 3. FIRE & 4. PUNCH (require handLandmarks + armExtended)
  // ──────────────────────────────────────────
  if (handLandmarks) {
    const effTargetX = targetX ?? (playerId === 1 ? 0.65 : 0.35)
    const pointingRight = effTargetX > shoulderMidX

    const inRange = (x: number, y: number) =>
      (pointingRight ? x > shoulderMidX + 0.15 : x < shoulderMidX - 0.15) &&
      y > shoulderMidY - 0.10 &&
      y < shoulderMidY + 0.20

    const leftExt = inRange(leftWrist.x, leftWrist.y)
    const rightExt = inRange(rightWrist.x, rightWrist.y)
    const armExt = leftExt || rightExt

    if (armExt) {
      if (detectFingerGun(handLandmarks)) {
        const handIndex: 15 | 16 = rightExt && !leftExt ? 16 : 15
        return { move: 'FIRE', handIndex }
      }
      if (detectFist(handLandmarks)) {
        return { move: 'PUNCH' }
      }
    }
  }

  return null
}

/**
 * Detects if hand landmarks form an open palm (all fingers extended).
 */
export function isOpenPalm(
  handLandmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null
): boolean {
  if (!handLandmarks || handLandmarks.length < 21) return false
  const isExtended = (tipIdx: number, pipIdx: number) => {
    const tip = handLandmarks[tipIdx]
    const pip = handLandmarks[pipIdx]
    if (!tip || !pip) return false
    return tip.y < pip.y - 0.02
  }
  return isExtended(8, 6) && isExtended(12, 10) && isExtended(16, 14) && isExtended(20, 18)
}

/**
 * Detects if hand landmarks form a finger-gun (index extended, middle/ring/pinky curled).
 *
 * HandLandmarker 21 landmarks:
 *  0=wrist, 5=index MCP,  6=index PIP,  8=index tip
 *  9=middle MCP, 10=middle PIP, 12=middle tip
 * 13=ring MCP,  14=ring PIP,  16=ring tip
 * 17=pinky MCP, 18=pinky PIP, 20=pinky tip
 */
export function detectFingerGun(
  handLandmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null
): boolean {
  if (!handLandmarks || handLandmarks.length < 21) {
    return false
  }

  const wrist = handLandmarks[0]
  const index = handLandmarks[8]
  const indexPip = handLandmarks[6]
  if (!wrist || !index || !indexPip) return false

  // Index finger must be extended:
  //   tip is above PIP and far from wrist
  const indexUp = index.y < indexPip.y - FINGER_GUN_INDEX_UP_THRESHOLD
  const dxI = index.x - wrist.x
  const dyI = index.y - wrist.y
  const indexDist = Math.sqrt(dxI * dxI + dyI * dyI)
  const indexExtended = indexUp && indexDist > FINGER_GUN_INDEX_MIN_DIST

  // Middle, ring, pinky must be curled
  const curled = (tipIdx: number, mcpIdx: number) => {
    const tip = handLandmarks[tipIdx]
    const mcp = handLandmarks[mcpIdx]
    if (!tip || !mcp) return false
    const notUp = tip.y > mcp.y - FINGER_GUN_CURL_NOT_UP_THRESHOLD
    const dx = tip.x - wrist.x
    const dy = tip.y - wrist.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    return notUp && dist < FINGER_GUN_CURL_MAX_DIST
  }

  return (
    indexExtended &&
    curled(12, 9) && // middle
    curled(16, 13) && // ring
    curled(20, 17) // pinky
  )
}

/**
 * Detects if hand landmarks form a closed fist.
 *
 * HandLandmarker 21 landmarks:
 *  0=wrist, 5=index MCP, 8=index tip
 *  9=middle MCP, 12=middle tip
 * 13=ring MCP, 16=ring tip
 * 17=pinky MCP, 20=pinky tip
 * A finger is "curled" when its tip is NOT above its MCP
 * AND its tip is close to the palm (within FIST_MAX_DIST_TO_WRIST of wrist).
 */
export function detectFist(
  handLandmarks: NormalizedLandmark[] | LandmarkPoint[] | undefined | null
): boolean {
  if (!handLandmarks || handLandmarks.length < 21) {
    return false
  }

  const wrist = handLandmarks[0]
  if (!wrist) return false

  const curled = (tipIdx: number, mcpIdx: number) => {
    const tip = handLandmarks[tipIdx]
    const mcp = handLandmarks[mcpIdx]
    if (!tip || !mcp) return false
    // Not extended above the MCP
    const notUp = tip.y > mcp.y - FIST_NOT_UP_THRESHOLD
    // Close to the palm
    const dx = tip.x - wrist.x
    const dy = tip.y - wrist.y
    const distToWrist = Math.sqrt(dx * dx + dy * dy)
    return notUp && distToWrist < FIST_MAX_DIST_TO_WRIST
  }

  return (
    curled(8, 5) && // index
    curled(12, 9) && // middle
    curled(16, 13) && // ring
    curled(20, 17) // pinky
  )
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

