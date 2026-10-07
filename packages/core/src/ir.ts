export interface Ir {
  version: 1
  config: IrConfig
  types: IrType[]
  errors: IrError[]
  routes: IrRoute[]
  extensions: Record<string, unknown>
}

export type IrValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "word"; value: string }
  | { kind: "array"; items: IrValue[] }
  | { kind: "object"; entries: Record<string, IrValue> }
  | { kind: "call"; name: string; args: IrValue[] }

export interface IrConfig {
  targets: string[]
  out: string | null
  wire: string | null
  raw: IrValue
}

export type TypeRefKind = "primitive" | "named" | "literal" | "null"

export interface IrTypeRef {
  name: string
  array: boolean
  literal: boolean
  kind: TypeRefKind
}

export interface IrArg {
  name: string | null
  value: IrValue
}

export interface IrAnnotation {
  name: string
  args: IrArg[]
}

export interface IrField {
  name: string
  optional: boolean
  type: IrTypeRef
  default: IrValue | null
  annotations: IrAnnotation[]
}

export interface IrObjectType {
  kind: "object"
  name: string
  fields: IrField[]
}

export interface IrEnumType {
  kind: "enum"
  name: string
  members: string[]
}

export interface IrAliasType {
  kind: "alias"
  name: string
  union: IrTypeRef[]
  discriminated: boolean
  tag: string | null
}

export type IrType = IrObjectType | IrEnumType | IrAliasType

export interface IrError {
  name: string
  fields: IrField[]
}

export interface IrParamBlock {
  in: string
  fields: IrField[]
}

export interface IrReturn {
  status: number | null
  type: IrTypeRef | null
}

export interface IrErrorRef {
  status: number
  type: string
}

export interface IrRoute {
  method: string
  path: string
  groupPrefix: string
  annotations: IrAnnotation[]
  params: IrParamBlock[]
  returns: IrReturn[]
  errors: IrErrorRef[]
  handler: string | null
}

export const PRIMITIVES = new Set(["string", "int", "float", "bool", "uuid", "datetime"])
