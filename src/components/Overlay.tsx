import { useRef, useEffect } from 'react'
import type { PlayerAssignment } from '../hooks/usePlayerAssignment'
import { projectiles, lastFireAt as defaultLastFireAt } from '../game/loop'
import { renderCanvas } from '../render/canvas'

interface OverlayProps {
  /** The video element to match dimensions against */
  videoEl: HTMLVideoElement | null
  /** Player assignments with landmarks */
  players: PlayerAssignment[]
  /** Timestamps when each player last fired FIRE */
  lastFireAt?: Record<1 | 2, number>
}

/**
 * Transparent <canvas> overlaid on the video feed.
 * Delegates frame rendering to src/render/canvas.ts:
 * 1. Skeleton (faint white)
 * 2. HP bars (smoothed, rounded, color-coded, labeled)
 * 3. Projectiles + trails
 * 4. Fire flash text
 */
export function Overlay({ videoEl, players, lastFireAt }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !videoEl) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match canvas internal resolution to video's natural size
    const vw = videoEl.videoWidth
    const vh = videoEl.videoHeight
    if (vw === 0 || vh === 0) return

    canvas.width = vw
    canvas.height = vh

    renderCanvas({
      ctx,
      vw,
      vh,
      players,
      projectiles,
      lastFireAt: lastFireAt ?? defaultLastFireAt,
      now: Date.now(),
    })
  }, [videoEl, players, lastFireAt])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full object-cover pointer-events-none"
    />
  )
}
