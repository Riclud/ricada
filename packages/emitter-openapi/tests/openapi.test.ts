import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { compile } from "@ricada/core"
import { buildOpenApi } from "../src/index.ts"

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))

const basicIr = compile(readFileSync(basicPath, "utf-8"))
const doc = buildOpenApi(basicIr) as any

describe("openapi emitter", () => {
  test("converts path params and groups", () => {
    expect(Object.keys(doc.paths)).toContain("/api/users/{id}")
    expect(Object.keys(doc.paths)).toContain("/api/users/{id}/sessions/{sessionId}")
    expect(Object.keys(doc.paths)).toContain("/admin/stats")
  })

  test("maps query and path parameters", () => {
    const get = doc.paths["/api/users"].get
    const query = get.parameters.filter((p: any) => p.in === "query").map((p: any) => p.name)
    expect(query).toEqual(["page", "size", "role", "active"])
    const byId = doc.paths["/api/users/{id}"].get
    const pathParam = byId.parameters.find((p: any) => p.in === "path")
    expect(pathParam).toEqual(expect.objectContaining({ name: "id", required: true }))
  })

  test("builds a request body for POST /api/users", () => {
    const post = doc.paths["/api/users"].post
    const props = post.requestBody.content["application/json"].schema.properties
    expect(Object.keys(props)).toEqual(["name", "email", "password", "age", "role"])
    expect(post.requestBody.content["application/json"].schema.required).toContain("name")
    expect(props.email.format).toBe("email")
    expect(props.password.writeOnly).toBe(true)
    expect(props.name.minLength).toBe(1)
  })

  test("maps returns and errors to responses", () => {
    const post = doc.paths["/api/users"].post
    expect(post.responses["201"].content["application/json"].schema.$ref).toBe("#/components/schemas/User")
    expect(post.responses["409"].content["application/json"].schema.$ref).toBe("#/components/schemas/Conflict")
  })

  test("renders discriminated unions with a discriminator", () => {
    const shape = doc.components.schemas.Shape
    expect(shape.oneOf).toHaveLength(2)
    expect(shape.discriminator.propertyName).toBe("kind")
  })

  test("renders enums", () => {
    expect(doc.components.schemas.Role).toEqual({
      type: "string",
      enum: ["admin", "user", "guest"],
    })
  })

  test("reference example OpenAPI snapshot", () => {
    expect(doc).toMatchSnapshot()
  })
})
