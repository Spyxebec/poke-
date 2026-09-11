import { useEffect, useRef, useState, useCallback } from 'react'
import {
  PoseLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export type PoseStatus = 'loading' | 'ready' | 'error'

export type PoseResult = NormalizedLandmark[][]

// Module-level state for async detection (STEP 1)
export let latestResult: PoseResult | null = null
export let detectionInFlight = false

export interface UsePoseResult {
  /** Current status of the PoseLandmarker model */
  status: PoseStatus
  /** Error message if loading failed */
  error: string | null
  /** Latest detected landmarks — one sub-array per person (0, 1, or 2) */
  landmarks: NormalizedLandmark[][]
  /**
   * Call this in a rAF loop, passing the video element and the current
   * performance.now() timestamp. It runs detectForVideo and updates landmarks.
   */
  detect: (video: HTMLVideoElement, timestampMs: number) => Promise<NormalizedLandmark[][] | undefined>
  /** Run MediaPipe detectForVideo directly */
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => Promise<NormalizedLandmark[][] | undefined>
}

// Heavy model swapped for higher accuracy.
export const MODEL_PATH = '/pose_landmarker_heavy.task'
export const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'

/** Visibility threshold below which a landmark is considered missing */
export const VISIBILITY_THRESHOLD = 0.3

/** Maximum duration (ms) to hold last-seen landmark values when missing/occluded */
export const HOLD_DURATION_MS = 250

/**
 * Loads the MediaPipe PoseLandmarker (full, VIDEO mode, up to 2 poses)
 * and exposes a `detect()` function to run on each frame.
 */
export function usePose(): UsePoseResult {
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const [status, setStatus] = useState<PoseStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[][]>([])

  // Track the last timestamp we sent to detectForVideo so we never
  // pass a duplicate or out-of-order value.
  const lastTimestampRef = useRef<number>(-1)
  const lastCallTimeRef = useRef<number>(0)
  const lastWarnTimeRef = useRef<number>(-10000)

  // Load model once on mount
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN)

        let landmarker: PoseLandmarker
        let delegate: 'GPU' | 'CPU' = 'GPU'

        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/pose_landmarker_heavy.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 2,
            minPoseDetectionConfidence: 0.6,
            minPosePresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
          })
          delegate = 'GPU'
        } catch (gpuErr) {
          console.warn('[usePose] GPU delegate failed, falling back to CPU:', gpuErr)
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/pose_landmarker_heavy.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 2,
            minPoseDetectionConfidence: 0.6,
            minPosePresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
          })
          delegate = 'CPU'
        }

        console.log(`[pose] delegate: ${delegate}`)

        if (cancelled) {
          landmarker.close()
          return
        }

        landmarkerRef.current = landmarker
        setStatus('ready')
        console.log('[pose] model: heavy')
        console.log('[pose] confidence thresholds updated')
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(`Failed to load pose model: ${msg}`)
          setStatus('error')
          console.error('[usePose] Load error:', err)
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

  // Detection function — designed to be called inside a rAF loop asynchronously
  const detectForVideo = useCallback(
    async (video: HTMLVideoElement, timestampMs: number): Promise<NormalizedLandmark[][] | undefined> => {
      // Yield to event loop so rAF render loop never blocks
      await new Promise((resolve) => setTimeout(resolve, 0))

      const landmarker = landmarkerRef.current
      if (!landmarker || status !== 'ready') return undefined
      if (video.readyState < 2) return undefined // HAVE_CURRENT_DATA

      // MediaPipe requires strictly increasing timestamps
      if (timestampMs <= lastTimestampRef.current) return undefined
      lastTimestampRef.current = timestampMs

      // FPS check: if FPS drops below 15, print a console warning
      const now = performance.now()
      const timeForFps = timestampMs > 0 ? timestampMs : now
      if (lastCallTimeRef.current > 0) {
        const dt = timeForFps - lastCallTimeRef.current
        if (dt > 0) {
          const fps = 1000 / dt
          if (fps < 15 && now - lastWarnTimeRef.current >= 1000) {
            console.warn('[pose] heavy model is slow, consider frame skip or reverting')
            lastWarnTimeRef.current = now
          }
        }
      }
      lastCallTimeRef.current = timeForFps

      const t0 = performance.now()
      const result = landmarker.detectForVideo(video, timestampMs)
      const detectDuration = performance.now() - t0

      if (detectDuration > 66.67 && now - lastWarnTimeRef.current >= 1000) {
        console.warn('[pose] heavy model is slow, consider frame skip or reverting')
        lastWarnTimeRef.current = now
      }

      latestResult = result.landmarks
      setLandmarks(result.landmarks)
      return result.landmarks
    },
    [status],
  )

  return {
    status,
    error,
    landmarks,
    detect: detectForVideo,
    detectForVideo,
  }
}
