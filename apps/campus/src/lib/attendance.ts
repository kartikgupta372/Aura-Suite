import type { AttRecord } from './db'

export interface Standing {
  attended: number
  total: number
  pct: number
  /** classes you can still miss and stay at or above target */
  canSkip: number
  /** consecutive classes you must attend to get back to target (0 when safe) */
  mustAttend: number
}

/** Cancelled classes never count. Present counts for attended and total, absent for total only. */
export function standing(records: Pick<AttRecord, 'status'>[], target: number): Standing {
  const counted = records.filter((r) => r.status !== 'cancelled')
  const attended = counted.filter((r) => r.status === 'present').length
  const total = counted.length
  const t = Math.min(Math.max(target, 1), 99) / 100
  const pct = total === 0 ? 100 : (attended / total) * 100
  const canSkip = total === 0 ? 0 : Math.max(0, Math.floor(attended / t - total + 1e-9))
  const mustAttend =
    total === 0 || attended / total >= t ? 0 : Math.ceil((t * total - attended) / (1 - t) - 1e-9)
  return { attended, total, pct, canSkip, mustAttend }
}

export function tone(s: Standing, target: number): 'safe' | 'edge' | 'danger' {
  if (s.total === 0) return 'safe'
  if (s.pct < target) return 'danger'
  return s.canSkip === 0 ? 'edge' : 'safe'
}
