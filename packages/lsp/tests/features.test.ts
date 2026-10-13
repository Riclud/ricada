import { describe, expect, test } from "bun:test"
import { analyze, completions, definition, hover, wordAt } from "../src/index.ts"

const source = `
type Address { city: string @min(1) }
type User { id: string @uuid, address: Address? }
error NotFound { message: string, code: string = "NOT_FOUND" }
/api { GET /users { returns 200: User handler listUsers } }
`

const labelsAt = (text: string, line: number, character: number): string[] =>
  completions(analyze(text), text, { line, character }).map((c) => c.label)

describe("lsp diagnostics", () => {
  test("reports resolver diagnostics with a range", () => {
    const analysis = analyze("type T { a: Missing }")
    expect(analysis.diagnostics).toHaveLength(1)
    expect(analysis.diagnostics[0]!.message).toContain("unknown type `Missing`")
    expect(analysis.diagnostics[0]!.range.start).toEqual({ line: 0, character: 12 })
  })

  test("reports parse diagnostics", () => {
    const analysis = analyze("type T { a string }")
    expect(analysis.diagnostics.length).toBeGreaterThan(0)
    expect(analysis.diagnostics[0]!.severity).toBe(1)
  })
})

describe("lsp completion contexts", () => {
  test("top level offers declarations only, not methods", () => {
    const labels = labelsAt("type T { a: string }", 0, 0)
    expect(labels).toContain("type")
    expect(labels).toContain("config")
    expect(labels).not.toContain("GET")
    expect(labels).not.toContain("returns")
  })

  test("route body offers route keywords and annotations", () => {
    const text = "/api {\n  GET /users {\n    \n  }\n}\n"
    const labels = labelsAt(text, 2, 4)
    expect(labels).toContain("returns")
    expect(labels).toContain("body")
    expect(labels).toContain("handler")
    expect(labels).toContain("@cache")
    expect(labels).not.toContain("config")
  })

  test("type position offers primitives and literal null", () => {
    const text = "type User {\n  id: \n}\n"
    const labels = labelsAt(text, 1, 6)
    expect(labels).toContain("string")
    expect(labels).toContain("uuid")
    expect(labels).toContain("null")
    expect(labels).not.toContain("returns")
  })

  test("after @ offers annotations", () => {
    const text = "type T {\n  a: string @\n}\n"
    const labels = labelsAt(text, 1, 13)
    expect(labels).toContain("@uuid")
    expect(labels).toContain("@rateLimit")
    expect(labels).not.toContain("string")
  })

  test("annotation arguments are scoped and prefixed", () => {
    const text = "type T {\n  a: string @rateLimit(lim\n}\n"
    const labels = labelsAt(text, 1, 26)
    expect(labels).toEqual(["limit"])
  })

  test("auth arguments offer configured schemes", () => {
    const withAuth = [
      "config {",
      '  auth { bearer { type: jwt, secret: env("S") } }',
      "}",
      "/api { GET /x { @auth() } }",
      "",
    ].join("\n")
    const analysis = analyze(withAuth)
    const labels = completions(analysis, withAuth, { line: 3, character: 22 }).map((c) => c.label)
    expect(labels).toContain("bearer")
    expect(labels).toContain("public")
  })
})

describe("lsp hover and definition", () => {
  test("hovers a type with its fields", () => {
    const value = hover(analyze(source), source, { line: 1, character: 6 })
    expect(value).toContain("type **Address**")
    expect(value).toContain("city")
  })

  test("hovers an error type", () => {
    const value = hover(analyze(source), source, { line: 3, character: 8 })
    expect(value).toContain("error **NotFound**")
    expect(value).toContain("message")
  })

  test("goes to a type definition", () => {
    const location = definition(analyze(source), "file:///doc.ricada", source, { line: 2, character: 40 })
    expect(location?.range.start).toEqual({ line: 1, character: 5 })
    expect(location?.uri).toBe("file:///doc.ricada")
  })

  test("extracts the word under the cursor", () => {
    expect(wordAt("type User { id: string }", { line: 0, character: 6 })).toBe("User")
    expect(wordAt("  @rateLimit(limit: 1)", { line: 0, character: 4 })).toBe("@rateLimit")
  })
})
