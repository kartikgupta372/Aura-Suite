import Dexie, { type EntityTable } from 'dexie'
export interface Customer { id: number; name: string; phone: string }
/** amount > 0: customer took goods on credit (udhaar). amount < 0: customer paid. In paise. */
export interface Entry { id: number; customerId: number; amount: number; note: string; date: string }
export interface Order { id: number; customer: string; phone: string; items: string[]; status: 'new' | 'packed' | 'delivered'; date: string }
export interface StockItem { id: number; name: string; qty: number; low: number; supplier: string }
export interface Booking { id: number; date: string; time: string; name: string; phone: string; what: string }
export interface Reply { id: number; title: string; body: string }

class CounterDB extends Dexie {
  customers!: EntityTable<Customer, 'id'>
  entries!: EntityTable<Entry, 'id'>
  orders!: EntityTable<Order, 'id'>
  stock!: EntityTable<StockItem, 'id'>
  bookings!: EntityTable<Booking, 'id'>
  replies!: EntityTable<Reply, 'id'>
  constructor() {
    super('aura-counter')
    this.version(1).stores({ customers: '++id', entries: '++id, customerId, date' })
    this.version(2).stores({ orders: '++id, status', stock: '++id', bookings: '++id, date', replies: '++id' })
  }
}
export const db = new CounterDB()
export const rupees = (paise: number) => '₹' + (Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
export const balanceOf = (entries: Pick<Entry, 'amount'>[]) => entries.reduce((s, e) => s + e.amount, 0)
export const isoDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const wa = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
