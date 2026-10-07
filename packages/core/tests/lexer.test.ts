import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { lex } from "../src/lexer.ts"
import { LexError } from "../src/errors.ts"
import type { Token } from "../src/tokens.ts"

const normalize = (tokens: Token[]): Array<{ type: string; value: string | null }> =>
  tokens.map((t) => ({ type: t.type, value: t.value }))

const types = (tokens: Token[]): string[] => tokens.map((t) => t.type)

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))

describe("lexer v2", () => {
  test("tokenizes a field declaration with inline annotations", () => {
    const tokens = lex("name: string @min(1) @max(100)")
    expect(normalize(tokens)).toEqual([
      { type: "WORD", value: "name" },
      { type: "COLON", value: null },
      { type: "WORD", value: "string" },
      { type: "DECORATOR", value: "min" },
      { type: "LPAREN", value: null },
      { type: "NUMBER", value: "1" },
      { type: "RPAREN", value: null },
      { type: "DECORATOR", value: "max" },
      { type: "LPAREN", value: null },
      { type: "NUMBER", value: "100" },
      { type: "RPAREN", value: null },
      { type: "EOF", value: null },
    ])
  })

  test("skips // and # comments", () => {
    const tokens = lex("a: int // trailing\n# full line\nb: int")
    expect(tokens.filter((t) => t.type === "WORD").map((t) => t.value)).toEqual(["a", "int", "b", "int"])
  })

  test("records line/col for the first token of each line", () => {
    const tokens = lex("a: int\nb: int").filter((t) => t.type === "WORD")
    expect(tokens[0]!.loc).toMatchObject({ line: 1, col: 1 })
    expect(tokens[2]!.loc).toMatchObject({ line: 2, col: 1 })
  })

  test("decodes string escapes and keeps unknown escapes", () => {
    const tokens = lex('"a\\nb" "\\"q\\"" "\\d{5}"')
    expect(tokens.filter((t) => t.type === "STRING").map((t) => t.value)).toEqual(["a\nb", '"q"', "\\d{5}"])
  })

  test("tokenizes namespaced decorators", () => {
    const tokens = lex("@http.status(201) @cache(ttl: 60)")
    expect(tokens.filter((t) => t.type === "DECORATOR").map((t) => t.value)).toEqual(["http.status", "cache"])
  })

  test("tokenizes paths and stops at whitespace/braces", () => {
    const tokens = lex("POST /users/:id {\nGET /stats")
    expect(tokens.filter((t) => t.type === "PATH").map((t) => t.value)).toEqual(["/users/:id", "/stats"])
  })

  test("tokenizes numbers including floats", () => {
    const tokens = lex("min 0 max 4.5 limit 1000")
    expect(tokens.filter((t) => t.type === "NUMBER").map((t) => t.value)).toEqual(["0", "4.5", "1000"])
  })

  test("tokenizes hyphenated identifiers (headers, targets)", () => {
    const tokens = lex("x-request-id ts-client")
    expect(tokens.filter((t) => t.type === "WORD").map((t) => t.value)).toEqual(["x-request-id", "ts-client"])
  })

  test("tokenizes punctuation", () => {
    const tokens = lex("{}[]():,.?= |")
    expect(types(tokens)).toEqual([
      "LBRACE",
      "RBRACE",
      "LBRACKET",
      "RBRACKET",
      "LPAREN",
      "RPAREN",
      "COLON",
      "COMMA",
      "DOT",
      "QUESTION",
      "EQUALS",
      "PIPE",
      "EOF",
    ])
  })

  test("throws a LexError on unterminated string", () => {
    expect(() => lex('"oops')).toThrow(LexError)
  })

  test("throws a LexError on unexpected character", () => {
    expect(() => lex("a: int ;")).toThrow(LexError)
  })

  test("lexes the reference example without errors", () => {
    const source = readFileSync(basicPath, "utf-8")
    expect(() => lex(source)).not.toThrow()
  })

  test("reference example token snapshot", () => {
    const source = readFileSync(basicPath, "utf-8")
    expect(normalize(lex(source))).toMatchSnapshot()
  })
})
