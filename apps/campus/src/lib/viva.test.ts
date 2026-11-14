import { coverage, review } from './viva'
const pts = ['TCP is connection oriented', 'UDP is faster but unreliable']
let c = coverage(pts, 'TCP is a connection oriented protocol, and UDP is unreliable but faster')
if (c.score !== 1) throw new Error('both covered ' + JSON.stringify(c))
c = coverage(pts, 'tcp connection oriented only')
if (c.score !== 0.5) throw new Error('half ' + c.score)
if (review(3, true, '2026-11-14').box !== 4) throw new Error('up')
if (review(3, false, '2026-11-14').due !== '2026-11-15') throw new Error('miss due')
console.log('viva logic OK')
