import { db, setPref } from './db'
import { addDays, isoDate, weekday } from './dates'

/** Fills the app with a believable semester so a new user can see everything working. */
export async function loadSample() {
  const today = isoDate()
  const start = addDays(today, -35), end = addDays(today, 56)
  const subs = [
    { name: 'Computer Networks', target: 75, kind: 'theory', weight: 2, rate: 0.78 },
    { name: 'Java Programming', target: 75, kind: 'theory', weight: 2, rate: 0.9 },
    { name: 'Pattern Recognition', target: 75, kind: 'theory', weight: 3, rate: 0.82 },
    { name: 'Engineering Maths', target: 75, kind: 'theory', weight: 1, rate: 0.96 },
    { name: 'Java Lab', target: 75, kind: 'lab', weight: 2, rate: 0.85 },
  ] as const
  const ids: number[] = []
  for (const s of subs) ids.push((await db.subjects.add({ name: s.name, target: s.target, kind: s.kind, weight: s.weight } as never)) as number)
  const t = [
    [1, 0, '09:00', '10:00'], [1, 1, '10:00', '11:00'], [1, 3, '09:00', '10:00'], [1, 4, '10:00', '11:00'],
    [2, 0, '11:00', '12:00'], [2, 2, '09:00', '10:00'], [2, 3, '11:00', '12:00'],
    [3, 1, '09:00', '10:00'], [3, 3, '12:00', '13:00'], [3, 4, '09:00', '10:00'],
    [4, 0, '10:00', '11:00'], [4, 2, '10:00', '11:00'], [4, 4, '11:00', '12:00'],
  ] as const
  const slotIds: { id: number; subjectIdx: number; day: number }[] = []
  for (const [si, day, a, b] of t) {
    const idx = si - 1
    slotIds.push({ id: (await db.slots.add({ subjectId: ids[idx], day, start: a, end: b } as never)) as number, subjectIdx: idx, day })
  }
  slotIds.push({ id: (await db.slots.add({ subjectId: ids[4], day: 2, start: '14:00', end: '17:00' } as never)) as number, subjectIdx: 4, day: 2 })
  // past attendance, deterministic so the demo is stable
  for (let d = start; d < today; d = addDays(d, 1)) {
    const wd = weekday(d)
    for (const s of slotIds.filter((x) => x.day === wd - 0)) {
      const n = d.split('-').join('') + s.id
      const h = [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000, 7) / 1000
      await db.records.add({ slotId: s.id, subjectId: ids[s.subjectIdx], date: d, status: h < subs[s.subjectIdx].rate ? 'present' : 'absent' } as never)
    }
  }
  await db.holidays.add({ date: addDays(today, 12), name: 'Diwali break' } as never)
  await db.holidays.add({ date: addDays(today, 13), name: 'Diwali break' } as never)
  await db.exams.add({ subject: 'Computer Networks', title: 'CIE-3', date: addDays(today, 9), topics: ['Subnetting', 'Routing algorithms', 'TCP congestion control', 'Application layer'].map((name) => ({ name, done: false })) } as never)
  await db.tasks.add({ title: 'Java lab record, programs 5 to 8', subjectId: ids[4], due: addDays(today, 3), done: false, kind: 'lab record' } as never)
  await db.tasks.add({ title: 'Maths assignment 2', subjectId: ids[3], due: addDays(today, 6), done: false, kind: 'assignment' } as never)
  await db.assessments.add({ subjectId: ids[0], title: 'CIE-1', score: 17, max: 25, weight: 25 } as never)
  await db.assessments.add({ subjectId: ids[0], title: 'CIE-2', score: 21, max: 25, weight: 25 } as never)
  await setPref('semStart', start); await setPref('semEnd', end); await setPref('target', 75); await setPref('buffer', 1)
}
