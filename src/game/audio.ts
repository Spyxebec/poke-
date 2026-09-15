const createAudio = (src: string): HTMLAudioElement => {
  if (typeof Audio !== 'undefined') {
    return new Audio(src)
  }
  return {} as HTMLAudioElement
}

export const AUDIO = {
  fire: createAudio('/sfx/fire.mp3'),
  punch: createAudio('/sfx/tackle.mp3'), // TODO: rename sfx file to punch.mp3
  block: createAudio('/sfx/block.mp3'),
  heal: createAudio('/sfx/heal.mp3'),
  hit: createAudio('/sfx/hit.mp3'),
  win: createAudio('/sfx/win.mp3'),
}

// Preload at module load
Object.values(AUDIO).forEach((a) => {
  if (typeof a.load === 'function') {
    a.preload = 'auto'
    a.volume = 0.5
    a.load()
  }
})

export function playSfx(key: keyof typeof AUDIO) {
  const a = AUDIO[key]
  if (!a || typeof a.play !== 'function') return
  a.currentTime = 0
  a.play().catch(() => {}) // ignore autoplay block
}
