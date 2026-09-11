import { useRef, useEffect } from 'react'
import type { PlayerAssignment } from '../hooks/usePlayerAssignment'
import type { Projectile, LastFireInfo } from '../game/loop'
import { projectiles, lastFireAt as defaultLastFireAt } from '../game/loop'
import { renderCanvas } from '../render/canvas'

interface OverlayProps {
  /** The video element to match dimensions against */
  videoEl: HTMLVideoElement | null
  /** Player assignments with landmarks */
  players: PlayerAssignment[]
  /** Information when each player last fired a move */
  lastFireAt?: Record<1 | 2, LastFireInfo | null>
}

let lastDebugLog = 0

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
    const video = videoEl
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match canvas internal resolution to video's natural size
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw === 0 || vh === 0) return

    // Set canvas buffer to match video exactly — no devicePixelRatio scaling
    canvas.width = vw
    canvas.height = vh
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    // Set text defaults once
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    // Debug log once per second
    const now = Date.now()
    if (now - lastDebugLog > 1000) {
      console.log('render', { canvasW: canvas.width, canvasH: canvas.height, videoReady: video.readyState })
      lastDebugLog = now
    }

    renderCanvas({
      ctx,
      vw,
      vh,
      players,
      projectiles,
      lastFireAt: lastFireAt ?? defaultLastFireAt,
      now,
    })
  }, [videoEl, players, lastFireAt])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 2 }}
    />
  )
}
