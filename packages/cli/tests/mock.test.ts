import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { compile } from "@ricada/core"
import { buildRegistry, exampleForFields, exampleForRef } from "../src/schema.ts"
import { createMockHandler } from "../src/mock.ts"
import { formatTestReport, runTests } from "../src/test.ts"
import type { IrObjectType } from "@ricada/core"

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))
const ir = compile(readFileSync(basicPath, "utf-8"))
const reg = buildRegistry(ir)

const servers: Array<{ stop: () => void }> = []
afterAll(() => servers.forEach((s) => s.stop()))

describe("schema examples", () => {
  test("builds object examples using @example and defaults", () => {
    const user = reg.types.get("User") as IrObjectType
    const example = exampleForFields(reg, user.fields) as any
    expect(example.id).toBe("550e8400-e29b-41d4-a716-446655440000")
    expect(example.name).toBe("Jane Doe")
    expect(example.age).toBe(30)
    expect(example.role).toBe("admin")
    expect(example.tags).toEqual(["string"])
    expect(example.address.city).toBe("string")
  })

  test("generates array and discriminated-union examples", () => {
    const sessions = ir.routes.find((r) => r.path.endsWith("/sessions"))!.returns[0]!.type!
    expect(Array.isArray(exampleForRef(reg, sessions))).toBe(true)

    const shapeType = reg.types.get("Shape")!
    expect(shapeType.kind).toBe("alias")
    expect(exampleForRef(reg, { name: "Shape", array: false, literal: false, kind: "named" })).toEqual({
      kind: "circle",
      radius: 0,
    })
  })
})

describe("mock server", () => {
  const handler = createMockHandler(ir)

  test("serves success examples per route", async () => {
    const res = handler(new Request("http://mock/api/users"))
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].name).toBe("Jane Doe")
  })

  test("uses the declared success status", () => {
    expect(handler(new Request("http://mock/api/users", { method: "POST" })).status).toBe(201)
    expect(handler(new Request("http://mock/api/users/abc", { method: "DELETE" })).status).toBe(204)
  })

  test("returns 404 for unknown routes", () => {
    expect(handler(new Request("http://mock/nope")).status).toBe(404)
  })
})

describe("ricada test against a target", () => {
  test("all routes pass against the mock", async () => {
    const server = Bun.serve({ port: 0, fetch: createMockHandler(ir) })
    servers.push(server)
    const report = await runTests(ir, `http://localhost:${server.port}`)
    expect(report.summary.total).toBe(10)
    expect(report.summary.failed).toBe(0)
    expect(formatTestReport(report)).toContain("10 passed, 0 failed")
  })

  test("fails against a non-conforming target", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ nope: true }) })
    servers.push(server)
    const report = await runTests(ir, `http://localhost:${server.port}`)
    expect(report.summary.failed).toBeGreaterThan(0)
  })
})
