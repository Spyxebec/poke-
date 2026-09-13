export const MEME_CLIPS: readonly string[] = [
  '/memes/ko_meme_1.mp4',
  '/memes/ko_meme_2.mp4',
  '/memes/ko_meme_3.mp4',
  // add more here as you add files to public/memes/
];

export function pickRandomMeme(): string {
  if (MEME_CLIPS.length === 0) return '';
  const i = Math.floor(Math.random() * MEME_CLIPS.length);
  return MEME_CLIPS[i];
}
