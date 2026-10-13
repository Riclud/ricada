import { compile, lex, parse, RicadaError } from "@ricada/core"
import type { Ast, Declaration, IrType, IrTypeRef } from "@ricada/core"
import type { CompletionItem, Diagnostic, Location, Position, Range } from "./protocol.ts"

export interface DeclarationSite {
  line: number
  col: number
  length: number
}

export interface Analysis {
  ir: ReturnType<typeof compile> | null
  declarations: Map<string, DeclarationSite>
  diagnostics: Diagnostic[]
}

const TOP_KEYWORDS = ["import", "config", "type", "enum", "error"]
const ROUTE_KEYWORDS = ["body", "params", "query", "headers", "returns", "errors", "handler"]
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
const PRIMITIVES = ["string", "int", "float", "bool", "uuid", "datetime"]
const CONFIG_KEYS = ["targets", "out", "wire", "auth", "cors", "security", "rateLimit", "control"]
const CORS_KEYS = ["origins", "methods", "headers", "credentials", "maxAge"]
const SECURITY_KEYS = ["headers"]
const SECURITY_HEADER_KEYS = ["hsts", "xContentTypeOptions", "xFrameOptions", "referrerPolicy", "contentSecurityPolicy"]
const RATE_LIMIT_KEYS = ["algorithm", "store", "default"]
const CONTROL_KEYS = ["secret", "allow"]
const RATE_LIMIT_KEY_VALUES = ["ip", "jwt.sub", "route", "param:", "header("]

const STRING_ANNOTATIONS = [
  "@min",
  "@max",
  "@email",
  "@regex",
  "@uuid",
  "@example",
  "@description",
  "@sensitive",
  "@toUpperCase",
  "@toLowerCase",
]

const NUMBER_ANNOTATIONS = ["@min", "@max", "@example", "@description"]

const GENERIC_ANNOTATIONS = ["@example", "@description", "@sensitive"]

const ROUTE_ANNOTATIONS = ["@tag", "@summary", "@description", "@auth", "@rateLimit", "@cache", "@deprecated"]

const ANNOTATION_ARGS: Record<string, string[]> = {
  auth: ["public", "scopes", "roles"],
  rateLimit: ["limit", "window", "key", "burst"],
  cache: ["ttl", "key"],
  deprecated: ["reason"],
}

const STRING_TYPES = new Set(["string", "uuid", "datetime"])
const NUMBER_TYPES = new Set(["int", "float"])

const KIND = { method: 2, type: 7, enum: 13, keyword: 14, property: 10, value: 12 }

const toDiagnostic = (err: RicadaError): Diagnostic => {
  const start: Position = { line: Math.max(0, err.loc.line - 1), character: Math.max(0, err.loc.col - 1) }
  const end: Position = { line: start.line, character: start.character + Math.max(1, err.length) }

  return {
    range: { start, end },
    severity: 1,
    source: "ricada",
    message: err.hint ? `${err.message} (${err.hint})` : err.message,
  }
}

const collectDeclarations = (ast: Ast, lines: string[]): Map<string, DeclarationSite> => {
  const sites = new Map<string, DeclarationSite>()

  for (const decl of ast.declarations as Declaration[]) {
    if (!("name" in decl)) continue

    const line = decl.loc.line - 1
    const col = (lines[line] ?? "").indexOf(decl.name)
    sites.set(decl.name, { line, col: col >= 0 ? col : decl.loc.col - 1, length: decl.name.length })
  }

  return sites
}

export const analyze = (source: string, baseDir?: string): Analysis => {
  const diagnostics: Diagnostic[] = []
  let ast: Ast | null = null

  try {
    ast = parse(lex(source))
  } catch (err) {
    if (err instanceof RicadaError) diagnostics.push(toDiagnostic(err))
    return { ir: null, declarations: new Map(), diagnostics }
  }

  let ir: ReturnType<typeof compile> | null = null

  try {
    ir = compile(source, baseDir ? { baseDir } : undefined)
  } catch (err) {
    if (err instanceof RicadaError) diagnostics.push(toDiagnostic(err))
  }

  return { ir, declarations: collectDeclarations(ast, source.split("\n")), diagnostics }
}

