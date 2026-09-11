import { useEffect, useCallback, useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { usePose, type PoseResult } from '../hooks/usePose'
import { usePlayerAssignment } from '../hooks/usePlayerAssignment'
import { Overlay } from './Overlay'
import type { PlayerAssignment } from '../hooks/usePlayerAssignment'
import { gameLoop, lastFireAt } from '../game/loop'
import { useGameStore } from '../game/state'

// Module-level state for async detection (STEP 1)
let latestResult: PoseResult | null = null
let detectionInFlight = false

/**
 * Fullscreen mirrored camera feed with pose skeleton overlay
 * and player assignment (P1 left, P2 right).
 */
export function Camera() {
  const { videoRef, status: camStatus, error: camError } = useCamera()
  const { status: poseStatus, error: poseError, detectForVideo } = usePose()
  const { assign } = usePlayerAssignment()

  const rafIdRef = useRef<number>(0)
  const [videoReady, setVideoReady] = useState(false)
  const [players, setPlayers] = useState<PlayerAssignment[]>([])
  const latestPlayersRef = useRef<PlayerAssignment[]>([])
  const lastProcessedResultRef = useRef<PoseResult | null>(null)

  // Start the detection loop once both camera and model are ready
  const startLoop = useCallback(() => {
    const video = videoRef.current
    if (!video || camStatus !== 'active' || poseStatus !== 'ready') return

    function loop() {
      const vid = videoRef.current
      if (vid && vid.readyState >= 2) {
        const now = performance.now()
        const hitstopUntil = useGameStore.getState().hitstopUntil

        if (Date.now() < hitstopUntil) {
          // Hitstop on damage:
          // skip pose detection inference this frame (still render everything
          // at last known positions)
          if (latestPlayersRef.current.length > 0) {
            gameLoop(latestPlayersRef.current, now)
            setPlayers([...latestPlayersRef.current])
          }
          rafIdRef.current = requestAnimationFrame(loop)
          return
        }

        if (!detectionInFlight) {
          detectionInFlight = true
          detectForVideo(vid, performance.now())
            .then((res) => {
              latestResult = res ?? null
              detectionInFlight = false
            })
            .catch(() => {
              detectionInFlight = false
            })
        }

        if (latestResult !== lastProcessedResultRef.current) {
          lastProcessedResultRef.current = latestResult
          latestPlayersRef.current = latestResult ? assign(latestResult) : []
        }

        // ALWAYS render with latestResult (even if null)
        gameLoop(latestPlayersRef.current, now)
        setPlayers([...latestPlayersRef.current])
      }

      rafIdRef.current = requestAnimationFrame(loop)
    }

    rafIdRef.current = requestAnimationFrame(loop)
  }, [videoRef, camStatus, poseStatus, detectForVideo, assign])

  useEffect(() => {
    startLoop()
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [startLoop])

  // Track when video element is actually playing
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onPlaying() {
      setVideoReady(true)
      if (video.videoWidth && video.videoHeight) {
        console.log(`[camera] ${video.videoWidth}x${video.videoHeight}`)
      }
    }

    video.addEventListener('playing', onPlaying)
    if (!video.paused && video.readyState >= 2) {
      setVideoReady(true)
      if (video.videoWidth && video.videoHeight) {
        console.log(`[camera] ${video.videoWidth}x${video.videoHeight}`)
      }
    }

    return () => {
      video.removeEventListener('playing', onPlaying)
    }
  }, [videoRef, camStatus])

  // Combine errors for display
  const errorMsg = camError || poseError

  // Derive display info for the badge
  const p1 = players.find(p => p.playerId === 1)
  const p2 = players.find(p => p.playerId === 2)

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden">
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover scale-x-[-1] ${
          camStatus === 'active' ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-500`}
        style={{ zIndex: 1 }}
      />

      {/* Skeleton overlay canvas with player labels and visual indicators */}
      {videoReady && (
        <Overlay
          videoEl={videoRef.current}
          players={players}
          lastFireAt={lastFireAt}
        />
      )}

      {/* Model loading indicator */}
      {camStatus === 'active' && poseStatus === 'loading' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-4 py-2">
          <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span className="text-white/70 text-xs tracking-wide">
            Loading pose model…
          </span>
        </div>
      )}

      {/* Player status badges */}
      {camStatus === 'active' && poseStatus === 'ready' && (
        <div className="absolute top-4 right-4 flex flex-col gap-1.5">
          <div className={`rounded-full px-3 py-1.5 backdrop-blur-sm text-xs font-mono ${
            p1 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-black/50 text-white/30'
          }`}>
            P1: {p1 ? '●' : '—'}
          </div>
          <div className={`rounded-full px-3 py-1.5 backdrop-blur-sm text-xs font-mono ${
            p2 ? 'bg-amber-500/20 text-amber-300' : 'bg-black/50 text-white/30'
          }`}>
            P2: {p2 ? '●' : '—'}
          </div>
        </div>
      )}

      {/* Loading state */}
      {(camStatus === 'requesting' || camStatus === 'idle') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
          <p className="text-white/70 text-sm tracking-wide">
            {camStatus === 'requesting'
              ? 'Requesting camera access…'
              : 'Initializing…'}
          </p>
        </div>
      )}

      {/* Error / denied state */}
      {(camStatus === 'denied' || camStatus === 'error' || poseStatus === 'error') && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-md rounded-2xl bg-red-950/80 border border-red-500/30 backdrop-blur-md p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
              <svg
                className="h-7 w-7 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                />
                <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} stroke="currentColor" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-red-300 mb-2">
              {camStatus === 'denied'
                ? 'Camera Access Denied'
                : poseStatus === 'error'
                  ? 'Pose Model Error'
                  : 'Camera Error'}
            </h2>
            <p className="text-red-200/80 text-sm leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-red-500/20 border border-red-500/40 px-6 py-2.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/30 hover:text-white cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
