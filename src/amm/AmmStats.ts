import "./init"
import Big from "big.js"
import { BIG_ONE, BIG_TWO, BIG_ZERO } from "../Constants"

export const StatsKeys = ['ammPrice']

export class AmmStats {
    private readonly ammMovingAverage: Statistic<Big>
    private readonly ammSamples: CircularBuffer<Big>
    
    constructor(samples: number, statsPreload?: Map<string, Array<Big>>) {
        let ammPreload: Array<Big>
        if (statsPreload) {
            ammPreload = statsPreload.get(StatsKeys[0])
        }

        this.ammSamples = new CircularBuffer<Big>(samples, ammPreload)
        this.ammMovingAverage = new BigSimpleMovingAverage(this.ammSamples)
    }

    push(ammPrice: Big, ftxMid: Big): void {
        this.ammMovingAverage.push(ammPrice)
    }

    size(): number {
        return this.ammMovingAverage.size()
    }

    save(): Record<string, Array<Big>> {
        const stats: Record<string, Array<Big>> = {}
        stats[StatsKeys[0]] = this.ammSamples.array().map(item => item.gt(BIG_ONE) ? item.round(5) : item)
        return stats
    }
}

class CircularBuffer<T> {
    private _array: Array<T>
    private _size: number
    private _index: number
    
    constructor(private _maxSize: number, preload?: Array<T>) {
        this._array = new Array<T>(_maxSize)
        this._size = 0
        this._index = -1
        if (preload && preload.length > 0) {
            this._size = preload.length >= _maxSize ? _maxSize : preload.length
            this._index = this._size - 1
            this._array.splice(0, this._size, ...preload.slice(-_maxSize))
        }
    }

    push(t: T): number {
        this._index = (this._index + 1) % this._maxSize
        this._array[this._index] = t
        this._size = (this._size == this._maxSize) ? this._maxSize : this._size + 1
        return this._size
    }
    
    tail(): T {
        return this._array[(this._index + 1) % this._maxSize]
    }

    poll(): T {
        return this._array[this._index]
    }

    maxSize(): number {
        return this._maxSize
    }

    size(): number {
        return this._size
    }

    primed(): boolean {
        return this._size == this._maxSize
    }

    array(): Array<T> {
        if (this._size == 0) {
            return new Array<T>()
        } else if (this._size < this._maxSize) {
            return this._array.slice(0, this._index + 1)
        }
        return new Array<T>(...this._array.slice(this._index + 1), ...this._array.slice(0, this._index + 1))
    }
}

export interface Statistic<T> {
    buffer: CircularBuffer<T>
    push(t: T): T
    poll(): T
    size(): number
    primed(): boolean
}

export class BigStandardDeviation {
    private readonly squareMovingAverage: BigSquareSimpleMovingAverage
    private readonly movingAverage: BigSimpleMovingAverage
    constructor(squareMovingAverage: BigSquareSimpleMovingAverage, movingAverage: BigSimpleMovingAverage) {
        this.squareMovingAverage = squareMovingAverage
        this.movingAverage = movingAverage
    }

    poll(): Big {
        const squareValue = this.squareMovingAverage.poll()
        const expectedValue = this.movingAverage.poll()
        return squareValue.sub(expectedValue.mul(expectedValue)).sqrt()
    }
}

export class BigSimpleMovingAverage implements Statistic<Big> {
    buffer: CircularBuffer<Big>
    private _sum: Big
    constructor(buffer: CircularBuffer<Big>, ) {
        this.buffer = buffer
        this._sum = buffer.array().reduce((sum, value) => sum.add(value), BIG_ZERO)
    }

    push(value: Big): Big {
        if (this.buffer.primed()) {
            let tail = this.buffer.tail()
            this._sum = this._sum.sub(tail)
        }
        this.buffer.push(value)
        this._sum = this._sum.add(value)
        
        return this._sum.div(Big(this.buffer.size()))
    }

    size(): number {
        return this.buffer.size()
    }

    poll(): Big {
        return this._sum.div(Big(this.buffer.size()))
    }

    primed(): boolean {
        return this.buffer.primed()
    }
}

export class BigSquareSimpleMovingAverage extends BigSimpleMovingAverage {
    push(value: Big): Big {
        let squareValue = value.mul(value)
        return super.push(squareValue)
    }
}

export class BigExponentialMovingAverage implements Statistic<Big> {
    buffer: CircularBuffer<Big>
    private _average: Big
    private alpha: Big
    private invAlpha: Big
    constructor(buffer: CircularBuffer<Big>) {
        this.buffer = buffer
        this.alpha = BIG_TWO.div(this.buffer.maxSize() + 1)
        this.invAlpha = BIG_ONE.sub(this.alpha)
        if (buffer.size() == 0) {
            this._average = BIG_ZERO
        } else if (!this.buffer.primed()) {
            this._average = buffer.array().reduce((sum, value) => sum.add(value)).div(buffer.size())
        } else {
            this._average = buffer.array().reduce((average, value) => value.mul(this.alpha).add(average.mul(this.invAlpha)))
        }
    }

    push(value: Big): Big {
        if (this.buffer.size() == 0) {
            this._average = value
        }
        this.buffer.push(value)
        if (!this.buffer.primed()) {
            this._average = this._average.mul(this.buffer.size()).add(value).div(this.buffer.size() + 1.0)
        } else {
            this._average = value.mul(this.alpha).add(this._average.mul(this.invAlpha))
        }
        return this._average
    }

    size(): number {
        return this.buffer.size()
    }

    poll(): Big {
        return this._average
    }

    primed(): boolean {
        return this.buffer.primed()
    }

}