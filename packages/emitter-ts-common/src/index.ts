import type { IrAnnotation, IrError, IrField, IrRoute, IrType, IrTypeRef } from "@ricada/core"

export interface RenderOptions {
  /** Prefix for named type references, e.g. "T." when importing `* as T`. */
  prefix?: string
}

const PRIMITIVE_TS: Record<string, string> = {
  string: "string",
  int: "number",
  float: "number",
  bool: "boolean",
  uuid: "string",
  datetime: "string",
}

export function annotationString(ann: IrAnnotation | undefined, index = 0): string | null {
  const arg = ann?.args[index]
  if (!arg) return null
  const v = arg.value
  if (v.kind === "string" || v.kind === "word" || v.kind === "number") return v.value
  return null
}

export function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function renderTypeRef(ref: IrTypeRef, opts: RenderOptions = {}): string {
  let base: string
  switch (ref.kind) {
    case "primitive":
      base = PRIMITIVE_TS[ref.name] ?? "unknown"
      break
    case "literal":
      base = JSON.stringify(ref.name)
      break
    case "null":
      base = "null"
      break
    case "named":
      base = `${opts.prefix ?? ""}${ref.name}`
      break
  }
  return ref.array ? (base.includes(" | ") ? `(${base})[]` : `${base}[]`) : base
}

export function renderField(field: IrField, opts: RenderOptions = {}, withDoc = true): string {
  const optional = field.optional ? "?" : ""
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.name) ? field.name : JSON.stringify(field.name)
  const line = `${key}${optional}: ${renderTypeRef(field.type, opts)}`
  if (!withDoc) return line
  const description = annotationString(field.annotations.find((a) => a.name === "description"))
  const deprecated = field.annotations.some((a) => a.name === "deprecated")
  const doc: string[] = []
  if (description) doc.push(description)
  if (deprecated) doc.push("@deprecated")
  return doc.length > 0 ? `/** ${doc.join(" ")} */\n${line}` : line
}

function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces)
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n")
}

export function renderTypeDecl(type: IrType): string {
  if (type.kind === "object") {
    const body = type.fields.map((f) => indentLines(renderField(f), 2)).join("\n")
    return `export interface ${type.name} {\n${body}\n}`
  }
  if (type.kind === "enum") {
    const values = type.members.map((m) => `  ${m}: ${JSON.stringify(m)},`).join("\n")
    return `export const ${type.name} = {\n${values}\n} as const;\nexport type ${type.name} = (typeof ${type.name})[keyof typeof ${type.name}];`
  }
  const union = type.union.map((r) => renderTypeRef(r)).join(" | ")
  return `export type ${type.name} = ${union};`
}

export function renderErrorDecl(error: IrError): string {
  const body = error.fields.map((f) => indentLines(renderField(f), 2)).join("\n")
  return `export interface ${error.name} {\n${body}\n}`
}

export function handlerName(route: IrRoute): string {
  if (route.handler) return route.handler
  const segments = route.path
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith(":") ? `By${pascal(seg.slice(1))}` : pascal(seg)))
  return route.method.toLowerCase() + segments.join("")
}

export function inputTypeName(route: IrRoute): string {
  return `${pascal(handlerName(route))}Input`
}

export function renderInputInterface(route: IrRoute, opts: RenderOptions = {}): string | null {
  const groups = route.params.filter((p) => p.in !== "headers" || p.fields.length > 0)
  if (groups.length === 0) return null
  const body = groups
    .map((group) => {
      if (group.fields.length === 0) return `  ${group.in}: {}`
      const fields = group.fields
        .map((f) => indentLines(renderField(f.default ? { ...f, optional: true } : f, opts, false), 4))
        .join("\n")
      return `  ${group.in}: {\n${fields}\n  }`
    })
    .join("\n")
  return `export interface ${inputTypeName(route)} {\n${body}\n}`
}

export function routeOutputType(route: IrRoute, opts: RenderOptions = {}): string {
  const success = route.returns
    .filter((r) => (r.status === null || (r.status >= 200 && r.status < 300)) && r.type)
    .map((r) => renderTypeRef(r.type!, opts))
  const unique = [...new Set(success)]
  return unique.length > 0 ? unique.join(" | ") : "void"
}

export function collectTypeNames(ir: { types: IrType[]; errors: IrError[] }): string[] {
  return [...ir.types.map((t) => t.name), ...ir.errors.map((e) => e.name)]
}
