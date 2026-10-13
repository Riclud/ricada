import type { Ir, IrField, IrRoute, IrType, IrTypeRef } from "@ricada/core"
import type { RequestInput, ValidationIssue } from "./types.ts"
import { argAt, toJs, valueNumber } from "./values.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type TypeMap = Map<string, IrType>

export const buildTypeMap = (ir: Pick<Ir, "types">): TypeMap => new Map(ir.types.map((t) => [t.name, t]))

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const typeReason = (ref: IrTypeRef, value: unknown, types: TypeMap): string | null => {
  if (ref.array) {
    if (!Array.isArray(value)) return "expected an array"

    const inner: IrTypeRef = { ...ref, array: false }

    for (const item of value) {
      const reason = typeReason(inner, item, types)
      if (reason) return reason
    }

    return null
  }

  switch (ref.kind) {
    case "primitive":
      return primitiveReason(ref.name, value)
    case "literal":
      return value === ref.name ? null : `expected ${JSON.stringify(ref.name)}`
    case "null":
      return value === null ? null : "expected null"
    case "named":
      return namedReason(ref.name, value, types)
  }
}

const primitiveReason = (name: string, value: unknown): string | null => {
  switch (name) {
    case "string":
      return typeof value === "string" ? null : "expected string"
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : "expected integer"
    case "float":
      return typeof value === "number" ? null : "expected number"
    case "bool":
      return typeof value === "boolean" ? null : "expected boolean"
    case "uuid":
      return typeof value === "string" && UUID_RE.test(value) ? null : "expected uuid"
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : "expected datetime"
    default:
      return "expected string"
  }
}

interface ConstraintCheck {
  min: number | null
  max: number | null
  pattern: RegExp | null
  email: boolean
  uuid: boolean
}

const constraintsFor = (field: IrField): ConstraintCheck => {
  const check: ConstraintCheck = { min: null, max: null, pattern: null, email: false, uuid: false }

  for (const ann of field.annotations) {
    if (ann.name === "min") check.min = valueNumber(argAt(ann))
    if (ann.name === "max") check.max = valueNumber(argAt(ann))
    if (ann.name === "email") check.email = true
    if (ann.name === "uuid") check.uuid = true

    if (ann.name === "regex") {
      const arg = argAt(ann)
      if (arg?.kind === "string") check.pattern = new RegExp(arg.value)
    }
  }

  return check
}

const constraintReason = (field: IrField, value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null

  const { min, max, pattern, email, uuid } = constraintsFor(field)
  const isNumber = typeof value === "number"

  if (uuid && typeof value === "string" && !UUID_RE.test(value)) return "not a uuid"
  if (email && typeof value === "string" && !EMAIL_RE.test(value)) return "not an email"
  if (pattern && typeof value === "string" && !pattern.test(value)) return "violates the declared regex"

  if (min !== null) {
    if (isNumber && value < min) return `must be >= ${min}`
    if (!isNumber && value.length < min) return `must be at least ${min} chars`
  }

  if (max !== null) {
    if (isNumber && value > max) return `must be <= ${max}`
    if (!isNumber && value.length > max) return `must be at most ${max} chars`
  }

  return null
}

const fieldReason = (field: IrField, value: unknown, types: TypeMap): string | null => {
  const structural = typeReason(field.type, value, types)

  if (structural) return structural

  return constraintReason(field, value)
}

export const fieldsReason = (fields: IrField[], value: unknown, types: TypeMap): ValidationIssue[] => {
  if (!isObject(value)) return [{ field: "(root)", reason: "expected an object" }]

  const issues: ValidationIssue[] = []

  for (const field of fields) {
    const present = field.name in value

    if (!present) {
      if (!field.optional && field.default === null) {
        issues.push({ field: field.name, reason: "required field is missing" })
      }

      continue
    }

    const reason = fieldReason(field, value[field.name], types)

    if (reason) issues.push({ field: field.name, reason })
  }

  return issues
}

const literalMemberMatches = (memberName: string, tag: string, value: unknown, types: TypeMap): boolean => {
  const member = types.get(memberName)

  if (!member || member.kind !== "object") return false

  if (!isObject(value)) return false

  const tagField = member.fields.find((f) => f.name === tag && f.type.kind === "literal")

  return tagField !== undefined && value[tag] === tagField.type.name
}

const namedReason = (name: string, value: unknown, types: TypeMap): string | null => {
  const type = types.get(name)

  if (!type) return null

  if (type.kind === "object") return fieldsReason(type.fields, value, types).length === 0 ? null : "invalid object"

  if (type.kind === "enum")
    return typeof value === "string" && type.members.includes(value) ? null : "not an enum member"

  if (type.discriminated && type.tag) {
    const member = type.union.find((m) => m.kind === "named" && literalMemberMatches(m.name, type.tag!, value, types))

    if (member) return typeReason(member, value, types)
  }

  for (const member of type.union) {
    if (typeReason(member, value, types) === null) return null
  }

  return "no union member matches"
}

const blockSource = (block: { in: string }, input: RequestInput): unknown => {
  if (block.in === "body") return input.body

  if (block.in === "params") return input.params

  if (block.in === "query") return input.query

  return input.headers
}

export const validateRequestInput = (route: IrRoute, input: RequestInput, types: TypeMap): ValidationIssue[] => {
  const issues: ValidationIssue[] = []

  for (const block of route.params) {
    const source = blockSource(block, input)
    issues.push(...fieldsReason(block.fields, source, types))
  }

  return issues
}

export const applyBlockDefaults = (route: IrRoute, input: RequestInput): void => {
  for (const block of route.params) {
    const source = blockSource(block, input)

    if (!isObject(source)) continue

    for (const field of block.fields) {
      if (field.name in source || field.default === null) continue

      const def = toJs(field.default)
      if (def !== undefined) source[field.name] = def
    }
  }
}

export interface OutputMatch {
  status: number
  hasBody: boolean
  ok: boolean
  reason: string | null
}

export const matchOutput = (route: IrRoute, data: unknown, types: TypeMap): OutputMatch => {
  const successes = route.returns.filter((r) => r.status === null || (r.status >= 200 && r.status < 300))
  const withType = successes.find((r) => r.type !== null)
  const withoutType = successes.find((r) => r.type === null)
  const chosen = data === undefined ? (withoutType ?? withType) : (withType ?? withoutType)

  if (!chosen) return { status: 200, hasBody: false, ok: true, reason: null }

  const status = chosen.status ?? 200

  if (chosen.type === null) return { status, hasBody: false, ok: true, reason: null }

  if (data === undefined) return { status, hasBody: false, ok: true, reason: null }

  const reason = typeReason(chosen.type, data, types)
  return { status, hasBody: true, ok: reason === null, reason }
}
