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

// ---------------------------------------------------------------------------
// Runtime validators (used by the client dev-mode and dynamic conformance)
// ---------------------------------------------------------------------------

const PRIMITIVE_PREDICATE: Record<string, string> = {
  string: "isStr",
  int: "isInt",
  float: "isNum",
  bool: "isBool",
  uuid: "isStr",
  datetime: "isStr",
}

function keyAccessor(name: string, base = "v"): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`
}

export function checkRef(ref: IrTypeRef, accessor: string): string {
  if (ref.array) {
    const inner: IrTypeRef = { ...ref, array: false }
    return `(Array.isArray(${accessor}) && (${accessor} as unknown[]).every((e) => ${checkRef(inner, "e")}))`
  }
  switch (ref.kind) {
    case "primitive":
      return `${PRIMITIVE_PREDICATE[ref.name] ?? "isStr"}(${accessor})`
    case "literal":
      return `${accessor} === ${JSON.stringify(ref.name)}`
    case "null":
      return `${accessor} === null`
    case "named":
      return `validators.${ref.name}(${accessor})`
  }
}

export function validatorForRef(ref: IrTypeRef): string {
  return `(v: unknown) => ${checkRef(ref, "v")}`
}

function validatorForFields(fields: IrField[]): string {
  const checks = fields.map((f) => {
    const accessor = keyAccessor(f.name)
    const check = checkRef(f.type, accessor)
    return f.optional || f.default ? `(${accessor} === undefined || ${check})` : check
  })
  return checks.length > 0 ? `(v: unknown) => isObj(v) && ${checks.join(" && ")}` : "(v: unknown) => isObj(v)"
}

function validatorForType(type: IrType): string {
  if (type.kind === "object") return validatorForFields(type.fields)
  if (type.kind === "enum") {
    return `(v: unknown) => ${type.members.map((m) => `v === ${JSON.stringify(m)}`).join(" || ")}`
  }
  return `(v: unknown) => ${type.union.map((r) => checkRef(r, "v")).join(" || ")}`
}

export function renderValidators(ir: { types: IrType[]; errors: IrError[]; routes: IrRoute[] }): string {
  const header = [
    "// Generated by Ricada. Do not edit.",
    'const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)',
    'const isStr = (v: unknown): v is string => typeof v === "string"',
    'const isNum = (v: unknown): v is number => typeof v === "number"',
    'const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)',
    'const isBool = (v: unknown): v is boolean => typeof v === "boolean"',
    "",
  ]

  const typeValidators = ["export const validators: Record<string, (v: unknown) => boolean> = {"]
  for (const type of ir.types) typeValidators.push(`  ${type.name}: ${validatorForType(type)},`)
  for (const error of ir.errors) typeValidators.push(`  ${error.name}: ${validatorForFields(error.fields)},`)
  typeValidators.push("}", "")

  const routeValidators = ["export const routeValidators: Record<string, ((v: unknown) => boolean) | null> = {"]
  for (const route of ir.routes) {
    const refs = route.returns
      .filter((r) => (r.status === null || (r.status >= 200 && r.status < 300)) && r.type)
      .map((r) => r.type!)
    let expr: string
    if (refs.length === 0) expr = "null"
    else if (refs.length === 1) expr = validatorForRef(refs[0]!)
    else expr = `(v: unknown) => ${refs.map((r) => checkRef(r, "v")).join(" || ")}`
    routeValidators.push(`  ${JSON.stringify(handlerName(route))}: ${expr},`)
  }
  routeValidators.push("}", "")

  return [...header, ...typeValidators, ...routeValidators].join("\n")
}
