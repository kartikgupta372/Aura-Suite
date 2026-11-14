export const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)

export interface ReadResult { hit: boolean[]; score: number }

/** Marks each expected word as read if it appears in the heard words, in order (skipping extra words). */
export function matchReading(expected: string, heard: string): ReadResult {
  const exp = words(expected)
  const got = words(heard)
  const hit = exp.map(() => false)
  let g = 0
  exp.forEach((w, i) => {
    const at = got.indexOf(w, g)
    if (at !== -1) { hit[i] = true; g = at + 1 }
  })
  return { hit, score: exp.length ? hit.filter(Boolean).length / exp.length : 0 }
}
