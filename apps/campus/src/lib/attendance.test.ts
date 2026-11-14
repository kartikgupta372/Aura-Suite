import { standing } from './attendance'
const mk = (p: number, a: number, c = 0) => [
  ...Array(p).fill({ status: 'present' }),
  ...Array(a).fill({ status: 'absent' }),
  ...Array(c).fill({ status: 'cancelled' }),
]
const eq = (x: unknown, y: unknown, m: string) => {
  if (x !== y) throw new Error(`${m}: got ${x}, want ${y}`)
}
let s = standing(mk(18, 2), 75) // 18/20 = 90%
eq(s.canSkip, 4, 'canSkip 18/20')
eq(s.mustAttend, 0, 'safe')
s = standing(mk(6, 4), 75) // 6/10 = 60% -> need 6 more: 12/16 = 75%
eq(s.mustAttend, 6, 'mustAttend 6/10')
s = standing(mk(15, 5, 3), 75) // cancelled ignored: 15/20 = 75% exactly
eq(s.total, 20, 'cancelled ignored')
eq(s.canSkip, 0, 'edge')
eq(standing([], 75).pct, 100, 'empty')
console.log('attendance logic OK')
