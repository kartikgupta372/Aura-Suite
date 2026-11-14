import { createClient } from '@supabase/supabase-js'

// Public client values (safe in the browser). Study rooms use Realtime presence only: nothing is written to a table.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://grmaprevhcrjrlstssfi.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_e8GiA8jFIsTEWGs9vQ0j_Q_2uMo9FBo'
export const supabase = createClient(url, key, { realtime: { params: { eventsPerSecond: 5 } } })

export interface Peer { name: string; state: 'focus' | 'break' | 'idle'; endsAt: number | null }
export const roomCode = () => Math.random().toString(36).slice(2, 6).toUpperCase()
