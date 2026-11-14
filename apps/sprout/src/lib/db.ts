// Only a first name, an avatar colour and star counts are stored. No audio, no photos, no surname.
import Dexie, { type EntityTable } from 'dexie'
export interface Child { id: number; name: string }
export interface Progress { id: number; childId: number; storyId: string; line: number; stars: number }
class SproutDB extends Dexie {
  children!: EntityTable<Child, 'id'>
  progress!: EntityTable<Progress, 'id'>
  constructor() { super('aura-sprout'); this.version(1).stores({ children: '++id', progress: '++id, childId, storyId' }) }
}
export const db = new SproutDB()
