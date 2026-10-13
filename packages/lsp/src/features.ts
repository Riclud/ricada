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

const KEYWORDS = [
  "import",
  "config",
  "type",
  "enum",
  "error",
  "returns",
  "errors",
  "handler",
  "body",
  "params",
  "query",
  "headers",
  "null",
]

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]

const PRIMITIVES = ["string", "int", "float", "bool", "uuid", "datetime"]

const ANNOTATIONS = [
  "@tag",
  "@summary",
  "@description",
  "@auth",
  "@rateLimit",
  "@cache",
  "@deprecated",
  "@min",
  "@max",
  "@email",
  "@regex",
  "@uuid",
  "@example",
  "@sensitive",
]

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

export const completions = (analysis: Analysis): CompletionItem[] => {
  const items: CompletionItem[] = []

  for (const m of METHODS) items.push({ label: m, kind: 2, detail: "HTTP method" })
  for (const kw of KEYWORDS) items.push({ label: kw, kind: 14, detail: "keyword" })
  for (const p of PRIMITIVES) items.push({ label: p, kind: 7, detail: "primitive type" })
  for (const a of ANNOTATIONS) items.push({ label: a, kind: 12, detail: "annotation" })

  if (analysis.ir) {
    for (const t of analysis.ir.types) {
      items.push({ label: t.name, kind: t.kind === "enum" ? 13 : 7, detail: t.kind })
    }
    for (const e of analysis.ir.errors) items.push({ label: e.name, kind: 7, detail: "error" })
  }

  return items
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
