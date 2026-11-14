import { forecast, occurrences, planSkips, whatIf, type SubjectLite, type SlotLite, type RecLite } from './forecast'
import { sgpa, cgpa, marksStanding } from './grades'

const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: got ${a}, want ${b}`) }
const near = (a: number, b: number, m: string) => { if (Math.abs(a - b) > 0.01) throw new Error(`${m}: got ${a}, want ${b}`) }

// 2026-11-16 is a Monday
const subs: SubjectLite[] = [
  { id: 1, name: 'CN', target: 75, kind: 'theory', weight: 2 },
  { id: 2, name: 'Java Lab', target: 75, kind: 'lab', weight: 2 },
  { id: 3, name: 'Maths', target: 75, kind: 'theory', weight: 1 },
  { id: 4, name: 'Core', target: 75, kind: 'theory', weight: 3 },
]
const slots: SlotLite[] = [
  { id: 10, subjectId: 1, day: 1, start: '09:00', end: '10:00' }, // Mon CN
  { id: 11, subjectId: 3, day: 1, start: '10:00', end: '11:00' }, // Mon Maths
  { id: 12, subjectId: 2, day: 2, start: '09:00', end: '12:00' }, // Tue Lab
  { id: 13, subjectId: 3, day: 3, start: '09:00', end: '10:00' }, // Wed Maths
  { id: 14, subjectId: 4, day: 4, start: '09:00', end: '10:00' }, // Thu Core
  { id: 15, subjectId: 1, day: 5, start: '09:00', end: '10:00' }, // Fri CN
]
const rec = (subjectId: number, present: number, absent: number): RecLite[] =>
  [...Array(present).fill(0).map((_, i) => ({ subjectId, slotId: 0, date: `2026-09-${String(i + 1).padStart(2, '0')}`, status: 'present' as const })),
   ...Array(absent).fill(0).map((_, i) => ({ subjectId, slotId: 0, date: `2026-08-${String(i + 1).padStart(2, '0')}`, status: 'absent' as const }))]

// occurrences: 3 weeks Mon 16 Nov .. Sun 6 Dec, one holiday on Wed 18 Nov
const hol = new Set(['2026-11-18'])
const occ = occurrences(slots, [], '2026-11-16', '2026-12-06', hol)
eq(occ.length, 17, 'count') // 6 slots a week for 3 weeks, minus Wednesday Maths on the holiday
// forecast: 18 present of 20, 20 more classes: need 75% of 40 = 30 -> must attend 12, can skip 8
const f = forecast({ id: 1, name: 'X', target: 75, kind: 'theory', weight: 1 }, rec(1, 18, 2), 20)
eq(f.minAttend, 12, 'minAttend'); eq(f.skipBudget, 8, 'skipBudget'); eq(f.impossible, false, 'possible')
// impossible: 5 of 20, 5 left -> best case 10/25 = 40%
const g = forecast({ id: 1, name: 'X', target: 75, kind: 'theory', weight: 1 }, rec(1, 5, 15), 5)
eq(g.impossible, true, 'impossible'); near(g.bestPct, 40, 'best'); eq(g.skipBudget, 0, 'no budget')
// already-marked classes are not counted as remaining
eq(occurrences(slots, [{ subjectId: 1, slotId: 10, date: '2026-11-16', status: 'present' }], '2026-11-16', '2026-11-16', new Set()).filter((o) => o.slotId === 10).length, 0, 'marked')

// plan: Maths has loads of slack, others at target; labs and weight-3 are never suggested
const recs = [...rec(1, 15, 5), ...rec(2, 10, 10), ...rec(3, 19, 1), ...rec(4, 15, 5)]
const plan = planSkips(subs, slots, recs, '2026-11-16', '2026-12-06', hol, { buffer: 1 })
for (const k of plan.skips.keys()) { const sid = +(k.split('|')[1]) ; if (sid === 12 || sid === 14) throw new Error('lab or core skipped ' + k) }
if (plan.skips.size === 0) throw new Error('expected some skip suggestions for Maths')
// never exceeds budget
for (const s of subs) { if ((plan.left.get(s.id) ?? 0) < 0) throw new Error('budget overrun ' + s.name) }
// whatIf on Monday: CN is tight, Maths is fine
const w = whatIf(subs, slots, recs, '2026-11-16', '2026-12-06', hol, '2026-11-16', 1)
eq(w.length, 2, 'monday has 2 subjects')

near(sgpa([{ credits: 4, gp: 9 }, { credits: 3, gp: 8 }, { credits: 2, gp: 10 }]), (36 + 24 + 20) / 9, 'sgpa')
near(cgpa(8, 20, [{ credits: 10, gp: 9 }]), (160 + 90) / 30, 'cgpa')
// marks: 100 total, goal 60%; earned 20/30 on a 30 weight test -> 20 earned; remaining 70; need 40/70 = 57.1%
let m = marksStanding([{ score: 20, max: 30, weight: 30 }], 100, 60)
near(m.neededPct!, (40 / 70) * 100, 'needed'); eq(m.status, 'possible', 'status')
m = marksStanding([{ score: 29, max: 30, weight: 30 }], 100, 25); eq(m.status, 'reached', 'reached')
m = marksStanding([{ score: 3, max: 30, weight: 30 }], 100, 90); eq(m.status, 'out-of-reach', 'out')
console.log('planner logic OK')
