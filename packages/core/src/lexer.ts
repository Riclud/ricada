import { Cursor } from "./cursor.ts"
import { LexError } from "./errors.ts"
import { PUNCTUATION, WORD_PART, WORD_START } from "./tokens.ts"
import type { Token, TokenType } from "./tokens.ts"

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9"

const isPathStop = (ch: string): boolean =>
  ch === "" ||
  ch === " " ||
  ch === "\t" ||
  ch === "\n" ||
  ch === "\r" ||
  ch === "{" ||
  ch === "}" ||
  ch === "(" ||
  ch === ")" ||
  ch === "[" ||
  ch === "]" ||
  ch === ","

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
}

const decodeEscape = (e: string, quote: string): string => {
  if (e === quote) return quote
  return ESCAPES[e] ?? `\\${e}`
}

export const lex = (source: string): Token[] => {
  const tokens: Token[] = []
  const c = new Cursor(source)

  const add = (type: TokenType, value: string | null, loc = c.loc()): void => {
    tokens.push({ type, value, loc })
  }

  while (!c.isEOF) {
    const ch = c.ch

    if (ch === "\n" || ch === "\r") {
      const width = ch === "\r" && c.peek() === "\n" ? 2 : 1

      c.advance(width)
      add("NEWLINE", null)
      continue
    }

    if (ch === " " || ch === "\t") {
      c.advance()
      continue
    }

    if (ch === "#" || (ch === "/" && c.peek() === "/")) {
      c.skipWhile((x) => x !== "\n" && x !== "\r")
      continue
    }

    if (ch === '"' || ch === "'") {
      const start = c.loc()
      const quote = ch
      c.advance()
      let value = ""

      while (!c.isEOF && c.ch !== quote) {
        if (c.ch !== "\\") {
          value += c.ch
          c.advance()
          continue
        }

        c.advance()
        const e: string = c.ch

        if (e === "") {
          value += "\\"
          break
        }

        value += decodeEscape(e, quote)
        c.advance()
      }

      if (c.isEOF) {
        throw new LexError("unterminated string", start, 1, `add a closing ${quote}`)
      }

      c.advance()
      add("STRING", value, start)
      continue
    }

    if (ch === "@") {
      const start = c.loc()
      c.advance()
      let name = c.eatWhile((x) => WORD_PART.test(x))

      if (name === "") {
        throw new LexError("empty annotation name", start, 1, "e.g. @min, @cache")
      }

      while (c.is(".")) {
        c.advance()
        const seg = c.eatWhile((x) => WORD_PART.test(x))

        if (seg === "") {
          throw new LexError("empty annotation namespace", start, 1, "e.g. @http.status")
        }

        name += "." + seg
      }

      add("DECORATOR", name, start)
      continue
    }

    if (ch === "/") {
      const start = c.loc()
      const path = c.eatWhile((x) => !isPathStop(x))
      add("PATH", path, start)
      continue
    }

    if (WORD_START.test(ch)) {
      const start = c.loc()
      const word = c.eatWhile((x) => WORD_PART.test(x))
      add("WORD", word, start)
      continue
    }

    if (isDigit(ch)) {
      const start = c.loc()
      let num = c.eatWhile(isDigit)

      if (c.is(".") && isDigit(c.peek())) {
        c.advance()
        num += "." + c.eatWhile(isDigit)
      }

      add("NUMBER", num, start)
      continue
    }

    const punct = PUNCTUATION[ch]
    if (punct) {
      add(punct, null)
      c.advance()
      continue
    }

    throw new LexError(`unexpected character \`${ch}\``, c.loc(), 1)
  }

  add("EOF", null)
  return tokens
}
