import { describe, expect, test } from "bun:test"
import { compile } from "@ricada/core"
import type { IrField, IrTypeRef } from "@ricada/core"
import { buildTypeMap, fieldsReason, typeReason } from "../src/index.ts"

const ir = compile(`
type User {
  id: string @uuid
  name: string @min(2) @max(10)
  email: string @email
  age: int? @min(0) @max(150)
  tags: string[]
}
type Id = string | int
type Circle { kind: "circle", radius: float @min(0) }
type Square { kind: "square", side: float @min(0) }
type Shape = Circle | Square
`)

const types = buildTypeMap(ir)

const ref = (name: string, kind: IrTypeRef["kind"], array = false): IrTypeRef => ({ name, kind, array, literal: false })

const fieldsOf = (name: string): IrField[] => {
  const type = ir.types.find((t) => t.name === name)!

  return type.kind === "object" ? type.fields : []
}

describe("validate: typeReason", () => {
  test("int accepts integers only", () => {
    expect(typeReason(ref("int", "primitive"), 3, types)).toBeNull()
    expect(typeReason(ref("int", "primitive"), 3.5, types)).toBe("expected integer")
    expect(typeReason(ref("int", "primitive"), "3", types)).toBe("expected integer")
  })

  test("uuid primitive enforces the uuid format", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000"
    expect(typeReason(ref("uuid", "primitive"), uuid, types)).toBeNull()
    expect(typeReason(ref("uuid", "primitive"), "not-a-uuid", types)).toBe("expected uuid")
  })

  test("arrays validate every item", () => {
    expect(typeReason(ref("string", "primitive", true), ["a", "b"], types)).toBeNull()
    expect(typeReason(ref("string", "primitive", true), ["a", 1], types)).toBe("expected string")
    expect(typeReason(ref("string", "primitive", true), "nope", types)).toBe("expected an array")
  })

  test("union aliases match any member", () => {
    expect(typeReason(ref("Id", "named"), "abc", types)).toBeNull()
    expect(typeReason(ref("Id", "named"), 42, types)).toBeNull()
    expect(typeReason(ref("Id", "named"), true, types)).toBe("no union member matches")
  })

  test("discriminated unions validate member constraints", () => {
    expect(typeReason(ref("Shape", "named"), { kind: "square", side: 2 }, types)).toBeNull()
    expect(typeReason(ref("Shape", "named"), { kind: "circle", radius: -1 }, types)).toBe("invalid object")
  })

  test("null kind matches only null", () => {
    expect(typeReason(ref("null", "null"), null, types)).toBeNull()
    expect(typeReason(ref("null", "null"), "x", types)).toBe("expected null")
  })
})

describe("validate: fieldsReason", () => {
  test("accepts a valid object", () => {
    const issues = fieldsReason(
      fieldsOf("User"),
      { id: "550e8400-e29b-41d4-a716-446655440000", name: "Jane", email: "jane@example.com", tags: [] },
      types,
    )
    expect(issues).toEqual([])
  })

  test("rejects missing required fields", () => {
    const issues = fieldsReason(fieldsOf("User"), { name: "Jane", email: "jane@example.com", tags: [] }, types)
    expect(issues).toEqual([{ field: "id", reason: "required field is missing" }])
  })

  test("applies annotation constraints", () => {
    const issues = fieldsReason(
      fieldsOf("User"),
      {
        id: "not-a-uuid",
        name: "x",
        email: "nope",
        age: 500,
        tags: [],
      },
      types,
    )

    expect(issues).toEqual([
      { field: "id", reason: "not a uuid" },
      { field: "name", reason: "must be at least 2 chars" },
      { field: "email", reason: "not an email" },
      { field: "age", reason: "must be <= 150" },
    ])
  })

  test("optional and omitted fields are allowed", () => {
    const issues = fieldsReason(
      fieldsOf("User"),
      { id: "550e8400-e29b-41d4-a716-446655440000", name: "Jane", email: "jane@example.com", tags: [] },
      types,
    )
    expect(issues).toEqual([])
  })
})
