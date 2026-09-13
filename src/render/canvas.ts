import { PoseLandmarker } from '@mediapipe/tasks-vision'
import { useGameStore } from '../game/state'
import type { MoveId, FloatingTextItem, Particle, ConfettiPiece } from '../game/state'
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

// Module-level variables for smoothed bar values (STEP D: anti-snap)
const displayHp: Record<1 | 2, number> = {
  1: 100,
  2: 100,
}

const displayStamina: Record<1 | 2, number> = {
  1: 100,
  2: 100,
}

export function resetDisplayBars(): void {
  displayHp[1] = 100
  displayHp[2] = 100
  displayStamina[1] = 100
  displayStamina[2] = 100
}

let lastConfettiTime = 0

// Pre-computed string lookups
export const PLAYER_NAMES: Record<1 | 2, string> = {
  1: 'P1',
  2: 'P2',
}

export const MOVE_NAMES: Record<MoveId, string> = {
  FIRE: 'Fire',
  TACKLE: 'Tackle',
  BLOCK: 'Block',
  HEAL: 'Heal',
}

export const MOVE_FLASH_TEXT: Record<1 | 2, Record<MoveId, string>> = {
  1: {
    FIRE: 'P1 FIRE!',
    TACKLE: 'P1 TACKLE!',
    BLOCK: 'P1 BLOCK!',
    HEAL: 'P1 HEAL!',
  },
  2: {
    FIRE: 'P2 FIRE!',
    TACKLE: 'P2 TACKLE!',
    BLOCK: 'P2 BLOCK!',
    HEAL: 'P2 HEAL!',
  },
}



// Pre-allocated arrays and configs to avoid allocations in render loop
const DASH_8_8 = [8, 8]
const DASH_EMPTY: number[] = []
const PLAYER_IDS = [1, 2] as const

const FIRE_TRAIL_CONFIG = [
  { dt: 0.04, radius: 12, style: 'rgba(255, 120, 0, 0.7)' },
  { dt: 0.08, radius: 8, style: 'rgba(255, 120, 0, 0.45)' },
  { dt: 0.12, radius: 5, style: 'rgba(255, 120, 0, 0.25)' },
  { dt: 0.16, radius: 3, style: 'rgba(255, 120, 0, 0.12)' },
] as const

const TACKLE_TRAIL_CONFIG = [
  { dt: 0.04, radius: 9, style: 'rgba(239, 68, 68, 0.6)' },
  { dt: 0.08, radius: 5, style: 'rgba(239, 68, 68, 0.3)' },
] as const

const reusableActiveEntries: FloatingTextItem[] = []
const reusableActiveParticles: Particle[] = []
const reusableActiveConfetti: ConfettiPiece[] = []

/**
 * Setup canvas dimensions and 2D context at devicePixelRatio once.
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D
): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = video.videoWidth * dpr
  canvas.height = video.videoHeight * dpr
  canvas.style.width = video.videoWidth + 'px'
  canvas.style.height = video.videoHeight + 'px'
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
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
 * Projectile easing:
 * - easeInOutQuad for the first 80% of flight, snap for last 20%:
 *   if t < 0.8: eased = 2 * (t/0.8)^2
 *   else:       eased = 1
 * - Clamp t to [0, 1] as before.
 * - Same for the trail.
 */
function easeProjectile(rawT: number): number {
  const t = Math.max(0, Math.min(1, rawT))
  if (t < 0.8) {
    return 2 * Math.pow(t / 0.8, 2)
  }
  return 1
}

