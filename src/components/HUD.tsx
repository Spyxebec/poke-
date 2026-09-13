import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../game/state'
import { KoMeme } from './KoMeme'

export function HUD() {
  const phase = useGameStore((state) => state.phase)
  const mode = useGameStore((state) => state.mode)
  const winner = useGameStore((state) => state.winner)
  const showWinOverlay = useGameStore((state) => state.showWinOverlay)
  const koStartedAt = useGameStore((state) => state.koStartedAt)
  const memeFinished = useGameStore((state) => state.memeFinished)
  const markMemeFinished = useGameStore((state) => state.markMemeFinished)
  const activeMemePath = useGameStore((state) => state.activeMemePath)
  const reset = useGameStore((state) => state.reset)

  const [now, setNow] = useState(Date.now())
  const [memeActive, setMemeActive] = useState(false)

  useEffect(() => {
    if (phase !== 'GAME_OVER') return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [phase])

  // Effect that turns memeActive ON when the KO window opens
  useEffect(() => {
    if (phase !== 'GAME_OVER' || koStartedAt === 0) {
      setMemeActive(false)
      return
    }
    const elapsed = Date.now() - koStartedAt
    if (elapsed >= 600 && !memeActive && !memeFinished) {
      setMemeActive(true)
    }
  }, [phase, koStartedAt, now, memeFinished, memeActive])

  // Effect that turns memeActive OFF when memeFinished becomes true
  useEffect(() => {
    if (memeFinished) setMemeActive(false)
  }, [memeFinished])

  const handleReset = () => {
    setMemeActive(false)
    reset()
  }

  return (
    <>
      <KoMeme
        visible={memeActive}
        src={activeMemePath}
        onEnded={() => {
          markMemeFinished()
        }}
      />
      <AnimatePresence>
        {phase === 'GAME_OVER' && showWinOverlay && memeFinished && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1.0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center justify-center gap-8"
          >
            <h1 className="text-6xl font-bold text-white drop-shadow-lg">
              {mode === 'TRAINING' ? 'DUMMY K.O.!' : `PLAYER ${winner} WINS`}
            </h1>
            <motion.button
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.1 }}
              onClick={handleReset}
              className="bg-white text-black px-8 py-4 rounded-lg font-bold text-xl hover:bg-gray-200 transition-colors cursor-pointer"
            >
              {mode === 'TRAINING' ? 'Respawn Dummy' : 'Restart'}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default HUD
