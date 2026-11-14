import { DAYS } from './dates'

export interface ScannedClass { day: number; start: string; end: string; subject: string; kind: 'theory' | 'lab'; room?: string }

/** Shrinks a phone photo so it uploads quickly and fits the server limit. */
export async function shrink(file: File, maxSide = 1800): Promise<{ data: string; mime: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', 0.85)
  return { data: url.split(',')[1], mime: 'image/jpeg' }
}

const hhmm = (s: string) => {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(s).trim())
  if (!m) return null
  const h = +m[1], mi = +m[2]
  return h > 23 || mi > 59 ? null : `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/** Cleans whatever the scanner returned: valid days and times, trimmed names, no duplicates. */
export function cleanScan(raw: unknown[]): ScannedClass[] {
  const seen = new Set<string>()
  const out: ScannedClass[] = []
  for (const r of raw as Partial<ScannedClass>[]) {
    const day = Number(r.day), start = hhmm(r.start ?? ''), end = hhmm(r.end ?? ''), subject = String(r.subject ?? '').trim()
    if (!(day >= 0 && day <= 6) || !start || !end || end <= start || !subject) continue
    const k = `${day}|${start}|${subject.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ day, start, end, subject, kind: r.kind === 'lab' ? 'lab' : 'theory', room: r.room?.trim() || undefined })
  }
  return out.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
}

export const dayName = (d: number) => DAYS[d]

export async function scanTimetable(file: File): Promise<{ classes: ScannedClass[]; notes: string }> {
  const { data, mime } = await shrink(file)
  const r = await fetch('/api/scan-timetable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: data, mime }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || 'The scan did not work. Try again or enter the timetable by hand.')
  return { classes: cleanScan(body.classes ?? []), notes: body.notes ?? '' }
}
