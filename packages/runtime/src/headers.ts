import type { Ir } from "@ricada/core"

export const corsHeaders = (ir: Ir, req: Request): Headers => {
  const headers = new Headers()
  const cors = ir.config.cors

  if (!cors) return headers

  const origin = req.headers.get("origin") ?? null
  const allowAll = cors.origins.includes("*")

  if (origin !== null && (allowAll || cors.origins.includes(origin))) {
    headers.set("Access-Control-Allow-Origin", origin)
  } else if (allowAll && origin === null) {
    headers.set("Access-Control-Allow-Origin", "*")
  }

  if (cors.methods.length > 0) headers.set("Access-Control-Allow-Methods", cors.methods.join(", "))

  if (cors.headers.length > 0) headers.set("Access-Control-Allow-Headers", cors.headers.join(", "))

  if (cors.credentials) headers.set("Access-Control-Allow-Credentials", "true")

  if (cors.maxAge) headers.set("Access-Control-Max-Age", cors.maxAge)

  return headers
}

export const securityHeaders = (ir: Ir): Headers => {
  const headers = new Headers()
  const security = ir.config.security

  if (!security) return headers

  if (security.hsts) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

  if (security.xContentTypeOptions) headers.set("X-Content-Type-Options", "nosniff")

  if (security.xFrameOptions) headers.set("X-Frame-Options", security.xFrameOptions)

  if (security.referrerPolicy) headers.set("Referrer-Policy", security.referrerPolicy)

  if (security.contentSecurityPolicy) headers.set("Content-Security-Policy", security.contentSecurityPolicy)

  return headers
}
