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
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const node = new Node(item)
    const resolve = this.resolvers.shift()
    if (resolve) {
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
    return value
  }

  async next(): Promise<T> {
    const value = this.shift()
    if (value !== undefined) return value
    return new Promise((resolve) => this.resolvers.push(resolve))
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
