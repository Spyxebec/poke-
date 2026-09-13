import { useEffect, useRef, useState } from 'react';
import { memeVideoRef } from '../game/memeRef';

interface KoMemeProps {
  visible: boolean;
  src: string;
  onEnded?: () => void;
}

export function KoMeme({ visible, src, onEnded }: KoMemeProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevVisible = useRef(false);
  const [opacity, setOpacity] = useState(0);

  // If src is empty string, call onEnded immediately when active and do not render video
  useEffect(() => {
    if (!src && visible) {
      onEnded?.();
    }
  }, [src, visible, onEnded]);

  useEffect(() => {
    if (!src) return;
    const video = videoRef.current;
    if (!video) return;

    const wasVisible = prevVisible.current;
    if (visible === wasVisible) return;
    prevVisible.current = visible;

    // Rising edge: false -> true
    if (visible && !wasVisible) {
      if (video.paused) {
        video.currentTime = 0;
        video.volume = 1.0;
        video.muted = false;
        video.play().catch((err) => console.warn('[meme] play blocked:', err));
      }
      setOpacity(1);
    }

    // Falling edge: true -> false
    if (!visible && wasVisible) {
      setOpacity(0);
      const t = setTimeout(() => {
        video.pause();
        video.currentTime = 0;
      }, 250);
      return () => clearTimeout(t);
    }
  }, [visible, src]);

  if (!src) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <video
        key={src}
        ref={(el) => {
          videoRef.current = el;
          memeVideoRef.current = el;
        }}
        src={src}
        playsInline
        preload="auto"
        onEnded={() => {
          console.log('[meme] ended');
          onEnded?.();
        }}
        onError={(e) => {
          console.warn('[meme] error:', e);
          onEnded?.(); // fail-safe so the game doesn't hang
        }}
        style={{
          maxWidth: '60vw',
          maxHeight: '60vh',
          objectFit: 'contain',
          opacity,
          transition: 'opacity 200ms ease-out',
        }}
      />
    </div>
  );
}
