import { matchReading } from './reading'
let r = matchReading('The cat sat on the mat.', 'the cat sat on the mat')
if (r.score !== 1) throw new Error('full')
r = matchReading('The cat sat on the mat.', 'uh the cat on the mat')
if (r.hit.join() !== 'true,true,false,true,true,true') throw new Error('skip ' + r.hit)
if (matchReading('Hi', '').score !== 0) throw new Error('empty')
console.log('reading logic OK')
