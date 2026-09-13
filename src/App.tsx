import { AnimatePresence, motion } from 'framer-motion'
import { Camera } from './components/Camera'
import { HUD } from './components/HUD'
import { usePhase, useGameStore } from './game/state'
import { MEME_CLIPS } from './game/memes'

export function App() {
  const phase = usePhase()
  const startBattle = useGameStore((state) => state.startBattle)
  const startTraining = useGameStore((state) => state.startTraining)
  const mode = useGameStore((state) => state.mode)

  const handleStartBattle = () => {
    const a = new Audio('/sfx/hit.mp3')
    a.volume = 0
    a.play().then(() => { a.pause() }).catch(() => {})

    const sample = MEME_CLIPS[0]
    if (sample) {
      const unlock = new Audio(sample)
      unlock.volume = 0
      unlock.play().then(() => {
        unlock.pause()
        unlock.currentTime = 0
      }).catch(() => {})
    }

    console.log('[App] Start Battle clicked: IDLE -> BATTLE')
    startBattle()
  }

  const handleStartTraining = () => {
    const a = new Audio('/sfx/hit.mp3')
    a.volume = 0
    a.play().then(() => { a.pause() }).catch(() => {})

    const sample = MEME_CLIPS[0]
    if (sample) {
      const unlock = new Audio(sample)
      unlock.volume = 0
      unlock.play().then(() => {
        unlock.pause()
        unlock.currentTime = 0
      }).catch(() => {})
    }

    console.log('[App] Start Training clicked: IDLE -> TRAINING')
    startTraining()
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Background Camera & Pose Overlay */}
      <Camera />

      {/* Win Overlay */}
      <HUD />

      {/* IDLE Phase: Start Screen & Start Battle Button */}
      <AnimatePresence>
        {phase === 'IDLE' && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] z-20"
          >
            <div className="flex flex-col items-center p-8 bg-zinc-950/85 border border-white/10 rounded-2xl shadow-2xl max-w-sm text-center">
              <h1 className="text-3xl font-extrabold text-white tracking-wider mb-2 drop-shadow">
                PokéBattle AR
              </h1>
              <p className="text-zinc-400 text-xs mb-6 leading-relaxed">
                Stand in front of the camera:
                <br />
                <span className="text-cyan-400 font-semibold">Left = Player 1</span>
                {' • '}
                <span className="text-amber-400 font-semibold">Right = Player 2</span>
              </p>
              <div className="flex gap-3 w-full">
                <button
                  id="start-battle-button"
                  onClick={handleStartBattle}
                  className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold rounded-xl shadow-lg shadow-red-600/30 transition duration-150 cursor-pointer text-sm uppercase tracking-wider"
                >
                  Battle
                </button>
                <button
                  id="start-training-button"
                  onClick={handleStartTraining}
                  className="flex-1 px-6 py-3 bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-bold rounded-xl shadow-lg shadow-violet-600/30 transition duration-150 cursor-pointer text-sm uppercase tracking-wider"
                >
                  Training
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BATTLE Phase Indicator */}
      {phase === 'BATTLE' && mode === 'BATTLE' && (
        <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono tracking-wide shadow-md">
          ● BATTLE ACTIVE
        </div>
      )}
      {phase === 'BATTLE' && mode === 'TRAINING' && (
        <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full bg-violet-950/80 border border-violet-500/40 text-violet-300 text-xs font-mono tracking-wide shadow-md">
          ● TRAINING MODE
        </div>
      )}
    </div>
  )
}

export default App
