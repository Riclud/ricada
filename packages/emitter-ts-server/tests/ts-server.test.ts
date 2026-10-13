import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { compile } from "@ricada/core"
import { emitTsServer } from "../src/index.ts"

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const basicPath = join(repoRoot, "examples/basic.ricada")
const ir = compile(readFileSync(basicPath, "utf-8"), { baseDir: dirname(basicPath) })
const files = emitTsServer(ir)
const byPath = Object.fromEntries(files.map((f) => [f.path, f.contents]))

describe("ts-server emitter", () => {
  test("emits types, contract and index", () => {
    expect(files.map((f) => f.path)).toEqual(["ts-server/types.ts", "ts-server/contract.ts", "ts-server/index.ts"])
  })

  test("contract defines Handlers, RouteName and defineHandlers", () => {
    const code = byPath["ts-server/contract.ts"]!
    expect(code).toContain("export interface Handlers {")
    expect(code).toContain("export type RouteName = keyof Handlers")
    expect(code).toContain("export function defineHandlers<H extends Handlers>")
    expect(code).toContain("listUsers(input: ListUsersInput): Promise<T.PageOfUser> | T.PageOfUser;")
    expect(code).toContain("deleteUser(input: DeleteUserInput): Promise<void> | void;")
  })

  test("types file renders enums, unions and errors", () => {
    const code = byPath["ts-server/types.ts"]!
    expect(code).toContain("export type Role = (typeof Role)[keyof typeof Role];")
    expect(code).toContain("export type Shape = Circle | Square;")
    expect(code).toContain("export interface NotFound {")
  })

  test("quotes header field names in inputs", () => {
    const code = byPath["ts-server/contract.ts"]!
    expect(code).toContain('"x-request-id"?: string')
  })

  test("generated code typechecks with tsc", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ricada-tsserver-"))
    for (const file of files) {
      await writeFile(join(dir, file.path.replace("ts-server/", "")), file.contents)
    }
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
          lib: ["esnext"],
        },
        include: ["*.ts"],
      }),
    )
    const proc = Bun.spawnSync([
      "bun",
      join(repoRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      join(dir, "tsconfig.json"),
    ])
    const output = proc.stdout.toString() + proc.stderr.toString()
    expect(output).toBe("")
  })

  test("contract snapshot", () => {
    expect(byPath["ts-server/contract.ts"]).toMatchSnapshot()
  })

  test("types snapshot", () => {
    expect(byPath["ts-server/types.ts"]).toMatchSnapshot()
  })
})
