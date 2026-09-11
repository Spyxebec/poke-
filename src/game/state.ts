import { create } from 'zustand'
import { playSfx } from './audio'

// ==========================================
// SPEC §6: Data Models
// ==========================================

export type Phase = 'IDLE' | 'BATTLE' | 'GAME_OVER'

export type MoveId = 'FIRE' | 'TACKLE' | 'BLOCK' | 'HEAL'

export interface Move {
  id: MoveId
  name: string
  damage: number // negative = heal
  cooldownMs: number
  sfx: string
}

export interface Player {
  id: 1 | 2
  hp: number // starts at 100, max 100
  cooldownUntil: number
  blockUntil: number
  lastGesture: MoveId | null
  lastGestureAt: number
}

export interface FloatingTextItem {
  text: string
  x: number // normalized 0..1
  y: number // normalized 0..1
  bornAt: number // Date.now()
  color: string
  fontSize?: number
  durationMs?: number
  driftPx?: number
}

export interface Particle {
  x: number // normalized 0..1
  y: number // normalized 0..1
  vx: number // velocity per second, normalized
  vy: number // velocity per second, normalized
  bornAt: number
  lifeMs: number // 500
  color: string
}

export interface ConfettiPiece {
  x: number // random normalized x
  y: number // start above screen (-0.1)
  vy: number // fall speed
  vx: number // slight horizontal drift
  rotation: number
  spin: number // rad/sec
  color: string
  width: number
  height: number
  bornAt: number
}

export interface GameState {
  phase: Phase
  players: [Player, Player]
  winner: 1 | 2 | null
  floatingText: FloatingTextItem[]
  hitFlashUntil: Record<1 | 2, number>
  shakeUntil: Record<1 | 2, number>
  particles: Particle[]
  confetti: ConfettiPiece[]
  projectiles?: any[]
  hitstopUntil: number
}

export interface GameActions {
  startBattle: () => void
  applyDamage: (playerId: 1 | 2, amount: number) => void
  heal: (playerId: 1 | 2, amount: number) => void
  setBlock: (playerId: 1 | 2, durationMs: number) => void
  setCooldown: (playerId: 1 | 2, ms: number) => void
  checkWin: () => void
  reset: () => void
  addFloatingText: (item: FloatingTextItem) => void
  setFloatingText: (items: FloatingTextItem[]) => void
  setHitFlash: (playerId: 1 | 2, until: number) => void
  addParticles: (items: Particle[]) => void
  setParticles: (items: Particle[]) => void
  setConfetti: (items: ConfettiPiece[]) => void
}

export type GameStore = GameState & GameActions

const createInitialPlayer = (id: 1 | 2): Player => ({
  id,
  hp: 100,
  cooldownUntil: 0,
  blockUntil: 0,
  lastGesture: null,
  lastGestureAt: 0,
})

