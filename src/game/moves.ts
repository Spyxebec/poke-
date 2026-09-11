import type { Move } from './state'

/**
 * Move definitions (SPEC §6 & Level 6 STEP A).
 * Only FIRE for Level 6.
 */
export const MOVES = {
  FIRE: {
    id: 'FIRE',
    name: 'Fire',
    damage: 15,
    cooldownMs: 2000,
    sfx: '/sfx/fire.mp3',
  },
} as const satisfies Record<string, Move>
