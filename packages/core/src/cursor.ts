import type { Location } from "./tokens.ts"

export class Cursor {
  pos = 0
  line = 1
  col = 1

  constructor(public source: string) {}

  get ch(): string {
    return this.source[this.pos] ?? ""
  }

  get isEOF(): boolean {
    return this.pos >= this.source.length
  }

  peek(n = 1): string {
    return this.source[this.pos + n] ?? ""
  }

  loc(): Location {
    return { line: this.line, col: this.col, offset: this.pos }
  }

  is(ch: string): boolean {
    return this.source[this.pos] === ch
  }

  advance(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.source.length) break

      if (this.source[this.pos] === "\n") {
        this.line++
        this.col = 1
        this.pos++
        continue
      }

      this.col++
      this.pos++
    }
  }

  eatWhile(pred: (ch: string) => boolean): string {
    const start = this.pos
    while (this.pos < this.source.length && pred(this.source[this.pos]!)) {
      this.advance()
    }
    return this.source.slice(start, this.pos)
  }

  skipWhile(pred: (ch: string) => boolean): void {
    while (this.pos < this.source.length && pred(this.source[this.pos]!)) {
      this.advance()
    }
  }
}
