import { AnimatePresence, motion } from 'framer-motion'
import { Camera } from './components/Camera'
import { HUD } from './components/HUD'
import { usePhase, useGameStore } from './game/state'

export function App() {
  const phase = usePhase()
  const startBattle = useGameStore((state) => state.startBattle)

  const handleStartBattle = () => {
    const a = new Audio('/sfx/hit.mp3')
    a.volume = 0
    a.play().then(() => { a.pause() }).catch(() => {})
    console.log('[App] Start Battle clicked: IDLE -> BATTLE')
    startBattle()
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
              <button
                id="start-battle-button"
                onClick={handleStartBattle}
                className="px-8 py-3 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold rounded-xl shadow-lg shadow-red-600/30 transition duration-150 cursor-pointer text-base uppercase tracking-wider"
              >
                Start Battle
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BATTLE Phase Indicator */}
      {phase === 'BATTLE' && (
        <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono tracking-wide shadow-md">
          ● BATTLE ACTIVE
        </div>
      )}
    </div>
  )
}

export default App
