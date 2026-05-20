class Node<T> {
  value: T
  next: Node<T> | undefined = undefined
  constructor(value: T) {
    this.value = value
  }
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private head: Node<T> | undefined = undefined
  private tail: Node<T> | undefined = undefined
  private resolverHead: Node<(value: T) => void> | undefined = undefined
  private resolverTail: Node<(value: T) => void> | undefined = undefined
  private length = 0
  private maxLength: number

  constructor(options?: { maxLength?: number }) {
    this.maxLength = options?.maxLength ?? Infinity
  }

  push(item: T, options?: { force?: boolean }) {
    if (this.length >= this.maxLength && !options?.force) return
    this.length++
    const node = new Node(item)
    const resolve = this.shiftResolver()
    if (resolve) {
      this.length--
      resolve(item)
      return
    }
    if (this.tail) {
      this.tail.next = node
      this.tail = node
    } else {
      this.head = this.tail = node
    }
  }

  private shift(): T | undefined {
    if (!this.head) return undefined
    const value = this.head.value
    this.head = this.head.next
    if (!this.head) this.tail = undefined
    this.length = Math.max(0, this.length - 1)
    return value
  }

  private shiftResolver(): ((value: T) => void) | undefined {
    if (!this.resolverHead) return undefined
    const resolve = this.resolverHead.value
    this.resolverHead = this.resolverHead.next
    if (!this.resolverHead) this.resolverTail = undefined
    return resolve
  }

  async next(): Promise<T> {
    const value = this.shift()
    if (value !== undefined) return value
    return new Promise((resolve) => this.pushResolver(resolve))
  }

  private pushResolver(resolve: (value: T) => void) {
    const node = new Node(resolve)
    if (this.resolverTail) {
      this.resolverTail.next = node
      this.resolverTail = node
    } else {
      this.resolverHead = this.resolverTail = node
    }
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
