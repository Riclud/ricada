import { ResolveError } from "./errors.ts"
import { parse } from "./parse.ts"
import { lex } from "./lexer.ts"
import { PRIMITIVES } from "./ir.ts"
import type {
  AliasNode,
  Annotation,
  Ast,
  ConfigEntry,
  EnumNode,
  ErrorNode,
  FieldNode,
  GroupNode,
  ObjectTypeNode,
  RouteNode,
  TypeRef,
  Value,
} from "./ast.ts"
import type {
  Ir,
  IrAliasType,
  IrAnnotation,
  IrConfig,
  IrEnumType,
  IrError,
  IrErrorRef,
  IrField,
  IrObjectType,
  IrParamBlock,
  IrReturn,
  IrRoute,
  IrType,
  IrTypeRef,
  IrValue,
  TypeRefKind,
} from "./ir.ts"
import type { Location } from "./tokens.ts"

export function resolve(ast: Ast): Ir {
  const objectTypes = new Map<string, ObjectTypeNode>()
  const enumTypes = new Map<string, EnumNode>()
  const aliasTypes = new Map<string, AliasNode>()
  const errorDecls = new Map<string, ErrorNode>()

  const register = (name: string, loc: Location): void => {
    if (objectTypes.has(name) || enumTypes.has(name) || aliasTypes.has(name) || errorDecls.has(name)) {
      throw new ResolveError(`duplicate type name \`${name}\``, loc, name.length)
    }
  }

  let configEntries: ConfigEntry[] = []

  for (const decl of ast.declarations) {
    if (decl.kind === "config") {
      configEntries = decl.entries
    } else if (decl.kind === "object") {
      register(decl.name, decl.loc)
      objectTypes.set(decl.name, decl)
    } else if (decl.kind === "enum") {
      register(decl.name, decl.loc)
      enumTypes.set(decl.name, decl)
    } else if (decl.kind === "alias") {
      register(decl.name, decl.loc)
      aliasTypes.set(decl.name, decl)
    } else if (decl.kind === "error") {
      register(decl.name, decl.loc)
      errorDecls.set(decl.name, decl)
    }
  }

  const isNamed = (name: string): boolean =>
    objectTypes.has(name) || enumTypes.has(name) || aliasTypes.has(name) || errorDecls.has(name)

  function resolveTypeRef(ref: TypeRef): IrTypeRef {
    let kind: TypeRefKind
    if (ref.literal) {
      kind = "literal"
    } else if (ref.name === "null") {
      kind = "null"
    } else if (PRIMITIVES.has(ref.name)) {
      kind = "primitive"
    } else if (isNamed(ref.name)) {
      kind = "named"
    } else {
      throw new ResolveError(
        `unknown type \`${ref.name}\``,
        ref.loc,
        ref.name.length,
        "declare it with `type` / `enum` / `error`, or use a primitive",
      )
    }
    return { name: ref.name, array: ref.array, literal: ref.literal, kind }
  }

  function toIrValue(v: Value): IrValue {
    switch (v.kind) {
      case "string":
        return { kind: "string", value: v.value }
      case "number":
        return { kind: "number", value: v.value }
      case "word":
        return { kind: "word", value: v.value }
      case "array":
        return { kind: "array", items: v.items.map(toIrValue) }
      case "object": {
        const entries: Record<string, IrValue> = {}
        for (const e of v.entries) entries[e.key] = toIrValue(e.value)
        return { kind: "object", entries }
      }
      case "call":
        return { kind: "call", name: v.name, args: v.args.map(toIrValue) }
    }
  }

  function resolveAnnotation(a: Annotation): IrAnnotation {
    return { name: a.name, args: a.args.map((arg) => ({ name: arg.name, value: toIrValue(arg.value) })) }
  }

  function resolveField(f: FieldNode): IrField {
    return {
      name: f.name,
      optional: f.optional,
      type: resolveTypeRef(f.type),
      default: f.default ? toIrValue(f.default) : null,
      annotations: f.annotations.map(resolveAnnotation),
    }
  }

  // ---- types ----

  const types: IrType[] = []

  function detectDiscriminant(objects: IrObjectType[]): { discriminated: boolean; tag: string | null } {
    const literalMaps = objects.map((o) => {
      const m = new Map<string, string>()
      for (const f of o.fields) if (f.type.kind === "literal") m.set(f.name, f.type.name)
      return m
    })
    let candidates: string[] | null = null
    for (const m of literalMaps) {
      const keys = [...m.keys()]
      candidates = candidates === null ? keys : candidates.filter((k) => m.has(k))
    }
    if (!candidates || candidates.length === 0) return { discriminated: false, tag: null }
    for (const cand of candidates) {
      const values = new Set(literalMaps.map((m) => m.get(cand)))
      if (values.size === literalMaps.length && !values.has(undefined)) {
        return { discriminated: true, tag: cand }
      }
    }
    return { discriminated: false, tag: null }
  }

  for (const decl of ast.declarations) {
    if (decl.kind === "object") {
      const t: IrObjectType = { kind: "object", name: decl.name, fields: decl.fields.map(resolveField) }
      types.push(t)
    } else if (decl.kind === "enum") {
      const t: IrEnumType = { kind: "enum", name: decl.name, members: decl.members }
      types.push(t)
    } else if (decl.kind === "alias") {
      const union = decl.union.map(resolveTypeRef)
      const objectMembers = union
        .filter((r) => r.kind === "named" && objectTypes.has(r.name))
        .map((r) => {
          const fields = objectTypes.get(r.name)!.fields.map(resolveField)
          return { kind: "object", name: r.name, fields } as IrObjectType
        })
      const { discriminated, tag } =
        union.length > 0 && objectMembers.length === union.length
          ? detectDiscriminant(objectMembers)
          : { discriminated: false, tag: null }
      const t: IrAliasType = { kind: "alias", name: decl.name, union, discriminated, tag }
      types.push(t)
    }
  }

  const errors: IrError[] = ast.declarations
    .filter((d): d is ErrorNode => d.kind === "error")
    .map((d) => ({ name: d.name, fields: d.fields.map(resolveField) }))

  // ---- config ----

  function configValue(entries: ConfigEntry[]): IrValue {
    const obj: Record<string, IrValue> = {}
    for (const e of entries) obj[e.key] = toIrValue(e.value)
    return { kind: "object", entries: obj }
  }

  const rawConfig = configValue(configEntries)
  const configObj = rawConfig.kind === "object" ? rawConfig.entries : {}
  const targetsValue = configObj["targets"]
  const config: IrConfig = {
    targets:
      targetsValue && targetsValue.kind === "array"
        ? targetsValue.items.filter((i) => i.kind === "word").map((i) => (i as { value: string }).value)
        : [],
    out: configObj["out"]?.kind === "string" ? (configObj["out"] as { value: string }).value : null,
    wire:
      configObj["wire"]?.kind === "word" || configObj["wire"]?.kind === "string"
        ? (configObj["wire"] as { value: string }).value
        : null,
    raw: rawConfig,
  }

  // ---- routes ----

  const routes: IrRoute[] = []

  const joinPath = (prefix: string, path: string): string => {
    if (!prefix) return path
    if (!path) return prefix
    return path.startsWith("/") ? prefix + path : `${prefix}/${path}`
  }

  function resolveRoute(route: RouteNode, prefix: string): IrRoute {
    const params: IrParamBlock[] = route.params.map((block) => ({
      in: block.in,
      fields: block.fields.map(resolveField),
    }))
    const returns: IrReturn[] = route.returns.map((r) => ({
      status: r.status,
      type: r.type ? resolveTypeRef(r.type) : null,
    }))
    const errRefs: IrErrorRef[] = route.errors.map((e) => {
      if (!errorDecls.has(e.type)) {
        throw new ResolveError(`unknown error type \`${e.type}\``, e.loc, e.type.length, "declare it with `error`")
      }
      return { status: e.status, type: e.type }
    })
    return {
      method: route.method,
      path: joinPath(prefix, route.path),
      groupPrefix: prefix,
      annotations: route.annotations.map(resolveAnnotation),
      params,
      returns,
      errors: errRefs,
      handler: route.handler,
    }
  }

  function walk(group: GroupNode, prefix: string): void {
    const full = joinPath(prefix, group.path)
    for (const item of group.items) {
      if (item.kind === "group") walk(item, full)
      else routes.push(resolveRoute(item, full))
    }
  }

  for (const decl of ast.declarations) {
    if (decl.kind === "group") walk(decl, "")
  }

  return { version: 1, config, types, errors, routes, extensions: {} }
}

export function compile(source: string): Ir {
  return resolve(parse(lex(source)))
}
