import { BadRequestException } from "@nestjs/common"


export class Node<K, V> {
    key: K
    value: V

    prev: Node<K, V> = null
    next: Node<K, V> = null


    constructor(key: K, value: V) {
        this.key = key
        this.value = value

    }
}

export class LRUCache<K, V> {

    private readonly capacity: number

    private cache = new Map<K, Node<K, V>>()

    private head: Node<K, V>
    private tail: Node<K, V>

    constructor(capacity: number) {
        if (capacity <= 0) throw new BadRequestException()

        this.capacity = capacity

        this.head = new Node(null, null)
        this.tail = new Node(null, null)

        this.head.next = this.tail
        this.tail.prev = this.head
    }

    get(key: K): V | undefined {
        const node = this.cache.get(key)

        if (!node) return undefined

        this.removeNode(node)
        this.addToFront(node)

        return node.value
    }

    set(key: K, value: V) {
        const existingNode = this.cache.get(key)

        if (existingNode) {
            existingNode.value = value

            this.removeNode(existingNode)
            this.addToFront(existingNode)
            return
        }

        const newNode = new Node(key, value)

        this.cache.set(key, newNode)

        this.addToFront(newNode)

        if (this.cache.size > this.capacity) {
            const lruNode = this.tail.prev

            if (lruNode && lruNode !== this.head) {
                this.removeNode(lruNode)
                this.cache.delete(lruNode.key)
            }
        }
    }

    removeNode(node: Node<K, V>) {
        const prevNode = node.prev
        const nextNode = node.next

        prevNode.next = nextNode
        nextNode.prev = prevNode

        node.prev = node.next = null

    }

    addToFront(node: Node<K, V>) {
        const firstNode = this.head.next

        firstNode.prev = node
        node.next = firstNode

        node.prev = this.head
        this.head.next = node
    }




}