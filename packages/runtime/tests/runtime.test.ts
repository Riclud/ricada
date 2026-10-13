import { describe, expect, test } from "bun:test"
import { createHmac } from "crypto"
import { Buffer } from "buffer"
import { compile } from "@ricada/core"
import type { RequestInput } from "../src/index.ts"
import { createHandler, HttpError } from "../src/index.ts"

const JWT_SECRET = "test-jwt-secret"
const API_KEY = "test-api-key"
const FIXED_UUID = "550e8400-e29b-41d4-a716-446655440000"

const contract = `
config {
  targets: [ts-server]
  out: "./generated"
  wire: json
  auth {
    bearer { type: jwt, secret: env("TEST_JWT_SECRET"), algorithm: HS256 }
    apiKey { type: apiKey, in: header, name: "X-API-Key", key: env("TEST_API_KEY") }
  }
  cors { origins: ["https://app.example"], methods: [GET, POST], headers: ["Authorization"], credentials: true, maxAge: "1h" }
  security { headers { hsts: true, xContentTypeOptions: nosniff, xFrameOptions: DENY, referrerPolicy: "no-referrer" } }
  rateLimit { algorithm: tokenBucket, store: memory }
}

type FieldIssue { field: string, reason: string }
type User { id: string @uuid, name: string @min(1), email: string @email }

error BadRequest { message: string, code: string = "BAD_REQUEST", fields: FieldIssue[] }
error Unauthorized { message: string, code: string = "UNAUTHORIZED" }
error Forbidden { message: string, code: string = "FORBIDDEN" }
error NotFound { message: string, code: string = "NOT_FOUND" }
error TooManyRequests { message: string, retryAfter: int }

/api {
  GET /users {
    @auth(bearer, scopes: ["read:users"])
    query { page: int? @min(1) }
    returns 200: User[]
    errors { 401: Unauthorized, 403: Forbidden }
    handler listUsers
  }

  GET /users/:id {
    @auth(bearer)
    params { id: string @uuid }
    returns 200: User
    errors { 401: Unauthorized, 404: NotFound }
    handler getUser
  }

  POST /users {
    @auth(public: true)
    body { name: string @min(1), email: string @email }
    returns 201: User
    errors { 400: BadRequest }
    handler createUser
  }

  GET /admin/stats {
    @auth(bearer, roles: ["admin"])
    returns 200: User[]
    errors { 401: Unauthorized, 403: Forbidden }
    handler stats
  }

  GET /broken {
    returns 200: User
    handler broken
  }

  GET /throttled {
    @rateLimit(limit: 5, window: "1m", key: ip, burst: 3)
    returns 200: User[]
    errors { 429: TooManyRequests }
    handler listUsers
  }

  GET /keys {
    @auth(apiKey)
    returns 200: User[]
    errors { 401: Unauthorized }
    handler listUsers
  }
}
`

const ir = compile(contract)

const user = { id: FIXED_UUID, name: "Jane", email: "jane@example.com" }

const handlers = {
  listUsers() {
    return [user]
  },

  getUser(input: RequestInput) {
    if (input.params.id !== FIXED_UUID) throw new HttpError(404, undefined)

    return user
  },

  createUser(input: RequestInput) {
    const { name, email } = input.body as { name: string; email: string }
    return { id: crypto.randomUUID(), name, email }
  },

  stats() {
    return []
  },

  broken() {
    return { nope: true }
  },
}

const b64 = (value: string): string => Buffer.from(value).toString("base64url")

const signToken = (claims: Record<string, unknown>): string => {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64(JSON.stringify(claims))
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url")

  return `${header}.${payload}.${signature}`
}

const app = createHandler(ir, handlers, {
  env: (name) => (name === "TEST_JWT_SECRET" ? JWT_SECRET : name === "TEST_API_KEY" ? API_KEY : undefined),
})

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  forwarded?: string
  origin?: string
}

const request = (path: string, opts: RequestOptions = {}): Promise<Response> => {
  const headers = new Headers(opts.headers)
  headers.set("x-forwarded-for", opts.forwarded ?? "9.9.9.9")

  if (opts.origin) headers.set("origin", opts.origin)

  const init: RequestInit = {}

  if (opts.method) init.method = opts.method

  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

  return app(new Request(`http://api.test${path}`, { ...init, headers }))
}

const authorized = (claims: Record<string, unknown>): Record<string, string> => ({
  Authorization: `Bearer ${signToken(claims)}`,
})

describe("runtime: auth", () => {
  test("rejects missing credentials", async () => {
    const res = await request("/api/users")
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }))
  })

  test("accepts a token with the required scope", async () => {
    const res = await request("/api/users", { headers: authorized({ sub: "u1", scopes: ["read:users"] }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([user])
  })

  test("rejects a token without the required scope", async () => {
    const res = await request("/api/users", { headers: authorized({ sub: "u1", scopes: [] }) })
    expect(res.status).toBe(403)
  })

  test("enforces the admin role", async () => {
    const admin = await request("/api/admin/stats", { headers: authorized({ sub: "a1", roles: ["admin"] }) })
    expect(admin.status).toBe(200)

    const user = await request("/api/admin/stats", { headers: authorized({ sub: "u1" }) })
    expect(user.status).toBe(403)
  })

  test("rejects a tampered token", async () => {
    const valid = signToken({ sub: "u1" })
    const tampered = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A")
    const res = await request("/api/users", { headers: { Authorization: `Bearer ${tampered}` } })
    expect(res.status).toBe(401)
  })

  test("accepts a valid api key", async () => {
    const ok = await request("/api/keys", { headers: { "X-API-Key": API_KEY } })
    expect(ok.status).toBe(200)

    const bad = await request("/api/keys", { headers: { "X-API-Key": "wrong" } })
    expect(bad.status).toBe(401)
  })

  test("public routes bypass auth", async () => {
    const res = await request("/api/users", {
      method: "POST",
      body: { name: "Jane", email: "jane@example.com" },
    })
    expect(res.status).toBe(201)
  })
})

describe("runtime: validation", () => {
  test("rejects an invalid body with field issues", async () => {
    const res = await request("/api/users", { method: "POST", body: { name: "", email: "nope" } })
    expect(res.status).toBe(400)

    const body = (await res.json()) as { code: string; fields: Array<{ field: string; reason: string }> }
    expect(body.code).toBe("BAD_REQUEST")
    expect(body.fields).toEqual(
      expect.arrayContaining([
        { field: "name", reason: "must be at least 1 chars" },
        { field: "email", reason: "not an email" },
      ]),
    )
  })

  test("rejects an invalid path param uuid", async () => {
    const res = await request("/api/users/not-a-uuid", { headers: authorized({ sub: "u1" }) })
    expect(res.status).toBe(400)
  })

  test("returns 404 for a missing resource", async () => {
    const res = await request("/api/users/00000000-0000-0000-0000-000000000000", { headers: authorized({ sub: "u1" }) })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(expect.objectContaining({ code: "NOT_FOUND" }))
  })

  test("validates the handler output against returns", async () => {
    const res = await request("/api/broken")
    expect(res.status).toBe(500)

    const body = (await res.json()) as { message: string }
    expect(body.message).toBe("response failed validation")
  })
})

describe("runtime: rate limit", () => {
  test("allows up to the burst and then returns 429", async () => {
    const hit = (): Promise<Response> => request("/api/throttled", { forwarded: "2.2.2.2" })

    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200)

    const blocked = await hit()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("retry-after")).not.toBeNull()

    const body = (await blocked.json()) as { retryAfter: number }
    expect(body.retryAfter).toBeGreaterThan(0)
  })
})

describe("runtime: cors and security headers", () => {
  test("answers preflight with 204 and cors headers", async () => {
    const res = await app(
      new Request("http://api.test/api/users", {
        method: "OPTIONS",
        headers: { origin: "https://app.example", "access-control-request-method": "GET" },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example")
    expect(res.headers.get("access-control-allow-methods")).toContain("GET")
    expect(res.headers.get("access-control-max-age")).toBe("1h")
  })

  test("does not allow disallowed origins", async () => {
    const res = await request("/api/users", {
      headers: authorized({ sub: "u1" }),
      origin: "https://evil.example",
    })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("adds security headers to every response", async () => {
    const res = await request("/api/broken")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000")
  })
})
