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
    staminaCost: 20,
    sfx: '/sfx/fire.mp3',
  },
  PUNCH: {
    id: 'PUNCH',
    name: 'Punch',
    damage: 10,
    cooldownMs: 1000,
    staminaCost: 12,
    sfx: '/sfx/tackle.mp3', // TODO: rename sfx file to punch.mp3
  },
  BLOCK: {
    id: 'BLOCK',
    name: 'Block',
    damage: 0,
    cooldownMs: 3000,
    staminaCost: 25,
    sfx: '/sfx/block.mp3',
  },
  HEAL: {
    id: 'HEAL',
    name: 'Heal',
    damage: -10,
    cooldownMs: 5000,
    staminaCost: 35,
    sfx: '/sfx/heal.mp3',
  },
} as const
