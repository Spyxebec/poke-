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

export interface GameState {
  phase: Phase
  players: [Player, Player]
  winner: 1 | 2 | null
  floatingText: FloatingTextItem[]
  hitFlashUntil: Record<1 | 2, number>
  projectiles?: any[]
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
  projectiles: [],

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

      return {
        players: updatedPlayers,
        hitFlashUntil,
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
        return { phase: 'GAME_OVER', winner }
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
      projectiles: [],
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
}))

// ==========================================
// Selectors
// ==========================================

export const usePhase = (): Phase => useGameStore((state) => state.phase)

export const usePlayer = (id: 1 | 2): Player =>
  useGameStore((state) => state.players[id === 1 ? 0 : 1])

export { useGameStore as useStore }
