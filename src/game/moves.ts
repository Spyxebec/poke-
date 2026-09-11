import type { Move, MoveId } from './state'

/**
 * Move definitions (SPEC §6 & Level 7 STEP B).
 */
export const MOVES: Record<MoveId, Move> = {
  FIRE: {
    id: 'FIRE',
    name: 'Fire',
    damage: 15,
    cooldownMs: 2000,
    sfx: '/sfx/fire.mp3',
  },
  TACKLE: {
    id: 'TACKLE',
    name: 'Tackle',
    damage: 10,
    cooldownMs: 1000,
    sfx: '/sfx/tackle.mp3',
  },
  BLOCK: {
    id: 'BLOCK',
    name: 'Block',
    damage: 0,
    cooldownMs: 3000,
    sfx: '/sfx/block.mp3',
  },
  HEAL: {
    id: 'HEAL',
    name: 'Heal',
    damage: -10,
    cooldownMs: 5000,
    sfx: '/sfx/heal.mp3',
  },
} as const
