export interface Course { credits: number; gp: number }

/** Semester grade point average, weighted by credits. */
export function sgpa(courses: Course[]): number {
  const c = courses.reduce((s, x) => s + x.credits, 0)
  return c === 0 ? 0 : courses.reduce((s, x) => s + x.credits * x.gp, 0) / c
}
/** Cumulative GPA after adding this semester to earlier credits. */
export function cgpa(prevCgpa: number, prevCredits: number, courses: Course[]): number {
  const c = courses.reduce((s, x) => s + x.credits, 0)
  const total = prevCredits + c
  return total === 0 ? 0 : (prevCgpa * prevCredits + courses.reduce((s, x) => s + x.credits * x.gp, 0)) / total
}

export interface Assessment { score: number | null; max: number; weight: number }
export interface Standing { earned: number; done: number; remaining: number; neededPct: number | null; status: 'reached' | 'possible' | 'out-of-reach' | 'no-data' }

/**
 * Marks tracker. Each assessment counts `weight` marks toward a subject total of `totalMarks`.
 * Tells you what share of the remaining marks you need to reach goalPct overall.
 */
export function marksStanding(items: Assessment[], totalMarks: number, goalPct: number): Standing {
  const doneItems = items.filter((i) => i.score != null && i.max > 0)
  const earned = doneItems.reduce((s, i) => s + (i.score! / i.max) * i.weight, 0)
  const done = doneItems.reduce((s, i) => s + i.weight, 0)
  const remaining = Math.max(0, totalMarks - done)
  const goal = (goalPct / 100) * totalMarks
  if (done === 0) return { earned, done, remaining, neededPct: remaining > 0 ? (goal / remaining) * 100 : null, status: 'no-data' }
  const need = goal - earned
  if (need <= 0) return { earned, done, remaining, neededPct: 0, status: 'reached' }
  if (remaining <= 0) return { earned, done, remaining, neededPct: null, status: 'out-of-reach' }
  const pct = (need / remaining) * 100
  return { earned, done, remaining, neededPct: pct, status: pct > 100 ? 'out-of-reach' : 'possible' }
}