const WORD_RE = /[A-Za-z0-9_@.-]/

export const wordAt = (source: string, position: Position): string => {
  const line = source.split("\n")[position.line] ?? ""

  if (position.character > line.length) return ""

  let start = position.character
  let end = position.character

  while (start > 0 && WORD_RE.test(line[start - 1]!)) start--
  while (end < line.length && WORD_RE.test(line[end]!)) end++

  return line.slice(start, end)
}

const offsetAt = (source: string, position: Position): number => {
  const lines = source.split("\n")
  let offset = 0

  for (let i = 0; i < position.line && i < lines.length; i++) offset += lines[i]!.length + 1

  return offset + Math.min(position.character, lines[position.line]?.length ?? 0)
}

const maskLiterals = (source: string): string => {
  const chars = source.split("")
  let i = 0

  while (i < chars.length) {
    const c = chars[i]!

    if (c === "/" && chars[i + 1] === "/") {
      while (i < chars.length && chars[i] !== "\n") chars[i++] = " "
      continue
    }

    if (c === "#") {
      while (i < chars.length && chars[i] !== "\n") chars[i++] = " "
      continue
    }

    if (c === '"' || c === "'") {
      const quote = c
      chars[i++] = " "

      while (i < chars.length && chars[i] !== quote) {
        if (chars[i] === "\\") chars[i++] = " "
        if (i < chars.length) chars[i++] = " "
      }

      if (i < chars.length) chars[i++] = " "
      continue
    }

    i++
  }

  return chars.join("")
}

const wordBack = (text: string, index: number): string => {
  let i = index - 1
  while (i >= 0 && WORD_RE.test(text[i]!)) i--
  return text.slice(i + 1, index)
}

const contextArgName = (text: string, start: number, end: number): string | null => {
  let depth = 0
  let colon = -1

  for (let i = start; i < end; i++) {
    const ch = text[i]!

    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") depth--
    else if (ch === ":" && depth === 0) colon = i
  }

  if (colon === -1) return null
  return wordBack(text, colon) || null
}

const declaredTypeAt = (source: string, position: Position): string | null => {
  const lines = source.split("\n")
  const candidates: string[] = [(lines[position.line] ?? "").slice(0, position.character)]

  for (let i = position.line - 1; i >= 0 && candidates.length < 6; i--) {
    const line = lines[i] ?? ""
    candidates.push(line)
    if (line.includes("{") || line.includes("}")) break
  }

  for (const line of candidates) {
    const match = /:\s*([A-Za-z_][\w.]*)/.exec(line)
    if (match) return match[1] ?? null
  }

  return null
}

type CompletionContext =
  | { kind: "top" }
  | { kind: "group" }
  | { kind: "routeBody" }
  | { kind: "fields" }
  | { kind: "errors" }
  | { kind: "typeRef" }
  | { kind: "value" }
  | { kind: "config" }
  | { kind: "configKeys"; keys: string[] }
  | { kind: "annotations"; scope: "field" | "route"; fieldType: string | null }
  | { kind: "annotationArgs"; name: string; arg: string | null }

interface CursorContext {
  context: CompletionContext
  partial: string
}

const isRouteHeader = (header: string): boolean => METHODS.some((m) => header === m || header.startsWith(`${m} `))

const blockContext = (header: string): CompletionContext => {
  if (isRouteHeader(header)) return { kind: "routeBody" }
  if (/^(body|params|query|headers)$/.test(header)) return { kind: "fields" }
  if (header === "errors") return { kind: "errors" }
  if (/^(type|error|enum)\b/.test(header)) return { kind: "fields" }
  if (header === "config") return { kind: "config" }
  if (header === "auth") {
    return { kind: "configKeys", keys: ["type", "issuer", "audience", "secret", "algorithm", "in", "name", "key"] }
  }
  if (header === "cors") return { kind: "configKeys", keys: CORS_KEYS }
  if (header === "security") return { kind: "configKeys", keys: SECURITY_KEYS }
  if (header === "headers") return { kind: "configKeys", keys: SECURITY_HEADER_KEYS }
  if (header === "rateLimit") return { kind: "configKeys", keys: RATE_LIMIT_KEYS }
  if (header === "default") return { kind: "configKeys", keys: ["limit", "window", "key", "burst"] }
  if (header === "control") return { kind: "configKeys", keys: CONTROL_KEYS }
  if (header.startsWith("/")) return { kind: "group" }
  return { kind: "top" }
}

