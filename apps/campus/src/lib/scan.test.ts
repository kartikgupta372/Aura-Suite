import { cleanScan } from './scan'
const r = cleanScan([
  { day: 1, start: '9:00', end: '09:50', subject: ' CN ', kind: 'theory' },
  { day: 1, start: '09.00', end: '10:00', subject: 'cn', kind: 'theory' },      // duplicate slot, different formatting
  { day: 2, start: '14:00', end: '17:00', subject: 'Java Lab', kind: 'lab', room: ' L2 ' },
  { day: 9, start: '09:00', end: '10:00', subject: 'Bad day', kind: 'theory' },  // invalid day
  { day: 3, start: '11:00', end: '10:00', subject: 'Backwards', kind: 'theory' },// ends before it starts
  { day: 4, start: 'nine', end: '10:00', subject: 'Bad time', kind: 'theory' },
] as never)
if (r.length !== 2) throw new Error('expected 2, got ' + r.length + JSON.stringify(r))
if (r[0].subject !== 'CN' || r[0].start !== '09:00') throw new Error('normalise ' + JSON.stringify(r[0]))
if (r[1].kind !== 'lab' || r[1].room !== 'L2') throw new Error('lab ' + JSON.stringify(r[1]))
console.log('scan cleanup OK')
