import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../game/state'

export function HUD() {
  const phase = useGameStore((state) => state.phase)
  const winner = useGameStore((state) => state.winner)
  const reset = useGameStore((state) => state.reset)

  return (
    <AnimatePresence>
      {phase === 'GAME_OVER' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1.0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center justify-center gap-8"
        >
          <h1 className="text-6xl font-bold text-white drop-shadow-lg">
            PLAYER {winner} WINS
          </h1>
          <motion.button
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.1 }}
            onClick={reset}
            className="bg-white text-black px-8 py-4 rounded-lg font-bold text-xl hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Restart
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default HUD

