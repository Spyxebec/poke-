import { useGameStore } from '../game/state'

export function HUD() {
  const phase = useGameStore((state) => state.phase)
  const winner = useGameStore((state) => state.winner)
  const reset = useGameStore((state) => state.reset)

  if (phase !== 'GAME_OVER') {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center justify-center gap-8">
      <h1 className="text-6xl font-bold text-white drop-shadow-lg">
        PLAYER {winner} WINS
      </h1>
      <button
        onClick={reset}
        className="bg-white text-black px-8 py-4 rounded-lg font-bold text-xl hover:bg-gray-200 transition cursor-pointer"
      >
        Restart
      </button>
    </div>
  )
}

export default HUD
