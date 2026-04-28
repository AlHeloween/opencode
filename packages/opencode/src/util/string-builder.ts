export class StringBuilder {
  private parts: string[] = []
  private _length = 0

  append(s: string) {
    this.parts.push(s)
    this._length += s.length
  }

  toString() {
    return this.parts.length === 0 ? "" : this.parts.join("")
  }

  get length() {
    return this._length
  }

  reset() {
    this.parts = []
    this._length = 0
  }
}
