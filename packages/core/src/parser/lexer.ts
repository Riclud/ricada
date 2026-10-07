import type { Token, TokenType } from "./types.ts"
import { Cursor } from "./cursor.ts"

export function lex(source: string): Token[] {
  const tokens: Token[] = []
  const c = new Cursor(source)

  function add(type: TokenType, value: Token["value"] = null): void {
    tokens.push({ type, value, loc: c.loc() })
  }

  while (!c.isEOF) {
    // --- NEWLINE ---
    if (c.ch === "\n" || c.ch === "\r") {
      c.advance()
      add("NEWLINE")
      continue
    }

    // --- INDENT: пробелы/табуляция в начале строки ---
    if (c.ch === " " || c.ch === "\t") {
      const prev = tokens.at(-1)
      if (!prev || prev.type === "NEWLINE" || prev.type === "INDENT") {
        const startLoc = c.loc()
        const startPos = c.pos
        c.skipWhile((ch) => ch === " " || ch === "\t")
        tokens.push({ type: "INDENT", value: c.pos - startPos, loc: startLoc })
      } else {
        c.advance()
      }
      continue
    }

    // --- WORD (включая Unicode буквы) ---
    if (/[\p{L}_]/u.test(c.ch)) {
      const start = c.loc()
      const word = c.eatWhile((ch) => /[\p{L}\p{N}_]/u.test(ch))
      tokens.push({ type: "WORD", value: word, loc: start })
      continue
    }

    // --- NUMBER ---
    if (/[0-9]/.test(c.ch)) {
      const start = c.loc()
      const num = c.eatWhile((ch) => /[0-9.]/.test(ch))
      tokens.push({ type: "NUMBER", value: num, loc: start })
      continue
    }

    // --- STRING: "..." or '...' ---
    if (c.ch === '"' || c.ch === "'") {
      const start = c.loc()
      const quote = c.ch
      c.advance() // skip opening quote
      let value = ""
      while (!c.isEOF && c.ch !== quote) {
        value += c.ch
        c.advance()
      }
      if (!c.isEOF) c.advance() // skip closing quote
      tokens.push({ type: "STRING", value, loc: start })
      continue
    }

    // --- PATH ---
    if (c.ch === "/") {
      const start = c.loc()
      const path = c.eatWhile((ch) => ch !== "\n" && ch !== "\r")
      tokens.push({ type: "PATH", value: path, loc: start })
      continue
    }

    // --- SINGLE-CHAR TOKENS ---
    if (c.match(":")) {
      add("COLON")
      continue
    }
    if (c.match("?")) {
      add("OPTIONAL")
      continue
    }
    if (c.match("(")) {
      add("LPAREN")
      continue
    }
    if (c.match(")")) {
      add("RPAREN")
      continue
    }
    if (c.match(",")) {
      add("COMMA")
      continue
    }
    if (c.match("{")) {
      add("LBRACE")
      continue
    }
    if (c.match("}")) {
      add("RBRACE")
      continue
    }

    // --- ARROW ---
    if (c.ch === "-" && !c.isEOF && c.source[c.pos + 1] === (">" as string)) {
      c.advance(2)
      add("ARROW")
      continue
    }

    // --- DECORATOR @name(arg) ---
    if (c.ch === "@") {
      const start = c.loc()
      c.advance() // skip '@'
      const name = c.eatWhile((ch) => /[a-zA-Z]/.test(ch))

      let arg: string | null = null
      if (c.is("(")) {
        c.advance()
        let raw = ""
        let depth = 1
        while (!c.isEOF && depth > 0) {
          if (c.is("(")) depth++
          if (c.is(")")) depth--
          if (depth > 0) raw += c.ch
          c.advance()
        }
        arg = raw
      }

      tokens.push({ type: "DECORATOR", value: { name, arg }, loc: start })
      continue
    }

    // skip unknown
    c.advance()
  }

  add("EOF")
  return tokens
}
