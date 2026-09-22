import { useRef } from 'react'
import type { PlayerAssignment } from '../hooks/usePlayerAssignment'
import type { LastFireInfo } from '../game/loop'

export interface OverlayProps {
  /** Canvas ref controlled directly by Camera's rAF render loop */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  /** The video element to match dimensions against */
  videoEl?: HTMLVideoElement | null
  /** Player assignments with landmarks */
  players?: PlayerAssignment[]
  /** Information when each player last fired a move */
  lastFireAt?: Record<1 | 2, LastFireInfo | null>
}

/**
 * Transparent <canvas> overlaid on the video feed.
 * Controlled directly by the rAF render loop in Camera.tsx to eliminate
 * React re-render storms and per-frame overhead.
 */
export function Overlay({ canvasRef: externalRef }: OverlayProps) {
  const internalRef = useRef<HTMLCanvasElement | null>(null)
  const ref = externalRef ?? internalRef

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 2 }}
    />
  )
}
