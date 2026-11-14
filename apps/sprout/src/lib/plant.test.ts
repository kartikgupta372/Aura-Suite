import { stageOf, starsToNext } from './plant'
if (stageOf(0) !== 0 || stageOf(3) !== 1 || stageOf(14) !== 2 || stageOf(25) !== 4 || stageOf(99) !== 4) throw new Error('stage')
if (starsToNext(0) !== 3 || starsToNext(10) !== 5 || starsToNext(30) !== 0) throw new Error('next')
console.log('plant logic OK')
