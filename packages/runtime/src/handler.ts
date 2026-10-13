import type { Ir, IrRoute } from "@ricada/core"
import type { HandlerMap, RequestInput, RuntimeOptions } from "./types.ts"
import { HttpError } from "./types.ts"
import { applyBlockDefaults, buildTypeMap, matchOutput, validateRequestInput } from "./validate.ts"
import { applyAuth, authPolicyFor } from "./auth.ts"
import { bucketConfigFor, MemoryStore, rateLimitKey } from "./rateLimit.ts"
import { corsHeaders, securityHeaders } from "./headers.ts"
import { toJs } from "./values.ts"

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL",
  501: "NOT_IMPLEMENTED",
}

const ERROR_NAME_BY_STATUS: Record<number, string> = {
  400: "BadRequest",
  401: "Unauthorized",
  403: "Forbidden",
  404: "NotFound",
  409: "Conflict",
  429: "TooManyRequests",
}

const errorBody = (ir: Ir, route: IrRoute | null, status: number, extra?: Record<string, unknown>): unknown => {
  const declared = route?.errors.find((e) => e.status === status)
  const name = declared?.type ?? ERROR_NAME_BY_STATUS[status]
  const type = name ? ir.errors.find((e) => e.name === name) : undefined

  if (!type) return { message: STATUS_TEXT[status] ?? "Error", code: CODE_BY_STATUS[status] ?? "ERROR" }

  const fallbackCode = CODE_BY_STATUS[status] ?? (name ? name.toUpperCase() : "ERROR")
  const body: Record<string, unknown> = {}

  for (const field of type.fields) {
    if (extra && field.name in extra) {
      body[field.name] = extra[field.name]
    } else if (field.default !== null) {
      const def = toJs(field.default)
      if (def !== undefined) body[field.name] = def
    } else if (field.name === "message") {
      body[field.name] = STATUS_TEXT[status] ?? "Request failed"
    } else if (field.name === "code") {
      body[field.name] = fallbackCode
    }
  }

  return body
}

interface CompiledRoute {
  route: IrRoute
  pattern: RegExp
  keys: string[]
}

const escapeSegment = (seg: string): string => seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const compileRoute = (route: IrRoute): CompiledRoute => {
  const keys: string[] = []
  let pattern = "^"

  for (const seg of route.path.split("/")) {
    if (seg === "") continue

    if (seg.startsWith(":")) {
      keys.push(seg.slice(1))
      pattern += "/([^/]+)"
    } else {
      pattern += "/" + escapeSegment(seg)
    }
  }

  return { route, pattern: new RegExp(`${pattern}$`), keys }
}

const paramsFromMatch = (match: RegExpExecArray, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {}

  keys.forEach((key, index) => {
    out[key] = match[index + 1] ?? ""
  })

  return out
}

const buildQuery = (route: IrRoute, url: URL): Record<string, unknown> => {
  const block = route.params.find((p) => p.in === "query")
  const out: Record<string, unknown> = {}

  if (!block) return out

  for (const field of block.fields) {
    if (!url.searchParams.has(field.name)) continue

    const all = url.searchParams.getAll(field.name)
    out[field.name] = field.type.array ? all : all[0]
  }

  return out
}

const buildRequestHeaders = (route: IrRoute, req: Request): Record<string, unknown> => {
  const block = route.params.find((p) => p.in === "headers")
  const out: Record<string, unknown> = {}

  if (!block) return out

  for (const field of block.fields) {
    const value = req.headers.get(field.name)

    if (value !== null) out[field.name] = value
  }

  return out
}

const hasBodyBlock = (route: IrRoute): boolean => route.params.some((p) => p.in === "body")

const parseBody = async (route: IrRoute, req: Request): Promise<unknown> => {
  if (!hasBodyBlock(route)) return undefined

  const text = await req.text()

  if (!text) return undefined

  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, undefined)
  }
}

const respond = (status: number, body: unknown, headers: Headers): Response => {
  if (status === 204 || body === undefined) return new Response(null, { status, headers })

  return Response.json(body, { status, headers })
}

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const isHttpErrorLike = (err: unknown): err is { status: number; body?: unknown } =>
  typeof err === "object" && err !== null && typeof (err as { status?: unknown }).status === "number"

const handlerError = (ir: Ir, route: IrRoute, err: unknown, headers: Headers): Response => {
  if (err instanceof HttpError) {
    return respond(err.status, errorBody(ir, route, err.status, toRecord(err.body)), headers)
  }

  if (isHttpErrorLike(err)) {
    return respond(err.status, err.body ?? errorBody(ir, route, err.status), headers)
  }

  const message = err instanceof Error ? err.message : undefined
  return respond(500, errorBody(ir, route, 500, message !== undefined ? { message } : undefined), headers)
}

export const createHandler = (
  ir: Ir,
  handlers: HandlerMap,
  opts: RuntimeOptions = {},
): ((req: Request) => Promise<Response>) => {
  const types = buildTypeMap(ir)
  const routes = ir.routes.map(compileRoute)
  const store = new MemoryStore()
  const baseSecurity = securityHeaders(ir)

  return async (req: Request): Promise<Response> => {
    const headers = new Headers(baseSecurity)

    for (const [key, value] of corsHeaders(ir, req)) headers.set(key, value)

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers })
    }

    const url = new URL(req.url)
    const matched = routes.find((r) => r.route.method === req.method && r.pattern.test(url.pathname))

    if (!matched) return respond(404, errorBody(ir, null, 404), headers)

    const { route, pattern, keys } = matched
    const match = pattern.exec(url.pathname)

    if (!match) return respond(404, errorBody(ir, null, 404), headers)

    let body: unknown

    try {
      body = await parseBody(route, req)
    } catch (err) {
      if (err instanceof HttpError) {
        return respond(err.status, errorBody(ir, route, err.status, { fields: [] }), headers)
      }

      throw err
    }

    const input: RequestInput = {
      params: paramsFromMatch(match, keys),
      query: buildQuery(route, url),
      headers: buildRequestHeaders(route, req),
      body,
      identity: null,
    }

    applyBlockDefaults(route, input)

    const issues = validateRequestInput(route, input, types)

    if (issues.length > 0) {
      return respond(400, errorBody(ir, route, 400, { fields: issues }), headers)
    }

    const policy = authPolicyFor(route)

    try {
      input.identity = applyAuth(ir, policy, req, opts)
    } catch (err) {
      if (err instanceof HttpError) {
        return respond(err.status, errorBody(ir, route, err.status), headers)
      }

      throw err
    }

    const bucket = bucketConfigFor(route, ir)
    const key = rateLimitKey(route, ir, input, req)
    const taken = store.take(key, bucket.capacity, bucket.refillPerSec)

    headers.set("X-RateLimit-Limit", String(bucket.capacity))
    headers.set("X-RateLimit-Remaining", String(taken.remaining))

    if (!taken.allowed) {
      headers.set("Retry-After", String(taken.retryAfter))
      return respond(429, errorBody(ir, route, 429, { retryAfter: taken.retryAfter }), headers)
    }

    const handlerName = route.handler

    if (!handlerName || !handlers[handlerName]) {
      return respond(501, errorBody(ir, route, 501), headers)
    }

    let data: unknown

    try {
      data = await handlers[handlerName]!(input)
    } catch (err) {
      return handlerError(ir, route, err, headers)
    }

    const output = matchOutput(route, data, types)

    if (!output.ok) {
      return respond(500, { message: "response failed validation", reason: output.reason }, headers)
    }

    return respond(output.status, output.hasBody ? data : undefined, headers)
  }
}
