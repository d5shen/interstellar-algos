export class Stack<T> {
    _store: T[] = []

    push(val: T) {
        this._store.push(val)
    }

    pop(): T | undefined {
        return this._store.pop()
    }

    peek(): T | undefined {
        return this._store[this.size() - 1]
    }

    size(): number {
        return this._store.length
    }
}

export class Queue<T> {
    _store: T[] = []

    push(val: T) {
        this._store.push(val)
    }

    pop(): T | undefined {
        return this._store.shift()
    }

    peek(): T | undefined {
        return this._store[0]
    }

    size(): number {
        return this._store.length
    }
}

export class Pair<T, R> {
    constructor(private first: T, private second: R) {}

    getFirst(): T {
        return this.first
    }

    getSecond(): R {
        return this.second
    }
}
