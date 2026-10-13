import type { Ir, IrRoute } from "@ricada/core"
import { handlerName } from "@ricada/emitter-ts-common"
import { buildRegistry, exampleForFields, exampleForRef, validateRef } from "./schema.ts"
import type { Registry } from "./schema.ts"

export interface TestResult {
  method: string
  path: string
  handler: string
  status: number | null
  declared: boolean
  bodyValid: boolean
  pass: boolean
  detail: string
}

export interface TestReport {
  target: string
  results: TestResult[]
  summary: { total: number; passed: number; failed: number }
}

const buildPath = (reg: Registry, route: IrRoute): string => {
  let path = route.path
  const params = route.params.find((p) => p.in === "params")

  if (params) {
    for (const field of params.fields) {
      path = path.replace(`:${field.name}`, encodeURIComponent(String(exampleForRef(reg, field.type))))
    }
  }

  return path
}

const buildQuery = (reg: Registry, route: IrRoute): string => {
  const query = route.params.find((p) => p.in === "query")

  if (!query) return ""

  const parts: string[] = []

  for (const field of query.fields) {
    const value = exampleForRef(reg, field.type)
    parts.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(String(value))}`)
  }

  return parts.length > 0 ? `?${parts.join("&")}` : ""
}

const buildHeaders = (reg: Registry, route: IrRoute): Record<string, string> => {
  const headers: Record<string, string> = {}
  const block = route.params.find((p) => p.in === "headers")

  if (block) {
    for (const field of block.fields) {
      headers[field.name] = String(exampleForRef(reg, field.type))
    }
  }

  return headers
}

const buildBody = (reg: Registry, route: IrRoute): unknown => {
  const body = route.params.find((p) => p.in === "body")
  return body ? exampleForFields(reg, body.fields) : undefined
}

export const runTests = async (ir: Ir, target: string): Promise<TestReport> => {
  const reg = buildRegistry(ir)
  const results: TestResult[] = []

  for (const route of ir.routes) {
    const name = handlerName(route)
    const url = target.replace(/\/$/, "") + buildPath(reg, route) + buildQuery(reg, route)
    const headers = buildHeaders(reg, route)
    const body = buildBody(reg, route)

    const statuses = new Set<number>()
    for (const r of route.returns) statuses.add(r.status ?? 200)
    for (const e of route.errors) statuses.add(e.status)

    let response: Response

    try {
      const init: RequestInit = { method: route.method, headers }

      if (body !== undefined) {
        headers["content-type"] = "application/json"
        init.body = JSON.stringify(body)
      }

      response = await fetch(url, init)
    } catch (err) {
      results.push({
        method: route.method,
        path: route.path,
        handler: name,
        status: null,
        declared: false,
        bodyValid: false,
        pass: false,
        detail: `request failed: ${(err as Error).message}`,
      })
      continue
    }

    const text = await response.text()
    let data: unknown = undefined

    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = text
    }

    const declared = statuses.has(response.status)
    const success =
      route.returns.find(
        (r) => (r.status === null || (r.status >= 200 && r.status < 300)) && (r.status ?? 200) === response.status,
      ) ?? route.returns.find((r) => r.status === null || (r.status >= 200 && r.status < 300))

    const bodyValid = success?.type ? validateRef(reg, success.type, data) : true
    const pass = declared && bodyValid

    results.push({
      method: route.method,
      path: route.path,
      handler: name,
      status: response.status,
      declared,
      bodyValid,
      pass,
      detail: pass ? "ok" : !declared ? `unexpected status ${response.status}` : "invalid response body",
    })
  }

  return {
    target,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
    },
  }
}

export const formatTestReport = (report: TestReport): string => {
  const header = `${"ROUTE".padEnd(42)} ${"HANDLER".padEnd(20)} STATUS RESULT`

  const rows = report.results.map((r) => {
    const route = `${r.method} ${r.path}`
    const status = (r.status === null ? "-" : String(r.status)).padEnd(6)
    return `${route.padEnd(42)} ${r.handler.padEnd(20)} ${status} ${r.pass ? "PASS" : `FAIL (${r.detail})`}`
  })

  return [
    header,
    "-".repeat(header.length),
    ...rows,
    "",
    `target: ${report.target}`,
    `summary: ${report.summary.total} routes, ${report.summary.passed} passed, ${report.summary.failed} failed`,
  ].join("\n")
}
