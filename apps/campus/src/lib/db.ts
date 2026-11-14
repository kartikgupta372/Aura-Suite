import Dexie, { type EntityTable } from 'dexie'

export interface Subject { id: number; name: string; target: number }
export interface Slot { id: number; subjectId: number; day: number; start: string; end: string }
export type Status = 'present' | 'absent' | 'cancelled'
export interface AttRecord { id: number; slotId: number; subjectId: number; date: string; status: Status }
export interface Topic { name: string; done: boolean }
export interface Exam { id: number; subject: string; title: string; date: string; topics: Topic[] }
/** A viva question with the key points a good answer must cover. box 1..5 is the Leitner box. */
export interface VivaCard { id: number; question: string; points: string[]; box: number; due: string }
export interface Focus { id: number; date: string; minutes: number }

class CampusDB extends Dexie {
  subjects!: EntityTable<Subject, 'id'>
  slots!: EntityTable<Slot, 'id'>
  records!: EntityTable<AttRecord, 'id'>
  exams!: EntityTable<Exam, 'id'>
  viva!: EntityTable<VivaCard, 'id'>
  focus!: EntityTable<Focus, 'id'>
  constructor() {
    super('aura-campus')
    this.version(1).stores({
      subjects: '++id', slots: '++id, subjectId, day', records: '++id, [slotId+date], subjectId, date', exams: '++id, date',
    })
    this.version(2).stores({ viva: '++id, due', focus: '++id, date' })
  }
}
export const db = new CampusDB()

export const isoDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }
