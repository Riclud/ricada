import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compile } from "@ricada/core"
import { formatReport, verifyImpl } from "../src/verify.ts"

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))
const ir = compile(readFileSync(basicPath, "utf-8"), { baseDir: dirname(basicPath) })

const ALL_AS_ANY = `export const handlers = {
  listUsers: async () => ({} as any),
  createUser: async () => ({} as any),
  getUser: async () => ({} as any),
  updateUser: async () => ({} as any),
  deleteUser: async () => {},
  listUserSessions: async () => ([] as any),
  revokeUserSession: async () => {},
  createShape: async () => ({} as any),
  getStats: async () => ({} as any),
  denyKey: async () => {},
}
`

const withImpl = async (source: string, name = "handlers.ts") => {
  const dir = await mkdtemp(join(tmpdir(), "ricada-verify-"))
  const impl = join(dir, name)
  await writeFile(impl, source, "utf-8")
  return await verifyImpl(ir, impl, dir)
}

describe("verify / check --impl", () => {
  test("reports all routes implemented for a complete backend", async () => {
    const report = await withImpl(ALL_AS_ANY)
    expect(report.importError).toBeNull()
    expect(report.summary).toEqual({ total: 10, implemented: 10, missing: 0, mismatch: 0 })
    expect(report.ok).toBe(true)
  })

  test("detects a missing handler", async () => {
    const without = ALL_AS_ANY.replace("  deleteUser: async () => {},\n", "")
    const report = await withImpl(without)
    expect(report.summary.missing).toBe(1)
    expect(report.routes.find((r) => r.handler === "deleteUser")?.status).toBe("missing")
    expect(report.ok).toBe(false)
  })

  test("detects a signature mismatch", async () => {
    const bad = ALL_AS_ANY.replace("listUsers: async () => ({} as any),", "listUsers: (n: number) => 42,")
    const report = await withImpl(bad)
    expect(report.routes.find((r) => r.handler === "listUsers")?.status).toBe("mismatch")
    expect(report.summary.implemented).toBe(9)
  })

  test("reports an import error when handlers are not exported", async () => {
    const report = await withImpl("export const nope = 1\n")
    expect(report.importError).not.toBeNull()
    expect(report.summary.missing).toBe(10)
    expect(report.ok).toBe(false)
  })

  test("reports an import error when the backend file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ricada-verify-"))
    const report = await verifyImpl(ir, join(dir, "missing.ts"), dir)
    expect(report.importError).not.toBeNull()
    expect(report.ok).toBe(false)
  })

  test("formatReport renders a table and summary", async () => {
    const report = await withImpl(ALL_AS_ANY)
    const text = formatReport(report)
    expect(text).toContain("ROUTE")
    expect(text).toContain("listUsers")
    expect(text).toContain("summary: 10 routes, 10 implemented")
  })
})
