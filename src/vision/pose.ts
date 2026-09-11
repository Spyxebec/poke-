import { useEffect, useRef, useState, useCallback } from 'react'
import {
  PoseLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export type PoseStatus = 'loading' | 'ready' | 'error'

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
  detect: (video: HTMLVideoElement, timestampMs: number) => NormalizedLandmark[][] | undefined
  /** Run MediaPipe detectForVideo directly */
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => NormalizedLandmark[][] | undefined
}

// Full model swapped from /pose_landmarker_lite.task for higher tracking accuracy.
// public/pose_landmarker_lite.task was deleted after confirming pose_landmarker_full.task loads.
export const MODEL_PATH = '/pose_landmarker_full.task'
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
              modelAssetPath: '/pose_landmarker_full.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 2,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence: 0.4,
            minTrackingConfidence: 0.4,
          })
          delegate = 'GPU'
        } catch (gpuErr) {
          console.warn('[usePose] GPU delegate failed, falling back to CPU:', gpuErr)
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/pose_landmarker_full.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 2,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence: 0.4,
            minTrackingConfidence: 0.4,
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
        console.log('[usePose] PoseLandmarker loaded successfully with full model')
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

  // Detection function — designed to be called inside a rAF loop
  const detectForVideo = useCallback(
    (video: HTMLVideoElement, timestampMs: number) => {
      const landmarker = landmarkerRef.current
      if (!landmarker || status !== 'ready') return undefined
      if (video.readyState < 2) return undefined // HAVE_CURRENT_DATA

      // MediaPipe requires strictly increasing timestamps
      if (timestampMs <= lastTimestampRef.current) return undefined
      lastTimestampRef.current = timestampMs

      const result = landmarker.detectForVideo(video, timestampMs)
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
