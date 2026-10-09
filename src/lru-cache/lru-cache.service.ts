import { LRUCache } from "./lru-cache";


const cache = new LRUCache(3)

cache.set('A', 10)
cache.set('B', 20)
cache.set('C', 30)

console.log(cache.get('B'))

console.log(cache.get('C'))

console.log(cache.get('A'))

cache.set('D', 40)

console.log(cache.get('A'))

console.log(cache.get('B'))

console.log(cache.get('C'))