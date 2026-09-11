import { PoseLandmarker } from '@mediapipe/tasks-vision'
import { useGameStore } from '../game/state'
import type { PlayerAssignment } from '../hooks/usePlayerAssignment'
import type { Projectile, LastFireInfo } from '../game/loop'

interface SmoothedPos {
  x: number
  y: number
}

// Anti-jitter smoothed positions for HP bars per player
const smoothedBarPos: Record<1 | 2, SmoothedPos | null> = {
  1: null,
  2: null,
}

export function resetSmoothedBarPos(): void {
  smoothedBarPos[1] = null
  smoothedBarPos[2] = null
}

export interface RenderCanvasOptions {
  ctx: CanvasRenderingContext2D
  vw: number
  vh: number
  players: PlayerAssignment[]
  projectiles: Projectile[]
  lastFireAt: Record<1 | 2, LastFireInfo | null>
  now?: number
}

/**
 * Draws the entire canvas scene per frame according to Level 6/7 draw order:
 * 1. Skeleton (faint white)
 * 2. HP bars (smoothed, rounded, color-coded, with labels)
 * 3. Projectiles + trails (FIRE, TACKLE, BLOCK, HEAL)
 * 4. Move flash text ("P{id} {MOVE}!")
 */
export function renderCanvas({
  ctx,
  vw,
  vh,
  players,
  projectiles,
  lastFireAt,
  now = Date.now(),
}: RenderCanvasOptions): void {
  // Clear previous frame
  ctx.clearRect(0, 0, vw, vh)

  // Center divider line (dashed)
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.setLineDash([8, 8])
  ctx.beginPath()
  ctx.moveTo(vw / 2, 0)
  ctx.lineTo(vw / 2, vh)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // ──────────────────────────────────────────
  // 1. Skeleton (faint white, mirrored to match video)
  // ──────────────────────────────────────────
  ctx.save()
  ctx.translate(vw, 0)
  ctx.scale(-1, 1)

  const connections = PoseLandmarker.POSE_CONNECTIONS

  for (const player of players) {
    const lm = player.landmarks

    // Faint white connection lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'

    for (const { start, end } of connections) {
      const from = lm[start]
      const to = lm[end]
      if (!from || !to) continue
      if (from.visibility !== undefined && from.visibility < 0.3) continue
      if (to.visibility !== undefined && to.visibility < 0.3) continue

      ctx.beginPath()
      ctx.moveTo(from.x * vw, from.y * vh)
      ctx.lineTo(to.x * vw, to.y * vh)
      ctx.stroke()
    }

    // Faint landmark dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    for (const landmark of lm) {
      if (landmark.visibility !== undefined && landmark.visibility < 0.3) continue
      ctx.beginPath()
      ctx.arc(landmark.x * vw, landmark.y * vh, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()

  // ──────────────────────────────────────────
  // 2. HP bars (smoothed, anti-jitter, unmirrored coords)
  // ──────────────────────────────────────────
  const storePlayers = useGameStore.getState().players
  const barWidth = 0.15 * vw
  const barHeight = 12
  const cornerRadius = 4

  for (const player of players) {
    const lm11 = player.landmarks[11]
    const lm12 = player.landmarks[12]
    if (!lm11 || !lm12) continue

    const id = player.playerId
    const anchorX = (lm11.x + lm12.x) / 2
    const anchorY = (lm11.y + lm12.y) / 2

    // Offset: 0.08 normalized units UP (smaller Y is UP)
    const targetX = anchorX
    const targetY = anchorY - 0.08

    // Anti-jitter smoothing:
    // smoothed.x = 0.8 * smoothed.x + 0.2 * target.x
    // smoothed.y = 0.8 * smoothed.y + 0.2 * target.y
    if (!smoothedBarPos[id]) {
      smoothedBarPos[id] = { x: targetX, y: targetY }
    } else {
      const smoothed = smoothedBarPos[id]!
      smoothed.x = 0.8 * smoothed.x + 0.2 * targetX
      smoothed.y = 0.8 * smoothed.y + 0.2 * targetY
    }

    const smoothed = smoothedBarPos[id]!

    // Convert from mirrored normalized space to screen pixels
    const screenX = (1 - smoothed.x) * vw
    const screenY = smoothed.y * vh

    const barLeft = screenX - barWidth / 2
    const barTop = screenY - barHeight / 2

    const storePlayer = storePlayers[id - 1]
    const hp = storePlayer ? storePlayer.hp : 100

    // Fill color based on HP thresholds
    let fillColor = '#22c55e' // Green (> 50)
    if (hp <= 20) {
      fillColor = '#ef4444' // Red (<= 20)
    } else if (hp <= 50) {
      fillColor = '#eab308' // Yellow (> 20 and <= 50)
    }

    // Bar background (black with transparency)
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.beginPath()
    ctx.roundRect(barLeft, barTop, barWidth, barHeight, cornerRadius)
    ctx.fill()

    // HP fill width
    const fillWidth = barWidth * Math.max(0, Math.min(100, hp) / 100)
    if (fillWidth > 0) {
      ctx.fillStyle = fillColor
      ctx.beginPath()
      ctx.roundRect(barLeft, barTop, fillWidth, barHeight, cornerRadius)
      ctx.fill()
    }

    // 2px black border
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(barLeft, barTop, barWidth, barHeight, cornerRadius)
    ctx.stroke()

    // Label to the LEFT of the bar: "P1" or "P2", bold, white with black outline, right-aligned
    const label = `P${id}`
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 3
    ctx.strokeText(label, barLeft - 8, screenY)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, barLeft - 8, screenY)

    // Optional small HP number to the right of the bar: "72/100"
    const hpText = `${Math.round(hp)}/100`
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 3
    ctx.strokeText(hpText, barLeft + barWidth + 8, screenY)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(hpText, barLeft + barWidth + 8, screenY)

    ctx.restore()
  }

  // ──────────────────────────────────────────
  // 3. Projectiles + trails (mirrored context to match video landmarks)
  // ──────────────────────────────────────────
  ctx.save()
  ctx.translate(vw, 0)
  ctx.scale(-1, 1)

  for (const p of projectiles) {
    const elapsed = now - p.bornAt
    const t = Math.max(0, Math.min(1, elapsed / p.durationMs))

    if (p.moveId === 'FIRE') {
      // ── FIRE: orange-yellow circle r=20 with 4-circle trail ──
      const currentX = (p.startX + (p.endX - p.startX) * t) * vw
      const currentY = (p.startY + (p.endY - p.startY) * t) * vh

      const trailConfig = [
        { dt: 0.04, radius: 12, alpha: 0.7 },
        { dt: 0.08, radius: 8, alpha: 0.45 },
        { dt: 0.12, radius: 5, alpha: 0.25 },
        { dt: 0.16, radius: 3, alpha: 0.12 },
      ]

      for (const item of trailConfig) {
        const trailT = Math.max(0, t - item.dt)
        const trailX = (p.startX + (p.endX - p.startX) * trailT) * vw
        const trailY = (p.startY + (p.endY - p.startY) * trailT) * vh

        ctx.save()
        ctx.beginPath()
        ctx.arc(trailX, trailY, item.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 120, 0, ${item.alpha})`
        ctx.fill()
        ctx.restore()
      }

      ctx.save()
      ctx.shadowColor = '#ff6a00'
      ctx.shadowBlur = 24
      ctx.beginPath()
      ctx.arc(currentX, currentY, 20, 0, Math.PI * 2)

      const grad = ctx.createRadialGradient(
        currentX,
        currentY,
        2,
        currentX,
        currentY,
        20
      )
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.35, '#ffdd00')
      grad.addColorStop(0.7, '#ff6a00')
      grad.addColorStop(1, '#ff2200')

      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()
    } else if (p.moveId === 'TACKLE') {
      // ── TACKLE: red circle r=14, short trail, faster (300ms) ──
      const currentX = (p.startX + (p.endX - p.startX) * t) * vw
      const currentY = (p.startY + (p.endY - p.startY) * t) * vh

      const shortTrail = [
        { dt: 0.04, radius: 9, alpha: 0.6 },
        { dt: 0.08, radius: 5, alpha: 0.3 },
      ]

      for (const item of shortTrail) {
        const trailT = Math.max(0, t - item.dt)
        const trailX = (p.startX + (p.endX - p.startX) * trailT) * vw
        const trailY = (p.startY + (p.endY - p.startY) * trailT) * vh

        ctx.save()
        ctx.beginPath()
        ctx.arc(trailX, trailY, item.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(239, 68, 68, ${item.alpha})`
        ctx.fill()
        ctx.restore()
      }

      ctx.save()
      ctx.shadowColor = '#ef4444'
      ctx.shadowBlur = 20
      ctx.beginPath()
      ctx.arc(currentX, currentY, 14, 0, Math.PI * 2)
      ctx.fillStyle = '#dc2626'
      ctx.fill()
      ctx.restore()
    } else if (p.moveId === 'BLOCK') {
      // ── BLOCK: blue ring expanding + fading at firing player's chest (400ms) ──
      const alpha = Math.max(0, 1 - t)
      const centerX = p.startX * vw
      const centerY = p.startY * vh
      const radius = 20 + 55 * t

      ctx.save()
      ctx.shadowColor = '#3b82f6'
      ctx.shadowBlur = 18
      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    } else if (p.moveId === 'HEAL') {
      // ── HEAL: green plus rising above firing player's head (600ms) ──
      const alpha = Math.max(0, 1 - t)
      const currentX = p.startX * vw
      const currentY = (p.startY + (p.endY - p.startY) * t) * vh
      const size = 16

      ctx.save()
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 18
      ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      // Horizontal bar
      ctx.moveTo(currentX - size, currentY)
      ctx.lineTo(currentX + size, currentY)
      // Vertical bar
      ctx.moveTo(currentX, currentY - size)
      ctx.lineTo(currentX, currentY + size)
      ctx.stroke()
      ctx.restore()
    }
  }

  ctx.restore()

  // ──────────────────────────────────────────
  // 4. Move flash text ("P{id} {MOVE}!" at top corner of player's half)
  // ──────────────────────────────────────────
  for (const id of [1, 2] as const) {
    const fireInfo = lastFireAt[id]
    if (!fireInfo) continue

    const elapsed = now - fireInfo.timestamp
    if (elapsed >= 0 && elapsed < 600) {
      const alpha = Math.max(0, 1 - elapsed / 600)

      // Top corner of firing player's half
      const textX = id === 1 ? vw * 0.18 : vw * 0.82
      const textY = 54

      ctx.save()
      ctx.font = '900 44px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Black outline
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`
      ctx.lineWidth = 7
      ctx.lineJoin = 'round'
      ctx.strokeText(`P${id} ${fireInfo.move}!`, textX, textY)

      // Bright orange (#ff6a00) fill
      ctx.fillStyle = `rgba(255, 106, 0, ${alpha})`
      ctx.fillText(`P${id} ${fireInfo.move}!`, textX, textY)

      ctx.restore()
    }
  }
}
