import { useEffect, useRef, useState } from 'react'

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'error'

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: CameraStatus
  error: string | null
}

/**
 * Acquires a rear-or-front camera stream via getUserMedia
 * and attaches it to a video element ref.
 *
 * Returns the ref (to bind to a <video>), the current status,
 * and an error message if something went wrong.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function startCamera() {
      setStatus('requesting')
      setError(null)

      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
          })
        } catch (primaryErr) {
          console.warn('[useCamera] 1280x720 failed, retrying with 640x480 fallback:', primaryErr)
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
          })
        }

        if (videoRef.current) {
          const video = videoRef.current
          video.srcObject = stream
          await video.play()
          setStatus('active')

          const logDimensions = () => {
            if (video.videoWidth && video.videoHeight) {
              console.log(`[Camera] ${video.videoWidth}x${video.videoHeight}`)
            }
          }

          if (video.videoWidth && video.videoHeight) {
            logDimensions()
          } else {
            video.addEventListener('loadedmetadata', logDimensions, { once: true })
          }
        }
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setStatus('denied')
            setError('Camera permission was denied. Please allow camera access and reload the page.')
          } else if (err.name === 'NotFoundError') {
            setStatus('error')
            setError('No camera found on this device.')
          } else if (err.name === 'NotReadableError' || err.name === 'AbortError') {
            setStatus('error')
            setError('Camera is already in use by another application.')
          } else {
            setStatus('error')
            setError(`Camera error: ${err.message}`)
          }
        } else {
          setStatus('error')
          setError('An unexpected error occurred while accessing the camera.')
        }
      }
    }

    startCamera()

    // Cleanup: stop all tracks when the component unmounts
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return { videoRef, status, error }
}
