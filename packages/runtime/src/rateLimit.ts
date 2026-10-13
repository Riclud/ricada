import type { Ir, IrRoute, IrValue } from "@ricada/core"
import type { RequestInput } from "./types.ts"
import { findAnnotation, namedArg, valueNumber, valueText } from "./values.ts"

interface Bucket {
  tokens: number
  refilledAt: number
}

export class MemoryStore {
  private buckets = new Map<string, Bucket>()

  take(
    key: string,
    capacity: number,
    refillPerSec: number,
    now = Date.now() / 1000,
  ): { allowed: boolean; remaining: number; retryAfter: number } {
    const prev = this.buckets.get(key)
    let tokens = capacity
    const refilledAt = now

    if (prev) {
      const elapsed = Math.max(0, now - prev.refilledAt)
      tokens = Math.min(capacity, prev.tokens + elapsed * refillPerSec)
    }

    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, refilledAt })
      return { allowed: true, remaining: Math.floor(tokens - 1), retryAfter: 0 }
    }

    this.buckets.set(key, { tokens, refilledAt })
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((1 - tokens) / Math.max(refillPerSec, 1e-9)) }
  }
}

export interface BucketConfig {
  capacity: number
  refillPerSec: number
}

const parseWindow = (window: string): number => {
  const s = /^(\d+)([smhd])$/.exec(window)

  if (!s) return 60

  const n = Number(s[1])
  const unit = s[2]!

  if (unit === "s") return n
  if (unit === "m") return n * 60
  if (unit === "h") return n * 3600
  return n * 86400
}

export const bucketConfigFor = (route: IrRoute, ir: Ir): BucketConfig => {
  const ann = findAnnotation(route.annotations, "rateLimit")
  const def = ir.config.rateLimit?.default

  const limit = (ann ? valueNumber(namedArg(ann, "limit")) : null) ?? def?.limit ?? 1000
  const window = (ann ? valueText(namedArg(ann, "window")) : null) ?? def?.window ?? "1m"
  const burstRaw = ann ? valueNumber(namedArg(ann, "burst")) : null

  return { capacity: burstRaw ?? def?.burst ?? limit, refillPerSec: limit / parseWindow(window) }
}

const keySpecFor = (route: IrRoute, ir: Ir): IrValue | undefined => {
  const ann = findAnnotation(route.annotations, "rateLimit")

  if (ann) {
    const key = namedArg(ann, "key")

    if (key) return key
  }

  const defKey = ir.config.rateLimit?.default?.key

  if (defKey) return { kind: "word", value: defKey }

  return undefined
}

export const rateLimitKey = (route: IrRoute, ir: Ir, input: RequestInput, req: Request): string => {
  const spec = keySpecFor(route, ir)
  const text = valueText(spec)

  if (text === "ip") {
    const forwarded = req.headers.get("x-forwarded-for")
    return forwarded?.split(",")[0]?.trim() || "local"
  }

  if (text === "route") return `${route.method} ${route.path}`

  if (text === "jwt.sub") return input.identity?.subject ?? "anon"

  if (text?.startsWith("param:")) {
    const name = text.slice("param:".length)
    return String(input.params[name] ?? "")
  }

  if (spec?.kind === "call" && spec.name === "header") {
    const arg = spec.args[0]

    if (arg?.kind === "string") return req.headers.get(arg.value) ?? "missing"
  }

  return `${route.method} ${route.path}`
}
