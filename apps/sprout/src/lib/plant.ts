/** Plant stage from stars: 0 seed, 1 sprout, 2 small plant, 3 bushy, 4 flowering. */
export const STAGES = [0, 3, 8, 15, 25]
export const stageOf = (stars: number) => STAGES.reduce((s, t, i) => (stars >= t ? i : s), 0)
export const starsToNext = (stars: number) => { const s = stageOf(stars); return s >= STAGES.length - 1 ? 0 : STAGES[s + 1] - stars }
