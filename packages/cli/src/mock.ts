import type { Ir, IrRoute } from "@ricada/core"
import { buildRegistry, exampleForRef } from "./schema.ts"

const successReturn = (route: IrRoute) => {
  return route.returns.find((r) => r.status === null || (r.status >= 200 && r.status < 300))
}

const pathToRegex = (path: string): RegExp => {
  const pattern = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z0-9_]+/g, "[^/]+")
  return new RegExp(`^${pattern}$`)
}

export interface MockRoute {
  method: string
  path: string
  pattern: RegExp
  status: number
  hasBody: boolean
  body: unknown
}

export const buildMockRoutes = (ir: Ir): MockRoute[] => {
  const reg = buildRegistry(ir)

  return ir.routes.map((route) => {
    const ret = successReturn(route)

    return {
      method: route.method,
      path: route.path,
      pattern: pathToRegex(route.path),
      status: ret?.status ?? 200,
      hasBody: ret?.type != null,
      body: ret?.type ? exampleForRef(reg, ret.type) : undefined,
    }
  })
}

export const createMockHandler = (ir: Ir): ((req: Request) => Response) => {
  const routes = buildMockRoutes(ir)

  return (req: Request): Response => {
    const url = new URL(req.url)
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname))

    if (!route) return new Response("Not Found", { status: 404 })

    if (!route.hasBody) return new Response(null, { status: route.status })

    return Response.json(route.body, { status: route.status })
  }
}
