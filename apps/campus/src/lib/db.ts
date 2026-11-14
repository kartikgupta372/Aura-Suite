import Dexie, { type EntityTable } from 'dexie'
export { isoDate, addDays } from './dates'

export interface Subject { id: number; name: string; target: number; kind?: 'theory' | 'lab'; weight?: 1 | 2 | 3; totalMarks?: number; goalPct?: number }
export interface Slot { id: number; subjectId: number; day: number; start: string; end: string; room?: string }
export type Status = 'present' | 'absent' | 'cancelled'
export interface AttRecord { id: number; slotId: number; subjectId: number; date: string; status: Status }
export interface Topic { name: string; done: boolean }
export interface Exam { id: number; subject: string; title: string; date: string; topics: Topic[] }
/** A viva question with the key points a good answer must cover. box 1..5 is the Leitner box. */
export interface VivaCard { id: number; question: string; points: string[]; box: number; due: string }
export interface Focus { id: number; date: string; minutes: number }
export interface Holiday { id: number; date: string; name: string }
export type TaskKind = 'assignment' | 'lab record' | 'project' | 'other'
export interface Task { id: number; title: string; subjectId?: number; due: string; done: boolean; kind: TaskKind }
export interface Assessment { id: number; subjectId: number; title: string; score: number | null; max: number; weight: number }
export interface Grade { id: number; name: string; credits: number; gp: number }
export interface Setting { key: string; value: string }

class CampusDB extends Dexie {
  subjects!: EntityTable<Subject, 'id'>
  slots!: EntityTable<Slot, 'id'>
  records!: EntityTable<AttRecord, 'id'>
  exams!: EntityTable<Exam, 'id'>
  viva!: EntityTable<VivaCard, 'id'>
  focus!: EntityTable<Focus, 'id'>
  holidays!: EntityTable<Holiday, 'id'>
  tasks!: EntityTable<Task, 'id'>
  assessments!: EntityTable<Assessment, 'id'>
  grades!: EntityTable<Grade, 'id'>
  settings!: EntityTable<Setting, 'key'>
  constructor() {
    super('aura-campus')
    this.version(1).stores({ subjects: '++id', slots: '++id, subjectId, day', records: '++id, [slotId+date], subjectId, date', exams: '++id, date' })
    this.version(2).stores({ viva: '++id, due', focus: '++id, date' })
    this.version(3).stores({ holidays: '++id, date', tasks: '++id, due', assessments: '++id, subjectId', grades: '++id', settings: 'key' })
  }
}
export const db = new CampusDB()

export interface Prefs { semStart: string; semEnd: string; target: number; buffer: number; prevCgpa: number; prevCredits: number }
export const DEFAULT_PREFS: Prefs = { semStart: '', semEnd: '', target: 75, buffer: 1, prevCgpa: 0, prevCredits: 0 }
export const prefsFrom = (rows: Setting[]): Prefs => {
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    semStart: m.semStart ?? '', semEnd: m.semEnd ?? '', target: +(m.target ?? 75), buffer: +(m.buffer ?? 1),
    prevCgpa: +(m.prevCgpa ?? 0), prevCredits: +(m.prevCredits ?? 0),
  }
}
export const setPref = (key: keyof Prefs, value: string | number) => db.settings.put({ key, value: String(value) })

/** Everything the planner needs, with defaults filled in for subjects made before the new fields existed. */
export const lite = (s: Subject) => ({ id: s.id, name: s.name, target: s.target, kind: s.kind ?? 'theory', weight: (s.weight ?? 2) as 1 | 2 | 3 })
