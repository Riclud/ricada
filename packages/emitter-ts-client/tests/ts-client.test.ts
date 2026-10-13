import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { compile } from "@ricada/core"
import { emitTsClient } from "../src/index.ts"

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const basicPath = join(repoRoot, "examples/basic.ricada")
const ir = compile(readFileSync(basicPath, "utf-8"), { baseDir: dirname(basicPath) })
const files = emitTsClient(ir)
const byPath = Object.fromEntries(files.map((f) => [f.path, f.contents]))

const materialize = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "ricada-tsclient-"))

  for (const file of files) {
    const dest = join(dir, file.path)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, file.contents)
  }

  return dir
}

describe("ts-client emitter", () => {
  test("emits types, validators, client and index", () => {
    expect(files.map((f) => f.path)).toEqual([
      "ts-client/types.ts",
      "ts-client/validators.ts",
      "ts-client/client.ts",
      "ts-client/index.ts",
    ])
  })

  test("client exposes createClient and typed methods", () => {
    const code = byPath["ts-client/client.ts"]!
    expect(code).toContain("export function createClient(options: ClientOptions)")
    expect(code).toContain("export class RicadaApiError")
    expect(code).toContain("async listUsers(input: T.ListUsersInput): Promise<T.PageOfUser>")
    expect(code).toContain("async deleteUser(input: T.DeleteUserInput): Promise<void>")
  })

  test("validators cover named types and routes", () => {
    const code = byPath["ts-client/validators.ts"]!
    expect(code).toContain("export const validators")
    expect(code).toContain('Role: (v: unknown) => v === "admin"')
    expect(code).toContain('Shape: (v: unknown) => validators["Circle"]!(v) || validators["Square"]!(v)')
    expect(code).toContain('"listUsers": (v: unknown) => validators["PageOfUser"]!(v)')
  })

  test("generated code typechecks with tsc", async () => {
    const dir = await materialize()
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          skipLibCheck: true,
          types: [],
          lib: ["esnext", "dom"],
        },
        include: ["ts-client/*.ts"],
      }),
    )
    const proc = Bun.spawnSync([
      "bun",
      join(repoRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      join(dir, "tsconfig.json"),
    ])
    expect(proc.stdout.toString() + proc.stderr.toString()).toBe("")
  })

  test("runtime: resolves typed responses and throws on errors", async () => {
    const dir = await materialize()
    const mod = await import(join(dir, "ts-client/index.ts"))
    const page = { items: [], total: 0, page: 1, size: 20 }

    const okClient = mod.createClient({
      baseUrl: "https://api.test/",
      validate: true,
      fetch: async () => new Response(JSON.stringify(page), { status: 200 }),
    })
    expect(await okClient.listUsers({ query: { page: 1 } })).toEqual(page)

    const errClient = mod.createClient({
      baseUrl: "https://api.test",
      fetch: async () => new Response(JSON.stringify({ message: "no" }), { status: 404 }),
    })
    await expect(errClient.getUser({ params: { id: "x" } })).rejects.toBeInstanceOf(mod.RicadaApiError)
  })

  test("runtime: dev validation rejects contract violations", async () => {
    const dir = await materialize()
    const mod = await import(join(dir, "ts-client/index.ts"))
    const client = mod.createClient({
      baseUrl: "https://api.test",
      validate: true,
      fetch: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
    })
    await expect(client.listUsers({})).rejects.toThrow(/does not match the contract/)
  })

  test("interpolates path params and serializes query", async () => {
    const dir = await materialize()
    const mod = await import(join(dir, "ts-client/index.ts"))
    let seen = ""
    const client = mod.createClient({
      baseUrl: "https://api.test",
      fetch: async (url: string) => {
        seen = String(url)
        return new Response("{}", { status: 200 })
      },
    })
    await client.getUser({ params: { id: "u1" } })
    expect(seen).toBe("https://api.test/api/users/u1")
    await client.listUsers({ query: { page: 2, role: "admin", active: true } })
    expect(seen).toBe("https://api.test/api/users?page=2&role=admin&active=true")
  })

  test("client snapshot", () => {
    expect(byPath["ts-client/client.ts"]).toMatchSnapshot()
  })
})