const isRouteScope = (context: CompletionContext): boolean => context.kind === "routeBody" || context.kind === "group"

const TYPE_TOKEN_RE = /^\s*("[^"]*"|[\w.]+)(\[\])?(\?)?/

const refineFieldLine = (context: CompletionContext, linePrefix: string): CompletionContext => {
  if (linePrefix.indexOf(":") === -1) return context

  if (/\|\s*[\w."']*$/.test(linePrefix)) return { kind: "typeRef" }

  const rest = linePrefix.slice(linePrefix.indexOf(":") + 1)

  if (rest.includes("=")) return { kind: "value" }

  const match = TYPE_TOKEN_RE.exec(rest)
  const after = match ? rest.slice(match[0].length) : ""

  if (!match || after === "") return { kind: "typeRef" }

  if (context.kind === "fields") {
    return { kind: "annotations", scope: "field", fieldType: match[1]!.replace(/"/g, "") }
  }

  return context
}

export const contextAt = (source: string, position: Position): CursorContext => {
  const offset = offsetAt(source, position)
  const masked = maskLiterals(source)
  const text = masked.slice(0, offset)
  const partial = wordBack(masked, offset)

  const stack: Array<{ sym: "(" | "{"; index: number }> = []

  for (let i = 0; i < offset; i++) {
    const ch = text[i]!

    if (ch === "(" || ch === "{") stack.push({ sym: ch, index: i })
    else if (ch === ")" && stack[stack.length - 1]?.sym === "(") stack.pop()
    else if (ch === "}" && stack[stack.length - 1]?.sym === "{") stack.pop()
  }

  const top = stack[stack.length - 1]

  if (top?.sym === "(") {
    const name = wordBack(masked, top.index)

    if (name.startsWith("@")) {
      const arg = contextArgName(text, top.index + 1, offset)
      return { context: { kind: "annotationArgs", name: name.slice(1), arg }, partial }
    }

    return { context: { kind: "top" }, partial }
  }

  const enclosing = top
    ? blockContext(source.slice(masked.lastIndexOf("\n", top.index - 1) + 1, top.index).trim())
    : { kind: "top" as const }

  if (partial.startsWith("@")) {
    const scope = isRouteScope(enclosing) ? "route" : "field"
    const fieldType = scope === "field" ? declaredTypeAt(source, position) : null
    return { context: { kind: "annotations", scope, fieldType }, partial }
  }

  if (!top) return { context: { kind: "top" }, partial }

  let context = enclosing

  if (context.kind === "fields" || context.kind === "routeBody" || context.kind === "errors") {
    const lineStart = masked.lastIndexOf("\n", offset - 1) + 1
    context = refineFieldLine(context, source.slice(lineStart, offset))
  }

  return { context, partial }
}

const item = (label: string, kind: number, detail?: string): CompletionItem => ({ label, kind, detail })

const keywordItems = (labels: string[]): CompletionItem[] => labels.map((l) => item(l, KIND.keyword, "keyword"))

const typeItems = (analysis: Analysis): CompletionItem[] => {
  const items = PRIMITIVES.map((p) => item(p, KIND.type, "primitive type"))

  if (analysis.ir) {
    for (const t of analysis.ir.types) items.push(item(t.name, t.kind === "enum" ? KIND.enum : KIND.type, t.kind))
    for (const e of analysis.ir.errors) items.push(item(e.name, KIND.type, "error"))
  }

  items.push(item("null", KIND.type, "literal"))
  return items
}

const schemeItems = (analysis: Analysis): CompletionItem[] => {
  const items: CompletionItem[] = []
  const auth = analysis.ir?.config.auth

  if (auth) for (const name of Object.keys(auth)) items.push(item(name, KIND.value, "auth scheme"))

  items.push(item("public", KIND.value, "no auth"))
  return items
}

const fieldAnnotations = (analysis: Analysis, fieldType: string | null): CompletionItem[] => {
  let names = GENERIC_ANNOTATIONS

  if (fieldType && STRING_TYPES.has(fieldType)) names = STRING_ANNOTATIONS
  else if (fieldType && NUMBER_TYPES.has(fieldType)) names = NUMBER_ANNOTATIONS

  return names.map((n) => item(n, KIND.property, "annotation"))
}

const annotationItems = (names: string[]): CompletionItem[] => names.map((n) => item(n, KIND.property, "annotation"))

const annotationArgItems = (analysis: Analysis, name: string, arg: string | null): CompletionItem[] => {
  if (name === "auth") {
    if (arg === "scopes" || arg === "roles") return []
    return [...schemeItems(analysis), ...(ANNOTATION_ARGS[name] ?? []).map((a) => item(a, KIND.property, "argument"))]
  }

  if (name === "rateLimit" && arg === "key") {
    return RATE_LIMIT_KEY_VALUES.map((v) => item(v, KIND.value, "rate-limit key"))
  }

  return (ANNOTATION_ARGS[name] ?? []).map((a) => item(a, KIND.property, "argument"))
}

const contextItems = (analysis: Analysis, context: CompletionContext): CompletionItem[] => {
  switch (context.kind) {
    case "top":
      return keywordItems(TOP_KEYWORDS)
    case "group":
      return [...METHODS.map((m) => item(m, KIND.method, "HTTP method")), ...annotationItems(ROUTE_ANNOTATIONS)]
    case "routeBody":
      return [...keywordItems(ROUTE_KEYWORDS), ...annotationItems(ROUTE_ANNOTATIONS)]
    case "errors":
      return analysis.ir ? analysis.ir.errors.map((e) => item(e.name, KIND.type, "error")) : []
    case "typeRef":
      return typeItems(analysis)
    case "value":
      return []
    case "config":
      return keywordItems(CONFIG_KEYS)
    case "configKeys":
      return context.keys.map((k) => item(k, KIND.property, "config key"))
    case "annotations":
      return context.scope === "route"
        ? annotationItems(ROUTE_ANNOTATIONS)
        : fieldAnnotations(analysis, context.fieldType)
    case "annotationArgs":
      return annotationArgItems(analysis, context.name, context.arg)
    case "fields":
      return []
  }
}

const applyPrefix = (items: CompletionItem[], partial: string): CompletionItem[] => {
  if (!partial) return items

  const needle = partial.toLowerCase()
  return items.filter((i) => i.label.toLowerCase().startsWith(needle))
}

export const completions = (analysis: Analysis, source: string, position: Position): CompletionItem[] => {
  const { context, partial } = contextAt(source, position)
  return applyPrefix(contextItems(analysis, context), partial)
}

const typeRefText = (ref: IrTypeRef): string => `${ref.name}${ref.array ? "[]" : ""}`

const describeType = (type: IrType): string => {
  if (type.kind === "enum") return `enum **${type.name}**\n\n${type.members.map((m) => `- \`${m}\``).join("\n")}`

  if (type.kind === "alias") {
    return `type **${type.name}** = ${type.union.map(typeRefText).join(" | ")}`
  }

  const fields = type.fields.map((f) => {
    const optional = f.optional ? "?" : ""
    const def = f.default ? " (default)" : ""
    return `- \`${f.name}${optional}: ${typeRefText(f.type)}\`${def}`
  })

  return `type **${type.name}**\n\n${fields.join("\n")}`
}

export const hover = (analysis: Analysis, source: string, position: Position): string | null => {
  const word = wordAt(source, position)

  if (!word || !analysis.ir) return null

  const type = analysis.ir.types.find((t) => t.name === word)
  if (type) return describeType(type)

  const err = analysis.ir.errors.find((e) => e.name === word)
  if (err) {
    const fields = err.fields.map((f) => `- \`${f.name}: ${typeRefText(f.type)}\``)
    return `error **${err.name}**\n\n${fields.join("\n")}`
  }

  return null
}

export const definition = (analysis: Analysis, uri: string, source: string, position: Position): Location | null => {
  const word = wordAt(source, position)
  const site = word ? analysis.declarations.get(word) : undefined

  if (!site) return null

  const range: Range = {
    start: { line: site.line, character: site.col },
    end: { line: site.line, character: site.col + site.length },
  }

  return { uri, range }
}
