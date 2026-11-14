import { addDays } from './db'

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'and', 'it', 'that', 'for', 'on', 'with', 'as', 'by', 'be'])

/** A key point counts as covered when most of its meaningful words appear in the answer. */
export function coverage(points: string[], answer: string) {
  const said = new Set(norm(answer))
  const results = points.map((p) => {
    const w = norm(p).filter((x) => !STOP.has(x))
    if (w.length === 0) return { point: p, covered: false }
    const hits = w.filter((x) => said.has(x)).length
    return { point: p, covered: hits / w.length >= 0.6 }
  })
  const got = results.filter((r) => r.covered).length
  return { results, score: points.length ? got / points.length : 0 }
}

export const INTERVALS = [0, 1, 3, 7, 14]
/** Good answer moves up a box (longer gap); a miss goes back to box 1 and is due tomorrow. */
export function review(box: number, good: boolean, today: string) {
  const next = good ? Math.min(5, box + 1) : 1
  return { box: next, due: addDays(today, Math.max(1, INTERVALS[next - 1])) }
}
