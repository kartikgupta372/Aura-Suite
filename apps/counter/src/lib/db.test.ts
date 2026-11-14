import { balanceOf, rupees } from './db'
if (balanceOf([{ amount: 50000 }, { amount: -20000 }]) !== 30000) throw new Error('balance')
if (rupees(-12550) !== '₹125.5') throw new Error('rupees ' + rupees(-12550))
console.log('khata logic OK')
