import { useEffect, useRef, useState, useCallback } from 'react'
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

export type { HandLandmarkerResult }

export type HandStatus = 'loading' | 'ready' | 'error'

export const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
export const HAND_MODEL_PATH = '/hand_landmarker.task'

// Module-level state for async detection
export let latestHandResult: HandLandmarkerResult | null = null
export let handDetectionInFlight = false
export function setLatestHandResult(res: HandLandmarkerResult | null) {
  latestHandResult = res
}

/**
 * Detects hand landmarks from video using HandLandmarker.
 * Returns HandLandmarkerResult or null on error.
 */
export function detect(
  handLandmarker: HandLandmarker | null | undefined,
  video: HTMLVideoElement,
  timestamp: number
): HandLandmarkerResult | null {
  if (!handLandmarker || video.readyState < 2) return null
  try {
    return handLandmarker.detectForVideo(video, timestamp)
  } catch {
    return null
  }
}

export interface UseHandsResult {
  status: HandStatus
  error: string | null
  handLandmarker: HandLandmarker | null
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => Promise<HandLandmarkerResult | null>
}

/**
 * Loads the MediaPipe HandLandmarker in parallel with PoseLandmarker on mount.
 */
export function useHands(): UseHandsResult {
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const [status, setStatus] = useState<HandStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const lastTimestampRef = useRef<number>(-1)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN)

        let landmarker: HandLandmarker
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_MODEL_PATH,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        } catch (gpuErr) {
          console.warn('[useHands] GPU delegate failed, falling back to CPU:', gpuErr)
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_MODEL_PATH,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        }

        if (cancelled) {
          landmarker.close()
          return
        }

        landmarkerRef.current = landmarker
        setStatus('ready')
        console.log('[hands] HandLandmarker ready')
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(`Failed to load hand model: ${msg}`)
          setStatus('error')
          console.error('[useHands] Load error:', err)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (landmarkerRef.current) {
        landmarkerRef.current.close()
        landmarkerRef.current = null
      }
    }
  }, [])

  const detectForVideo = useCallback(
    async (video: HTMLVideoElement, timestampMs: number): Promise<HandLandmarkerResult | null> => {
      // Yield to event loop so rAF render loop never blocks
      await new Promise((resolve) => setTimeout(resolve, 0))

      const landmarker = landmarkerRef.current
      if (!landmarker || status !== 'ready') return null
      if (video.readyState < 2) return null

      const now = performance.now()
      const ts = Math.max(timestampMs, now, lastTimestampRef.current + 1)
      if (ts <= lastTimestampRef.current) return null
      lastTimestampRef.current = ts

      const result = detect(landmarker, video, ts)
      latestHandResult = result
      return result
    },
    [status]
  )

  return {
    status,
    error,
    handLandmarker: landmarkerRef.current,
    detectForVideo,
  }
}
