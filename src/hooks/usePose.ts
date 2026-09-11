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
  detect: (video: HTMLVideoElement, timestampMs: number) => void
}

const MODEL_PATH = '/pose_landmarker_lite.task'
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'

/**
 * Loads the MediaPipe PoseLandmarker (lite, VIDEO mode, up to 2 poses)
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

        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 2,
        })

        if (cancelled) {
          landmarker.close()
          return
        }

        landmarkerRef.current = landmarker
        setStatus('ready')
        console.log('[usePose] PoseLandmarker loaded successfully')
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
  const detect = useCallback(
    (video: HTMLVideoElement, timestampMs: number) => {
      const landmarker = landmarkerRef.current
      if (!landmarker || status !== 'ready') return
      if (video.readyState < 2) return // HAVE_CURRENT_DATA

      // MediaPipe requires strictly increasing timestamps
      if (timestampMs <= lastTimestampRef.current) return
      lastTimestampRef.current = timestampMs

      const result = landmarker.detectForVideo(video, timestampMs)
      setLandmarks(result.landmarks)
    },
    [status],
  )

  return { status, error, landmarks, detect }
}
