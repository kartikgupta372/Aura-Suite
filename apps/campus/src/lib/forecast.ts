import { addDays, eachDay, weekday } from './dates'

export interface SubjectLite { id: number; name: string; target: number; kind: 'theory' | 'lab'; weight: 1 | 2 | 3 }
export interface SlotLite { id: number; subjectId: number; day: number; start: string; end: string }
export interface RecLite { subjectId: number; slotId: number; date: string; status: 'present' | 'absent' | 'cancelled' }
export interface Occ { date: string; slotId: number; subjectId: number; start: string; end: string }

/** Classes still to happen between from and to (inclusive): timetable slots on non-holiday dates, minus ones already marked. */
export function occurrences(slots: SlotLite[], recs: RecLite[], from: string, to: string, holidays: Set<string>): Occ[] {
  const marked = new Set(recs.map((r) => `${r.slotId}|${r.date}`))
  const out: Occ[] = []
  for (const date of eachDay(from, to)) {
    if (holidays.has(date)) continue
    const wd = weekday(date)
    for (const s of slots) if (s.day === wd && !marked.has(`${s.id}|${date}`)) out.push({ date, slotId: s.id, subjectId: s.subjectId, start: s.start, end: s.end })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}

export interface Forecast {
  attended: number; total: number; remaining: number
  /** classes you must still attend to finish at the target */
  minAttend: number
  /** classes you can still miss (0 when the target is out of reach or tight) */
  skipBudget: number
  /** target can no longer be reached even by attending everything */
  impossible: boolean
  nowPct: number
  /** final % if you attend every remaining class */
  bestPct: number
  /** final % if you follow the plan with exactly skipBudget misses */
  floorPct: number
}

export function forecast(subject: SubjectLite, recs: RecLite[], remaining: number): Forecast {
  const mine = recs.filter((r) => r.subjectId === subject.id && r.status !== 'cancelled')
  const A = mine.filter((r) => r.status === 'present').length
  const T = mine.length
  const t = Math.min(Math.max(subject.target, 1), 99) / 100
  const minAttend = Math.max(0, Math.ceil(t * (T + remaining) - A - 1e-9))
  const impossible = minAttend > remaining
  const denom = T + remaining
  return {
    attended: A, total: T, remaining, minAttend, impossible,
    skipBudget: impossible ? 0 : remaining - minAttend,
    nowPct: T === 0 ? 100 : (A / T) * 100,
    bestPct: denom === 0 ? 100 : ((A + remaining) / denom) * 100,
    floorPct: denom === 0 ? 100 : ((A + (impossible ? remaining : minAttend)) / denom) * 100,
  }
}

export interface Plan {
  /** key `${date}|${slotId}` -> why it is safe to skip */
  skips: Map<string, 'day' | 'single'>
  freeDays: string[]
  forecasts: Map<number, Forecast>
  /** budget left per subject after the suggested skips */
  left: Map<number, number>
}

export interface PlanOpts { buffer?: number; includeLabs?: boolean; includeImportant?: boolean }

/**
 * Suggests which upcoming classes to skip. A reserve (buffer) of classes per subject is always kept for illness and surprises.
 * First picks whole days that can be freed (best value: most classes freed for least importance, with a bonus when it joins a weekend or holiday),
 * then a few single classes from the least important theory subjects.
 */
export function planSkips(subjects: SubjectLite[], slots: SlotLite[], recs: RecLite[], from: string, to: string, holidays: Set<string>, opts: PlanOpts = {}): Plan {
  const buffer = opts.buffer ?? 1
  const occ = occurrences(slots, recs, from, to, holidays)
  const forecasts = new Map<number, Forecast>()
  const left = new Map<number, number>()
  for (const s of subjects) {
    const f = forecast(s, recs, occ.filter((o) => o.subjectId === s.id).length)
    forecasts.set(s.id, f)
    left.set(s.id, Math.max(0, f.skipBudget - buffer))
  }
  const sub = new Map(subjects.map((s) => [s.id, s]))
  const eligible = (subjectId: number) => {
    const s = sub.get(subjectId)
    if (!s) return false
    if (s.kind === 'lab' && !opts.includeLabs) return false
    if (s.weight >= 3 && !opts.includeImportant) return false
    return true
  }
  const byDate = new Map<string, Occ[]>()
  for (const o of occ) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])

  const skips = new Map<string, 'day' | 'single'>()
  const freeDays: string[] = []
  const dates = [...byDate.keys()]
  const taken = new Set<string>()

  for (;;) {
    let best: { date: string; value: number } | null = null
    for (const date of dates) {
      if (taken.has(date)) continue
      const day = byDate.get(date)!
      if (!day.every((o) => eligible(o.subjectId))) continue
      const need = new Map<number, number>()
      for (const o of day) need.set(o.subjectId, (need.get(o.subjectId) ?? 0) + 1)
      if ([...need].some(([id, n]) => (left.get(id) ?? 0) < n)) continue
      const cost = day.reduce((s, o) => s + (sub.get(o.subjectId)?.weight ?? 1), 0)
      const joins = [addDays(date, -1), addDays(date, 1)].some((d) => !byDate.has(d))
      const value = day.length / cost + (joins ? 0.5 : 0)
      if (!best || value > best.value + 1e-9) best = { date, value }
    }
    if (!best) break
    taken.add(best.date)
    freeDays.push(best.date)
    for (const o of byDate.get(best.date)!) {
      skips.set(`${o.date}|${o.slotId}`, 'day')
      left.set(o.subjectId, (left.get(o.subjectId) ?? 0) - 1)
    }
  }

  const singles = occ
    .filter((o) => !skips.has(`${o.date}|${o.slotId}`) && eligible(o.subjectId))
    .sort((a, b) => (sub.get(a.subjectId)!.weight - sub.get(b.subjectId)!.weight) || a.date.localeCompare(b.date))
  for (const o of singles) {
    if ((left.get(o.subjectId) ?? 0) > 0) {
      skips.set(`${o.date}|${o.slotId}`, 'single')
      left.set(o.subjectId, (left.get(o.subjectId) ?? 0) - 1)
    }
  }
  freeDays.sort()
  return { skips, freeDays, forecasts, left }
}

export interface WhatIfRow { subjectId: number; classes: number; budgetAfter: number; verdict: 'safe' | 'tight' | 'danger' }
/** What happens to each subject if you skip every class on one date. */
export function whatIf(subjects: SubjectLite[], slots: SlotLite[], recs: RecLite[], from: string, to: string, holidays: Set<string>, date: string, buffer = 1): WhatIfRow[] {
  const occ = occurrences(slots, recs, from, to, holidays)
  const rows: WhatIfRow[] = []
  for (const s of subjects) {
    const n = occ.filter((o) => o.subjectId === s.id && o.date === date).length
    if (n === 0) continue
    const f = forecast(s, recs, occ.filter((o) => o.subjectId === s.id).length)
    const after = f.impossible ? -n : f.skipBudget - n
    rows.push({ subjectId: s.id, classes: n, budgetAfter: after, verdict: after < 0 ? 'danger' : after < buffer ? 'tight' : 'safe' })
  }
  return rows
}
