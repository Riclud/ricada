import type { Ir, IrField, IrType, IrTypeRef, IrValue } from "@ricada/core"

export interface Registry {
  types: Map<string, IrType>
  errors: Map<string, IrField[]>
}

export const buildRegistry = (ir: Ir): Registry => {
  const types = new Map<string, IrType>()
  for (const type of ir.types) types.set(type.name, type)

  const errors = new Map<string, IrField[]>()
  for (const error of ir.errors) errors.set(error.name, error.fields)

  return { types, errors }
}

const annotationValue = (value: IrValue): unknown => {
  switch (value.kind) {
    case "string":
      return value.value
    case "number":
      return Number(value.value)
    case "word":
      if (value.value === "true") return true
      if (value.value === "false") return false
      if (value.value === "null") return null
      return value.value
    case "array":
      return value.items.map(annotationValue)
    default:
      return undefined
  }
}

const primitiveExample = (name: string): unknown => {
  switch (name) {
    case "int":
      return 0
    case "float":
      return 0
    case "bool":
      return true
    case "uuid":
      return "00000000-0000-0000-0000-000000000000"
    case "datetime":
      return "1970-01-01T00:00:00.000Z"
    default:
      return "string"
  }
}

export const exampleForRef = (reg: Registry, ref: IrTypeRef): unknown => {
  if (ref.array) return [exampleForRef(reg, { ...ref, array: false })]

  switch (ref.kind) {
    case "primitive":
      return primitiveExample(ref.name)
    case "literal":
      return ref.name
    case "null":
      return null
    case "named":
      return exampleForNamed(reg, ref.name)
  }
}

const exampleForNamed = (reg: Registry, name: string): unknown => {
  const error = reg.errors.get(name)
  if (error) return exampleForFields(reg, error)

  const type = reg.types.get(name)

  if (!type) return null

  if (type.kind === "object") return exampleForFields(reg, type.fields)

  if (type.kind === "enum") return type.members[0] ?? null

  return exampleForRef(reg, type.union[0]!)
}

export const exampleForFields = (reg: Registry, fields: IrField[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {}

  for (const field of fields) {
    const example = field.annotations.find((a) => a.name === "example")
    out[field.name] = example?.args[0] ? annotationValue(example.args[0].value) : exampleForRef(reg, field.type)
  }

  return out
}

const primitiveValid = (name: string, value: unknown): boolean => {
  switch (name) {
    case "string":
    case "uuid":
    case "datetime":
      return typeof value === "string"
    case "int":
      return typeof value === "number" && Number.isInteger(value)
    case "float":
      return typeof value === "number"
    case "bool":
      return typeof value === "boolean"
    default:
      return true
  }
}

export const validateRef = (reg: Registry, ref: IrTypeRef, value: unknown): boolean => {
  if (ref.array) return Array.isArray(value) && value.every((item) => validateRef(reg, { ...ref, array: false }, item))

  switch (ref.kind) {
    case "primitive":
      return primitiveValid(ref.name, value)
    case "literal":
      return value === ref.name
    case "null":
      return value === null
    case "named":
      return validateNamed(reg, ref.name, value)
  }
}

const validateNamed = (reg: Registry, name: string, value: unknown): boolean => {
  const error = reg.errors.get(name)
  if (error) return validateFields(reg, error, value)

  const type = reg.types.get(name)

  if (!type) return true

  if (type.kind === "object") return validateFields(reg, type.fields, value)

  if (type.kind === "enum") return typeof value === "string" && type.members.includes(value)

  return type.union.some((ref) => validateRef(reg, ref, value))
}

export const validateFields = (reg: Registry, fields: IrField[], value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false

  const obj = value as Record<string, unknown>

  for (const field of fields) {
    const present = field.name in obj

    if (!present) {
      if (!field.optional && field.default === null) return false
      continue
    }

    if (!validateRef(reg, field.type, obj[field.name])) return false
  }

  return true
}
