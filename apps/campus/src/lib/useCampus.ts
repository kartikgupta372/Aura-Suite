import { useLiveQuery } from 'dexie-react-hooks'
import { db, lite, prefsFrom } from './db'
import { isoDate } from './dates'
import { planSkips, occurrences } from './forecast'

/** One live view of the whole student record. Returns undefined until it has loaded. */
export function useCampus() {
  return useLiveQuery(async () => {
    const [subjects, slots, records, holidays, exams, tasks, settings] = await Promise.all([
      db.subjects.toArray(), db.slots.toArray(), db.records.toArray(), db.holidays.toArray(), db.exams.toArray(), db.tasks.toArray(), db.settings.toArray(),
    ])
    const prefs = prefsFrom(settings)
    const today = isoDate()
    const hol = new Set(holidays.map((h) => h.date))
    const lites = subjects.map(lite)
    const ready = !!prefs.semEnd && prefs.semEnd >= today
    const plan = ready ? planSkips(lites, slots, records, today, prefs.semEnd, hol, { buffer: prefs.buffer }) : null
    const upcoming = ready ? occurrences(slots, records, today, prefs.semEnd, hol) : []
    return { subjects, slots, records, holidays, exams, tasks, prefs, today, hol, lites, ready, plan, upcoming }
  })
}
export type Campus = NonNullable<ReturnType<typeof useCampus>>
