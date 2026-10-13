import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { dirname } from "path"
import { fileURLToPath } from "url"
import { compile } from "../src/resolve.ts"
import { ResolveError } from "../src/errors.ts"
import type { IrAliasType, IrField, IrObjectType } from "../src/ir.ts"

const basicPath = fileURLToPath(new URL("../../../examples/basic.ricada", import.meta.url))

const findAlias = (ir: ReturnType<typeof compile>, name: string): IrAliasType =>
  ir.types.find((t) => t.kind === "alias" && t.name === name) as IrAliasType

describe("resolver / IR", () => {
  test("classifies type references", () => {
    const ir = compile(`
type Address { city: string }
type T {
  a: string
  b: Address
  c: "circle"
  d: Address[]
  e: null
}
`)
    const t = ir.types.find((x) => x.name === "T") as IrObjectType
    expect(t.fields.map((f: IrField) => f.type.kind)).toEqual(["primitive", "named", "literal", "named", "null"])
    expect(t.fields[3].type.array).toBe(true)
  })

  test("flattens nested group paths", () => {
    const ir = compile(`
/api { GET /users { handler a } }
/v2 { /users { GET /me { handler b } } }
`)
    expect(ir.routes.map((r) => r.path)).toEqual(["/api/users", "/v2/users/me"])
    expect(ir.routes.map((r) => r.groupPrefix)).toEqual(["/api", "/v2/users"])
  })

  test("detects discriminated unions", () => {
    const ir = compile(`
type Circle { kind: "circle", radius: float }
type Square { kind: "square", side: float }
type Shape = Circle | Square
`)
    const shape = findAlias(ir, "Shape")
    expect(shape.discriminated).toBe(true)
    expect(shape.tag).toBe("kind")
  })

  test("marks primitive unions as not discriminated", () => {
    const ir = compile("type Id = string | int")
    const id = findAlias(ir, "Id")
    expect(id.discriminated).toBe(false)
    expect(id.tag).toBeNull()
  })

  test("throws on unknown type reference", () => {
    expect(() => compile("type T { a: Missing }")).toThrow(ResolveError)
  })

  test("throws on unknown error reference", () => {
    expect(() => compile("/api { GET /x { errors { 400: Nope } handler h } }")).toThrow(ResolveError)
  })

  test("throws on duplicate type names", () => {
    expect(() => compile("type T { a: string }\ntype T { b: string }")).toThrow(ResolveError)
  })

  test("extracts config targets/out/wire", () => {
    const ir = compile('config { targets: [ts-client, docs] out: "./generated" wire: json }')
    expect(ir.config.targets).toEqual(["ts-client", "docs"])
    expect(ir.config.out).toBe("./generated")
    expect(ir.config.wire).toBe("json")
  })

  test("extracts typed auth, cors, security, rateLimit and control config", () => {
    const ir = compile(`
config {
  auth {
    bearer { type: jwt, issuer: env("HOST"), secret: env("S"), algorithm: HS256 }
    apiKey { type: apiKey, in: header, name: "X-Key", key: env("K") }
  }
  cors { origins: [env("ORIGIN")], methods: [GET, POST], headers: ["Authorization"], credentials: true, maxAge: "1h" }
  security { headers { hsts: true, xFrameOptions: DENY, referrerPolicy: "no-referrer" } }
  rateLimit { algorithm: tokenBucket, store: memory, default { limit: 1000, window: "1m", key: ip, burst: 50 } }
  control { secret: env("CTL"), allow: [rateLimit, deny] }
}
`)

    expect(ir.config.auth).toEqual({
      bearer: expect.objectContaining({ type: "jwt", issuer: null, algorithm: "HS256" }),
      apiKey: expect.objectContaining({ type: "apiKey", location: "header", name: "X-Key" }),
    })
    expect(ir.config.cors).toEqual(
      expect.objectContaining({
        origins: [],
        methods: ["GET", "POST"],
        credentials: true,
        maxAge: "1h",
      }),
    )
    expect(ir.config.security).toEqual(expect.objectContaining({ hsts: true, xFrameOptions: "DENY" }))
    expect(ir.config.rateLimit).toEqual(expect.objectContaining({ algorithm: "tokenBucket", store: "memory" }))
    expect(ir.config.rateLimit!.default).toEqual({ limit: 1000, window: "1m", key: "ip", burst: 50 })
    expect(ir.config.control).toEqual({ secret: expect.any(Object), allow: ["rateLimit", "deny"] })
  })

  test("resolves the reference example without errors", () => {
    const source = readFileSync(basicPath, "utf-8")
    expect(() => compile(source, { baseDir: dirname(basicPath) })).not.toThrow()
  })

  test("reference example IR snapshot", () => {
    const source = readFileSync(basicPath, "utf-8")
    expect(compile(source, { baseDir: dirname(basicPath) })).toMatchSnapshot()
  })
})