/**
 * Draws the entire canvas scene per frame with performance optimizations:
 * 1. Skeleton (faint white)
 * 2. HP bars (smoothed, rounded, color-coded, with labels)
 * 3. Projectiles + trails (FIRE, TACKLE, BLOCK, HEAL)
 * 4. Move flash text ("P{id} {MOVE}!")
 * 5. Floating text
 * 6. Particle bursts & victory confetti
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
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (!players || !players.some(p => p.landmarks && p.landmarks.length >= 33)) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // FEATURE 1: Screen shake on hit (no allocations)
  const shakeUntil = useGameStore.getState().shakeUntil
  let shakeOffsetX = 0
  let shakeOffsetY = 0
  if (shakeUntil) {
    if (now < shakeUntil[1]) {
      shakeOffsetX += (Math.random() - 0.5) * 8
      shakeOffsetY += (Math.random() - 0.5) * 8
    }
    if (now < shakeUntil[2]) {
      shakeOffsetX += (Math.random() - 0.5) * 8
      shakeOffsetY += (Math.random() - 0.5) * 8
    }
  }
  if (shakeOffsetX !== 0 || shakeOffsetY !== 0) {
    ctx.translate(shakeOffsetX, shakeOffsetY)
  }

  // Center divider line (dashed, no save/restore needed)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.setLineDash(DASH_8_8)
  ctx.beginPath()
  ctx.moveTo(vw * 0.5, 0)
  ctx.lineTo(vw * 0.5, vh)
  ctx.stroke()
  ctx.setLineDash(DASH_EMPTY)

  // ──────────────────────────────────────────
  // 1. Skeleton (faint white)
  // ──────────────────────────────────────────
  const connections = PoseLandmarker.POSE_CONNECTIONS
  const hitFlashUntil = useGameStore.getState().hitFlashUntil
  const hitFlash1 = hitFlashUntil?.[1] ?? 0
  const hitFlash2 = hitFlashUntil?.[2] ?? 0

  for (let pi = 0; pi < players.length; pi++) {
    const player = players[pi]
    if (!player || !player.landmarks || player.landmarks.length < 33) continue
    const id = player.playerId
    const lm = player.landmarks

    // STEP C: Hit flash on skeleton
    if (now < (id === 1 ? hitFlash1 : hitFlash2)) {
      ctx.strokeStyle = '#ef4444'
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
    }
    ctx.lineWidth = 2
    ctx.lineCap = 'round'

    for (let ci = 0; ci < connections.length; ci++) {
      const conn = connections[ci]
      const from = lm[conn.start]
      const to = lm[conn.end]
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
    for (let li = 0; li < lm.length; li++) {
      const landmark = lm[li]
      if (!landmark) continue
      if (landmark.visibility !== undefined && landmark.visibility < 0.3) continue
      ctx.beginPath()
      ctx.arc(landmark.x * vw, landmark.y * vh, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ──────────────────────────────────────────
  // 2. HP & Stamina bars (STEP B, C, D)
  // ──────────────────────────────────────────
  const storePlayers = useGameStore.getState().players
  const barWidth = 0.18 * canvas.width
  const barHeight = 10

  for (let pi = 0; pi < players.length; pi++) {
    const player = players[pi]
    if (!player || !player.landmarks || player.landmarks.length < 33) continue
    const lm = player.landmarks
    if (!lm) continue
    const lm11 = lm[11]
    const lm12 = lm[12]
    if (!lm11 || !lm12) continue

    const id = player.playerId
    const anchorX = (lm11.x + lm12.x) * 0.5
    const anchorY = (lm11.y + lm12.y) * 0.5

    // Offset: 0.08 normalized units UP
    const targetX = anchorX
    const targetY = anchorY - 0.08

    // Anti-jitter smoothing
    let smoothed = smoothedBarPos[id]
    if (!smoothed) {
      smoothed = { x: targetX, y: targetY }
      smoothedBarPos[id] = smoothed
    } else {
      smoothed.x = 0.8 * smoothed.x + 0.2 * targetX
      smoothed.y = 0.8 * smoothed.y + 0.2 * targetY
    }

    // Convert normalized space to screen pixels
    const screenX = smoothed.x * canvas.width
    const screenY = smoothed.y * canvas.height

    const barLeft = screenX - barWidth * 0.5
    const barTop = screenY - barHeight * 0.5

    const storePlayer = storePlayers[id - 1]
    const targetHp = storePlayer ? storePlayer.hp : 100
    const targetStamina = storePlayer ? (storePlayer.stamina ?? 100) : 100

    // STEP D: Smooth bar fill (anti-snap)
    displayHp[id] += (targetHp - displayHp[id]) * 0.15
    displayStamina[id] += (targetStamina - displayStamina[id]) * 0.15

    const currentHp = displayHp[id]
    const currentStamina = displayStamina[id]

    // ── STEP B: HP Bar ──
    // Gradient fill:
    //   hp > 50:  '#16a34a' -> '#22c55e'
    //   hp > 20:  '#ca8a04' -> '#eab308'
    //   hp <= 20: '#dc2626' -> '#ef4444'
    let colorStart = '#16a34a'
    let colorEnd = '#22c55e'
    if (currentHp <= 20) {
      colorStart = '#dc2626'
      colorEnd = '#ef4444'
    } else if (currentHp <= 50) {
      colorStart = '#ca8a04'
      colorEnd = '#eab308'
    }

    // Drop shadow: ctx.shadowColor rgba(0,0,0,0.6), blur 4
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 4
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.beginPath()
    ctx.roundRect(barLeft, barTop, barWidth, barHeight, 5)
    ctx.fill()
    ctx.restore()

    // HP Bar gradient fill
    const hpFillWidth = barWidth * Math.max(0, Math.min(100, currentHp) * 0.01)
    if (hpFillWidth > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(barLeft, barTop, barWidth, barHeight, 5)
      ctx.clip()

      const hpGrad = ctx.createLinearGradient(barLeft, 0, barLeft + barWidth, 0)
      hpGrad.addColorStop(0, colorStart)
      hpGrad.addColorStop(1, colorEnd)
      ctx.fillStyle = hpGrad
      ctx.fillRect(barLeft, barTop, hpFillWidth, barHeight)
      ctx.restore()
    }

    // Border: 2px black outer, 1px rgba(255,255,255,0.3) inner
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(barLeft, barTop, barWidth, barHeight, 5)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(barLeft + 1, barTop + 1, Math.max(0, barWidth - 2), barHeight - 2, 4)
    ctx.stroke()

    // Label "P1" or "P2" to the LEFT, bold 18px, white with 3px black stroke
    const label = PLAYER_NAMES[id]
    ctx.font = 'bold 18px system-ui, sans-serif'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 3
    ctx.strokeText(label, barLeft - 18, screenY)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, barLeft - 18, screenY)

    // ── STEP C: Stamina Bar below HP Bar ──
    // Same anchor as HP bar, offset DOWN by (barHeight + 4px gap)
    const staminaBarTop = barTop + barHeight + 4
    const staminaBarHeight = 6
    const staminaFillWidth =
      barWidth * Math.max(0, Math.min(100, currentStamina) * 0.01)

    // Stamina bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.beginPath()
    ctx.roundRect(barLeft, staminaBarTop, barWidth, staminaBarHeight, 3)
    ctx.fill()

    // Fill: linear gradient '#0ea5e9' -> '#38bdf8'
    if (staminaFillWidth > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(barLeft, staminaBarTop, barWidth, staminaBarHeight, 3)
      ctx.clip()

      const staminaGrad = ctx.createLinearGradient(barLeft, 0, barLeft + barWidth, 0)
      staminaGrad.addColorStop(0, '#0ea5e9')
      staminaGrad.addColorStop(1, '#38bdf8')
      ctx.fillStyle = staminaGrad
      ctx.fillRect(barLeft, staminaBarTop, staminaFillWidth, staminaBarHeight)
      ctx.restore()
    }

    // Border: 1px black
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(barLeft, staminaBarTop, barWidth, staminaBarHeight, 3)
    ctx.stroke()
  }

  // ──────────────────────────────────────────
  // 3. Projectiles + trails
  // ──────────────────────────────────────────
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i]
    const elapsed = now - p.bornAt
    const t = Math.max(0, Math.min(1, elapsed / p.durationMs))
    const eased = easeProjectile(t)

    if (p.moveId === 'FIRE') {
      // ── FIRE: orange-yellow circle r=20 with 4-circle trail ──
      const currentX = (p.startX + (p.endX - p.startX) * eased) * vw
      const currentY = (p.startY + (p.endY - p.startY) * eased) * vh

      for (let ti = 0; ti < FIRE_TRAIL_CONFIG.length; ti++) {
        const item = FIRE_TRAIL_CONFIG[ti]
        const trailT = Math.max(0, t - item.dt)
        const easedTrail = easeProjectile(trailT)
        const trailX = (p.startX + (p.endX - p.startX) * easedTrail) * vw
        const trailY = (p.startY + (p.endY - p.startY) * easedTrail) * vh

        ctx.beginPath()
        ctx.arc(trailX, trailY, item.radius, 0, Math.PI * 2)
        ctx.fillStyle = item.style
        ctx.fill()
      }

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
      ctx.shadowBlur = 0
    } else if (p.moveId === 'TACKLE') {
      // ── TACKLE: red circle r=14, short trail, faster (300ms) ──
      const currentX = (p.startX + (p.endX - p.startX) * eased) * vw
      const currentY = (p.startY + (p.endY - p.startY) * eased) * vh

      for (let ti = 0; ti < TACKLE_TRAIL_CONFIG.length; ti++) {
        const item = TACKLE_TRAIL_CONFIG[ti]
        const trailT = Math.max(0, t - item.dt)
        const easedTrail = easeProjectile(trailT)
        const trailX = (p.startX + (p.endX - p.startX) * easedTrail) * vw
        const trailY = (p.startY + (p.endY - p.startY) * easedTrail) * vh

        ctx.beginPath()
        ctx.arc(trailX, trailY, item.radius, 0, Math.PI * 2)
        ctx.fillStyle = item.style
        ctx.fill()
      }

      ctx.shadowColor = '#ef4444'
      ctx.shadowBlur = 20
      ctx.beginPath()
      ctx.arc(currentX, currentY, 14, 0, Math.PI * 2)
      ctx.fillStyle = '#dc2626'
      ctx.fill()
      ctx.shadowBlur = 0
    } else if (p.moveId === 'BLOCK') {
      // ── BLOCK: blue ring expanding + fading at firing player's chest (400ms) ──
      const alpha = Math.max(0, 1 - t)
      const centerX = p.startX * vw
      const centerY = p.startY * vh
      const radius = 20 + 55 * t

      ctx.shadowColor = '#3b82f6'
      ctx.shadowBlur = 18
      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    } else if (p.moveId === 'HEAL') {
      // ── HEAL: green plus rising above firing player's head (600ms) ──
      const alpha = Math.max(0, 1 - t)
      const currentX = p.startX * vw
      const currentY = (p.startY + (p.endY - p.startY) * t) * vh
      const size = 16

      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 18
      ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(currentX - size, currentY)
      ctx.lineTo(currentX + size, currentY)
      ctx.moveTo(currentX, currentY - size)
      ctx.lineTo(currentX, currentY + size)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  // ──────────────────────────────────────────
  // 4. Move flash text ("P{id} {MOVE}!" at top corner of player's half)
  // ──────────────────────────────────────────
  for (let i = 0; i < PLAYER_IDS.length; i++) {
    const id = PLAYER_IDS[i]
    const fireInfo = lastFireAt[id]
    if (!fireInfo) continue

    const elapsed = now - fireInfo.timestamp
    if (elapsed >= 0 && elapsed < 600) {
      const alpha = Math.max(0, 1 - elapsed / 600)
      const textX = id === 1 ? vw * 0.18 : vw * 0.82
      const textY = 54
      const flashText =
        MOVE_FLASH_TEXT[id]?.[fireInfo.move] ?? `${PLAYER_NAMES[id]} ${fireInfo.move}!`

      ctx.font = '900 44px system-ui, sans-serif'
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`
      ctx.lineWidth = 7
      ctx.lineJoin = 'round'
      ctx.strokeText(flashText, textX, textY)

      ctx.fillStyle = `rgba(255, 106, 0, ${alpha})`
      ctx.fillText(flashText, textX, textY)
    }
  }

  // ──────────────────────────────────────────
  // 5. Floating text (STEP A, B, D)
  // ──────────────────────────────────────────
  const floatingEntries = useGameStore.getState().floatingText
  const activeEntries = reusableActiveEntries
  activeEntries.length = 0

  const startIdx = floatingEntries.length > 20 ? floatingEntries.length - 20 : 0

  for (let i = startIdx; i < floatingEntries.length; i++) {
    const entry = floatingEntries[i]
    const duration = entry.durationMs ?? 1200
    const elapsed = now - entry.bornAt
    const t = Math.max(0, Math.min(1, elapsed / duration))

    if (t >= 1) {
      continue
    }
    activeEntries.push(entry)

    const driftPx = entry.driftPx ?? 40
    const px = entry.x * vw
    const py = entry.y * vh - driftPx * t
    const alpha = 1 - t
    const fontSize = entry.fontSize ?? 24

    ctx.globalAlpha = alpha
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.fillStyle = entry.color
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 4
    ctx.strokeText(entry.text, px, py)
    ctx.fillText(entry.text, px, py)
  }
  ctx.globalAlpha = 1

  if (activeEntries.length !== floatingEntries.length) {
    useGameStore.getState().setFloatingText([...activeEntries])
  }

  // ──────────────────────────────────────────
  // FEATURE 2: Particle burst on hit
  // ──────────────────────────────────────────
  const particleList = useGameStore.getState().particles
  const activeParticles = reusableActiveParticles
  activeParticles.length = 0

  const pStartIdx = particleList.length > 100 ? particleList.length - 100 : 0

  for (let i = pStartIdx; i < particleList.length; i++) {
    const part = particleList[i]
    const elapsed = (now - part.bornAt) * 0.001
    const t = Math.max(0, Math.min(1, (now - part.bornAt) / part.lifeMs))
    if (t >= 1) {
      continue
    }
    activeParticles.push(part)

    const px = (part.x + part.vx * elapsed) * vw
    const py = (part.y + part.vy * elapsed) * vh + elapsed * elapsed * 400
    const alpha = 1 - t
    const radius = 6 * (1 - t) + 2

    ctx.globalAlpha = alpha
    ctx.fillStyle = part.color
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  if (activeParticles.length !== particleList.length) {
    useGameStore.getState().setParticles([...activeParticles])
  }

  // ──────────────────────────────────────────
  // FEATURE 3: Victory confetti on GAME_OVER
  // ──────────────────────────────────────────
  const confettiList = useGameStore.getState().confetti
  if (confettiList.length > 0) {
    const activeConfetti = reusableActiveConfetti
    activeConfetti.length = 0

    const cStartIdx = confettiList.length > 60 ? confettiList.length - 60 : 0
    const dt =
      lastConfettiTime === 0
        ? 0.016
        : Math.min(0.1, (now - lastConfettiTime) * 0.001)

    for (let i = cStartIdx; i < confettiList.length; i++) {
      const piece = confettiList[i]
      piece.y += piece.vy * dt
      piece.x += piece.vx * dt
      piece.rotation += piece.spin * dt

      if (piece.y > 1.2) {
        continue
      }
      activeConfetti.push(piece)

      const px = piece.x * vw
      const py = piece.y * vh

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(piece.rotation)
      ctx.fillStyle = piece.color
      ctx.fillRect(
        -piece.width * 0.5,
        -piece.height * 0.5,
        piece.width,
        piece.height
      )
      ctx.restore()
    }

    if (activeConfetti.length !== confettiList.length) {
      useGameStore.getState().setConfetti([...activeConfetti])
    }
  }
  lastConfettiTime = now

  // ──────────────────────────────────────────
  // TRAINING: Dummy rendering
  // ──────────────────────────────────────────
  const storeState = useGameStore.getState()
  if (storeState.mode === 'TRAINING' && storeState.phase === 'BATTLE') {
    const dummy = storeState.dummy
    const dx = dummy.anchorX * vw
    const dy = dummy.anchorY * vh
    const dummyRadius = Math.min(vw, vh) * 0.06

    // Punching bag body (circle + rectangle below)
    ctx.save()

    // Glow when hit
    const dummyHitFlash = storeState.hitstopUntil > now
    if (dummyHitFlash) {
      ctx.shadowColor = '#ff4444'
      ctx.shadowBlur = 20
    }

    // Main circle
    ctx.fillStyle = dummy.hp > 0 ? '#e74c3c' : '#555555'
    ctx.beginPath()
    ctx.arc(dx, dy, dummyRadius, 0, Math.PI * 2)
    ctx.fill()

    // Face (two eyes + mouth)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(dx - dummyRadius * 0.3, dy - dummyRadius * 0.15, dummyRadius * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(dx + dummyRadius * 0.3, dy - dummyRadius * 0.15, dummyRadius * 0.1, 0, Math.PI * 2)
    ctx.fill()
    // Mouth
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(dx, dy + dummyRadius * 0.2, dummyRadius * 0.25, 0, Math.PI)
    ctx.stroke()

    // Body / stand
    ctx.fillStyle = dummy.hp > 0 ? '#c0392b' : '#444444'
    ctx.fillRect(dx - dummyRadius * 0.3, dy + dummyRadius, dummyRadius * 0.6, dummyRadius * 1.2)
    ctx.fillRect(dx - dummyRadius * 0.6, dy + dummyRadius + dummyRadius * 1.2, dummyRadius * 1.2, dummyRadius * 0.15)

    ctx.restore()

    // HP bar above dummy
    const barW = dummyRadius * 2.5
    const barH = 6
    const barX = dx - barW / 2
    const barY = dy - dummyRadius - 16
    const hpRatio = Math.max(0, dummy.hp / dummy.maxHp)

    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2)
    const hpColor = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444'
    ctx.fillStyle = hpColor
    ctx.fillRect(barX, barY, barW * hpRatio, barH)

    // Label
    ctx.font = 'bold 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('DUMMY', dx, barY - 4)
    ctx.fillText(`${Math.round(dummy.hp)}/${dummy.maxHp}`, dx, barY + barH + 14)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  // ──────────────────────────────────────────
  // TRAINING: Feedback panel (top-right, last gesture)
  // ──────────────────────────────────────────
  if (storeState.mode === 'TRAINING' && storeState.phase === 'BATTLE') {
    const panelX = vw - 170
    const panelY = 12
    const panelW = 158
    const panelH = 58

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)'
    ctx.lineWidth = 1

    // Rounded rect
    const r = 8
    ctx.beginPath()
    ctx.moveTo(panelX + r, panelY)
    ctx.lineTo(panelX + panelW - r, panelY)
    ctx.arcTo(panelX + panelW, panelY, panelX + panelW, panelY + r, r)
    ctx.lineTo(panelX + panelW, panelY + panelH - r)
    ctx.arcTo(panelX + panelW, panelY + panelH, panelX + panelW - r, panelY + panelH, r)
    ctx.lineTo(panelX + r, panelY + panelH)
    ctx.arcTo(panelX, panelY + panelH, panelX, panelY + panelH - r, r)
    ctx.lineTo(panelX, panelY + r)
    ctx.arcTo(panelX, panelY, panelX + r, panelY, r)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#a78bfa'
    ctx.fillText('TRAINING MODE', panelX + 10, panelY + 8)
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#d1d5db'
    const lastGest = storeState.lastGesture[1] ?? 'None'
    ctx.fillText(`Last: ${lastGest}`, panelX + 10, panelY + 26)
    ctx.fillText(`Dummy: ${Math.round(storeState.dummy.hp)}HP`, panelX + 10, panelY + 40)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  // ──────────────────────────────────────────
  // K.O. screen flash + zoom punch
  // ──────────────────────────────────────────
  const { phase, koStartedAt } = useGameStore.getState()
  if (phase === 'GAME_OVER' && koStartedAt > 0) {
    const elapsed = now - koStartedAt

    // 1. Zoom punch (0-400ms)
    if (elapsed < 400) {
      const t = elapsed / 400
      const zoom = 1.0 + 0.08 * Math.sin(t * Math.PI)
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.scale(zoom, zoom)
      ctx.translate(-canvas.width / 2, -canvas.height / 2)
      // Note: the zoom is applied BEFORE the K.O. text so it also zooms
      ctx.restore()
      // To actually apply, re-draw the K.O. text inside the zoom transform
    }

    // 2. White flash (0-200ms)
    if (elapsed < 200) {
      const alpha = 1 - elapsed / 200
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    // 3. K.O. text (0-600ms)
    if (elapsed < 600) {
      // Fade in during first 100ms, hold, fade out during last 200ms
      let alpha: number
      if (elapsed < 100) alpha = elapsed / 100
      else if (elapsed < 400) alpha = 1
      else alpha = 1 - (elapsed - 400) / 200

      const zoom =
        elapsed < 400 ? 1.0 + 0.08 * Math.sin((elapsed / 400) * Math.PI) : 1.0

      ctx.save()
      ctx.globalAlpha = Math.max(0, alpha)

      // Apply zoom transform
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.scale(zoom, zoom)
      ctx.translate(-canvas.width / 2, -canvas.height / 2)

      // Draw K.O. text
      ctx.font = 'bold 120px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 8
      ctx.strokeStyle = '#000000'
      ctx.strokeText('K.O.', canvas.width / 2, canvas.height / 2)
      ctx.fillStyle = '#ff3030'
      ctx.fillText('K.O.', canvas.width / 2, canvas.height / 2)

      ctx.restore()
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  // Reset transform to identity
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
