import { parseItems, fillTemplate } from './orders'
const a = parseItems('Hi\n2 kg atta, 1 litre doodh aur 5 maggi\n- 1 dozen eggs')
if (a.join('|') !== '2 kg atta|1 litre doodh|5 maggi|1 dozen eggs') throw new Error('parse ' + a.join('|'))
if (fillTemplate('Hello {name}, welcome to {shop}', { name: 'Ravi', shop: 'Sharma Store' }) !== 'Hello Ravi, welcome to Sharma Store') throw new Error('tpl')
console.log('orders logic OK')