export const useGameStore = create<GameStore>((set, get) => ({
  // Initial state
  phase: 'IDLE',
  players: [createInitialPlayer(1), createInitialPlayer(2)],
  winner: null,
  floatingText: [],
  hitFlashUntil: { 1: 0, 2: 0 },
  shakeUntil: { 1: 0, 2: 0 },
  particles: [],
  confetti: [],
  projectiles: [],
  hitstopUntil: 0,

  // Actions
  startBattle: () => {
    set((state) => {
      if (state.phase === 'BATTLE') return {}
      console.log(`[GameState] startBattle: ${state.phase} -> BATTLE`)
      return { phase: 'BATTLE' }
    })
  },

  applyDamage: (playerId: 1 | 2, amount: number) => {
    set((state) => {
      if (state.phase === 'GAME_OVER') return {}

      const now = Date.now()
      const updatedPlayers = state.players.map((player) => {
        if (player.id !== playerId) return player

        // If blocked, damage is negated and block is cleared
        if (player.blockUntil > now) {
          return { ...player, blockUntil: 0 }
        }

        const newHp = Math.max(0, Math.min(100, player.hp - amount))
        return { ...player, hp: newHp }
      }) as [Player, Player]

      // Hit flash on skeleton: STEP C (Date.now() + 150)
      const hitFlashUntil = {
        ...state.hitFlashUntil,
        [playerId]: now + 150,
      }

      // Screen shake on hit: 120ms duration
      const shakeUntil = {
        ...state.shakeUntil,
        [playerId]: now + 120,
      }

      return {
        players: updatedPlayers,
        hitFlashUntil,
        shakeUntil,
        hitstopUntil: now + 70,
      }
    })

    // checkWin(): called after every applyDamage
    get().checkWin()
  },

  heal: (playerId: 1 | 2, amount: number) => {
    set((state) => ({
      players: state.players.map((player) => {
        if (player.id !== playerId) return player
        const newHp = Math.min(100, Math.max(0, player.hp + amount))
        return { ...player, hp: newHp }
      }) as [Player, Player],
    }))
  },

  setBlock: (playerId: 1 | 2, durationMs: number) => {
    const now = Date.now()
    set((state) => ({
      players: state.players.map((player) =>
        player.id === playerId
          ? { ...player, blockUntil: durationMs <= 0 ? 0 : now + durationMs }
          : player
      ) as [Player, Player],
    }))
  },

  setCooldown: (playerId: 1 | 2, ms: number) => {
    const now = Date.now()
    set((state) => ({
      players: state.players.map((player) =>
        player.id === playerId ? { ...player, cooldownUntil: now + ms } : player
      ) as [Player, Player],
    }))
  },

  checkWin: () => {
    set((state) => {
      // Guard against re-triggering: if phase is already 'GAME_OVER', do nothing.
      if (state.phase === 'GAME_OVER') return {}

      const p1 = state.players[0]
      const p2 = state.players[1]
      if (p1.hp <= 0 || p2.hp <= 0) {
        let winner: 1 | 2 | null = null
        if (p1.hp <= 0 && p2.hp > 0) winner = 2
        else if (p2.hp <= 0 && p1.hp > 0) winner = 1
        else winner = p1.hp > p2.hp ? 1 : 2

        playSfx('win')

        // FEATURE 3: Victory confetti on GAME_OVER
        const now = Date.now()
        const colors = [
          '#ef4444',
          '#22c55e',
          '#eab308',
          '#3b82f6',
          '#a855f7',
          '#f97316',
        ]
        const confetti: ConfettiPiece[] = []
        for (let i = 0; i < 60; i++) {
          confetti.push({
            x: Math.random(),
            y: -0.1,
            vy: 0.3 + Math.random() * 0.4,
            vx: (Math.random() - 0.5) * 0.2,
            rotation: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            width: 8,
            height: 14,
            bornAt: now,
          })
        }

        return { phase: 'GAME_OVER', winner, confetti }
      }
      return {}
    })
  },

  reset: () => {
    set({
      phase: 'BATTLE',
      players: [createInitialPlayer(1), createInitialPlayer(2)],
      winner: null,
      floatingText: [],
      hitFlashUntil: { 1: 0, 2: 0 },
      shakeUntil: { 1: 0, 2: 0 },
      particles: [],
      confetti: [],
      projectiles: [],
      hitstopUntil: 0,
    })
  },

  addFloatingText: (item: FloatingTextItem) => {
    set((state) => {
      const updated = [...state.floatingText, item]
      // STEP D: If floatingText.length > 20, drop the oldest entries
      const capped =
        updated.length > 20 ? updated.slice(updated.length - 20) : updated
      return { floatingText: capped }
    })
  },

  setFloatingText: (items: FloatingTextItem[]) => {
    set({ floatingText: items })
  },

  setHitFlash: (playerId: 1 | 2, until: number) => {
    set((state) => ({
      hitFlashUntil: {
        ...state.hitFlashUntil,
        [playerId]: until,
      },
    }))
  },

  addParticles: (items: Particle[]) => {
    set((state) => {
      const updated = [...state.particles, ...items]
      const capped =
        updated.length > 100 ? updated.slice(updated.length - 100) : updated
      return { particles: capped }
    })
  },

  setParticles: (items: Particle[]) => {
    const capped =
      items.length > 100 ? items.slice(items.length - 100) : items
    set({ particles: capped })
  },

  setConfetti: (items: ConfettiPiece[]) => {
    const capped = items.length > 60 ? items.slice(items.length - 60) : items
    set({ confetti: capped })
  },
}))

// ==========================================
// Selectors
// ==========================================

export const usePhase = (): Phase => useGameStore((state) => state.phase)

export const usePlayer = (id: 1 | 2): Player =>
  useGameStore((state) => state.players[id === 1 ? 0 : 1])

export { useGameStore as useStore }
