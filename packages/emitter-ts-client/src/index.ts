import type { EmittedFile, Ir, IrRoute } from "@ricada/core"
import {
  annotationString,
  handlerName,
  inputTypeName,
  renderErrorDecl,
  renderInputInterface,
  renderTypeDecl,
  renderValidators,
  routeOutputType,
} from "@ricada/emitter-ts-common"

function renderTypes(ir: Ir): string {
  const parts: string[] = []
  for (const type of ir.types) parts.push(renderTypeDecl(type))
  for (const error of ir.errors) parts.push(renderErrorDecl(error))
  for (const route of ir.routes) {
    const input = renderInputInterface(route, {})
    if (input) parts.push(input)
  }
  return parts.join("\n\n") + "\n"
}

function methodDoc(route: IrRoute): string {
  const summary = annotationString(route.annotations.find((a) => a.name === "summary"))
  const description = annotationString(route.annotations.find((a) => a.name === "description"))
  const deprecated = route.annotations.some((a) => a.name === "deprecated")
  const doc: string[] = []
  if (summary) doc.push(summary)
  if (description && description !== summary) doc.push(description)
  if (deprecated) doc.push("@deprecated")
  if (doc.length === 0) return ""
  return `    /** ${doc.join(" ")} */\n`
}

function renderMethod(route: IrRoute): string {
  const name = handlerName(route)
  const hasInput = renderInputInterface(route, {}) !== null
  const output = routeOutputType(route, { prefix: "T." })
  const arg = hasInput ? `input: T.${inputTypeName(route)}` : ""
  const passInput = hasInput ? "input" : "undefined"
  return (
    `${methodDoc(route)}    async ${name}(${arg}): Promise<${output}> {\n` +
    `      return request<${output}>(${JSON.stringify(route.method)}, ${JSON.stringify(route.path)}, ${passInput}, ${JSON.stringify(name)})\n` +
    `    },`
  )
}

function renderClient(ir: Ir): string {
  const methods = ir.routes.map(renderMethod).join("\n\n")
  return `import type * as T from "./types"
import { routeValidators } from "./validators"

export interface RequestInput {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  body?: unknown
}

export interface RicadaRequest {
  url: string
  init: RequestInit
}

export interface ClientOptions {
  baseUrl: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  /** Validate responses against the contract at runtime (recommended in dev). */
  validate?: boolean
  onRequest?: (req: RicadaRequest) => RequestInit | void
}

export class RicadaApiError<E = unknown> extends Error {
  constructor(
    public status: number,
    public body: E,
    public response: Response,
  ) {
    super(\`Ricada request failed with status \${status}\`)
    this.name = "RicadaApiError"
  }
}

function serializeQuery(query: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) parts.push(\`\${encodeURIComponent(key)}=\${encodeURIComponent(String(item))}\`)
    } else {
      parts.push(\`\${encodeURIComponent(key)}=\${encodeURIComponent(String(value))}\`)
    }
  }
  return parts.join("&")
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? fetch

  async function request<TRes>(
    method: string,
    path: string,
    input: RequestInput | undefined,
    routeName: string,
  ): Promise<TRes> {
    let url = options.baseUrl.replace(/\\/$/, "") + path
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    let body: string | undefined

    if (input) {
      if (input.params) {
        for (const [key, value] of Object.entries(input.params)) {
          url = url.replace(\`:\${key}\`, encodeURIComponent(String(value)))
        }
      }
      if (input.query) {
        const qs = serializeQuery(input.query)
        if (qs) url += \`?\${qs}\`
      }
      if (input.headers) Object.assign(headers, input.headers)
      if (input.body !== undefined) {
        headers["content-type"] ??= "application/json"
        body = JSON.stringify(input.body)
      }
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined) init.body = body
    const finalInit = options.onRequest?.({ url, init }) ?? init

    const response = await doFetch(url, finalInit)
    const text = await response.text()
    const data = text ? JSON.parse(text) : undefined

    if (!response.ok) throw new RicadaApiError(response.status, data, response)
    if (options.validate) {
      const validate = routeValidators[routeName]
      if (validate && !validate(data)) {
        throw new Error(\`Ricada: response for "\${routeName}" does not match the contract\`)
      }
    }
    return data as TRes
  }

  return {
${methods}
  }
}
`
}

export function emitTsClient(ir: Ir): EmittedFile[] {
  return [
    { path: "ts-client/types.ts", contents: renderTypes(ir) },
    { path: "ts-client/validators.ts", contents: renderValidators(ir) },
    { path: "ts-client/client.ts", contents: renderClient(ir) },
    {
      path: "ts-client/index.ts",
      contents: 'export * from "./types"\nexport * from "./validators"\nexport * from "./client"\n',
    },
  ]
}
