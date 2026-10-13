import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compile, ImportError, lex, loadImports, parse } from "../src/index.ts"

const fixture = async (files: Record<string, string>): Promise<{ dir: string; read: (p: string) => string }> => {
  const dir = await mkdtemp(join(tmpdir(), "ricada-mod-"))
  const read = (p: string): string => {
    const key = Object.keys(files).find((k) => join(dir, k) === p)

    if (!key) throw new Error(`cannot read ${p}`)

    return files[key]!
  }
  return { dir, read }
}

describe("module imports", () => {
  test("merges imported declarations before the importing module", async () => {
    const { dir, read } = await fixture({
      "types.ricada": "type Common { id: string }\n",
      "main.ricada": 'import "./types.ricada"\ntype Own { a: string }\n',
    })

    const ast = loadImports(parse(lex(read(join(dir, "main.ricada")))), { baseDir: dir, read })

    expect(ast.declarations.map((d) => (d.kind === "import" ? "import" : d.name))).toEqual(["Common", "Own"])
  })

  test("resolves types from an imported module through compile", async () => {
    const { dir, read } = await fixture({
      "user.ricada": "type User { id: string }\ntype PageOfUser { items: User[] }\n",
      "main.ricada": 'import "./user.ricada"\n/api { GET /users { returns 200: PageOfUser handler list } }\n',
    })

    const ir = compile(read(join(dir, "main.ricada")), { baseDir: dir, read })

    expect(ir.types.map((t) => t.name)).toEqual(["User", "PageOfUser"])
    expect(ir.routes[0].returns[0].type?.name).toBe("PageOfUser")
  })

  test("dedupes a module imported through different parents", async () => {
    const { dir, read } = await fixture({
      "shared.ricada": "type Shared { id: string }\n",
      "a.ricada": 'import "./shared.ricada"\ntype A { s: Shared }\n',
      "main.ricada": 'import "./a.ricada"\nimport "./shared.ricada"\ntype B { s: Shared }\n',
    })

    const ir = compile(read(join(dir, "main.ricada")), { baseDir: dir, read })

    expect(ir.types.filter((t) => t.name === "Shared")).toHaveLength(1)
    expect(ir.types.map((t) => t.name)).toEqual(["Shared", "A", "B"])
  })

  test("throws on circular imports", async () => {
    const { dir, read } = await fixture({
      "a.ricada": 'import "./b.ricada"\ntype A { b: B }\n',
      "b.ricada": 'import "./a.ricada"\ntype B { a: A }\n',
      "main.ricada": 'import "./a.ricada"\n',
    })

    expect(() => compile(read(join(dir, "main.ricada")), { baseDir: dir, read })).toThrow(ImportError)
  })

  test("wraps a missing import file into ImportError", async () => {
    const { dir, read } = await fixture({
      "main.ricada": 'import "./nope.ricada"\n',
    })

    expect(() => compile(read(join(dir, "main.ricada")), { baseDir: dir, read })).toThrow(ImportError)
  })
})
