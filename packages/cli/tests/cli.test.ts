import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import { run } from "../src/index.ts"

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))

describe("cli", () => {
  test("check succeeds on the reference example", async () => {
    expect(await run(["check", basicPath])).toBe(0)
  })

  test("check fails on an invalid contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ricada-"))
    const bad = join(dir, "bad.ricada")
    await writeFile(bad, "type T { a: Missing }\n")
    expect(await run(["check", bad])).toBe(1)
  })

  test("returns 1 when the file is missing", async () => {
    expect(await run(["check", "/nope/does-not-exist.ricada"])).toBe(1)
  })
})
