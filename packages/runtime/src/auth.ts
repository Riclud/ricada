import { createHmac, timingSafeEqual } from "crypto"
import { Buffer } from "buffer"
import type { Ir, IrConfigAuthScheme, IrAnnotation } from "@ricada/core"
import type { Identity, RuntimeOptions } from "./types.ts"
import { HttpError } from "./types.ts"
import { argAt, findAnnotation, namedArg, resolveSecret, valueText, valueTexts } from "./values.ts"

const toB64 = (buf: Buffer): string => buf.toString("base64url")
const fromB64 = (s: string): Buffer => Buffer.from(s, "base64url")

const sign = (secret: string, header: string, payload: string): string =>
  toB64(createHmac("sha256", secret).update(`${header}.${payload}`).digest())

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)

  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

const verifyJwt = (token: string, secret: string): Record<string, unknown> | null => {
  const parts = token.split(".")

  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const expected = sign(secret, header!, payload!)

  if (!safeEqual(expected, signature!)) return null

  try {
    const decoded = JSON.parse(fromB64(payload!).toString("utf-8"))

    return typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const bearerToken = (req: Request): string | null => {
  const auth = req.headers.get("authorization")

  if (!auth?.toLowerCase().startsWith("bearer ")) return null

  return auth.slice(7).trim() || null
}

export interface AuthPolicy {
  name: string | null
  scopes: string[]
  roles: string[]
}

export const authPolicyFor = (route: { annotations: IrAnnotation[] }): AuthPolicy | null => {
  const ann = findAnnotation(route.annotations, "auth")

  if (!ann) return null

  const isPublic = valueText(namedArg(ann, "public")) === "true"

  return {
    name: isPublic ? null : (valueText(argAt(ann, 0)) ?? null),
    scopes: valueTexts(namedArg(ann, "scopes")),
    roles: valueTexts(namedArg(ann, "roles")),
  }
}

const checkScopesAndRoles = (scopes: string[], roles: string[], claims: Record<string, unknown>): void => {
  const claimScopes = claims["scopes"]
  const claimRoles = claims["roles"]
  const hasAllScopes = scopes.every((s) => Array.isArray(claimScopes) && claimScopes.includes(s))
  const hasAnyRole = roles.length === 0 || (Array.isArray(claimRoles) && roles.some((r) => claimRoles.includes(r)))

  if (!hasAllScopes || !hasAnyRole) throw new HttpError(403, undefined)
}

const verifyScheme = (
  name: string,
  scheme: IrConfigAuthScheme,
  req: Request,
  env: (key: string) => string | undefined,
): Identity => {
  if (scheme.type === "jwt") {
    const token = bearerToken(req)

    if (!token) throw new HttpError(401, undefined)

    const secret = resolveSecret(scheme.secret ?? undefined, env)

    if (!secret) throw new HttpError(500, undefined)

    const claims = verifyJwt(token, secret)

    if (!claims) throw new HttpError(401, undefined)

    const subject = typeof claims["sub"] === "string" ? (claims["sub"] as string) : null

    return { scheme: name, subject, claims }
  }

  if (scheme.type === "apiKey") {
    const key = resolveSecret(scheme.secret ?? undefined, env)
    const provided = req.headers.get(scheme.name ?? "X-Api-Key")

    if (!key || !provided || !safeEqual(provided, key)) throw new HttpError(401, undefined)

    return { scheme: name, subject: null, claims: {} }
  }

  return { scheme: name, subject: null, claims: {} }
}

export const applyAuth = (ir: Ir, policy: AuthPolicy | null, req: Request, opts: RuntimeOptions): Identity => {
  if (!policy || !policy.name) return { scheme: "public", subject: null, claims: {} }

  const env = opts.env ?? ((name: string) => process.env[name])
  const scheme = ir.config.auth?.[policy.name]

  if (!scheme) throw new HttpError(401, undefined)

  const identity = verifyScheme(policy.name, scheme, req, env)
  checkScopesAndRoles(policy.scopes, policy.roles, identity.claims)
  return identity
}
