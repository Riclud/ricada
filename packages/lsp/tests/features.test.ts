import { describe, expect, test } from "bun:test"
import { analyze, completions, definition, hover, wordAt } from "../src/index.ts"

const source = `
type Address { city: string @min(1) }
type User { id: string @uuid, address: Address? }
error NotFound { message: string, code: string = "NOT_FOUND" }
/api { GET /users { returns 200: User handler listUsers } }
`

describe("lsp features", () => {
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

  test("offers type names, primitives and annotations", () => {
    const labels = completions(analyze(source)).map((c) => c.label)
    expect(labels).toContain("User")
    expect(labels).toContain("Address")
    expect(labels).toContain("NotFound")
    expect(labels).toContain("string")
    expect(labels).toContain("@uuid")
    expect(labels).toContain("GET")
  })

  test("hovers a type with its fields", () => {
    const analysis = analyze(source)
    const value = hover(analysis, source, { line: 1, character: 6 })
    expect(value).toContain("type **Address**")
    expect(value).toContain("city")
  })

  test("hovers an error type", () => {
    const analysis = analyze(source)
    const value = hover(analysis, source, { line: 3, character: 8 })
    expect(value).toContain("error **NotFound**")
    expect(value).toContain("message")
  })

  test("goes to a type definition", () => {
    const analysis = analyze(source)
    const location = definition(analysis, "file:///doc.ricada", source, { line: 2, character: 40 })
    expect(location?.range.start).toEqual({ line: 1, character: 5 })
    expect(location?.uri).toBe("file:///doc.ricada")
  })

  test("extracts the word under the cursor", () => {
    expect(wordAt("type User { id: string }", { line: 0, character: 6 })).toBe("User")
    expect(wordAt("  @rateLimit(limit: 1)", { line: 0, character: 4 })).toBe("@rateLimit")
  })
})
