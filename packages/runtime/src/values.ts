import type { IrAnnotation, IrValue } from "@ricada/core"

export const findAnnotation = (anns: IrAnnotation[], name: string): IrAnnotation | undefined => {
  return anns.find((a) => a.name === name)
}

export const argAt = (ann: IrAnnotation | undefined, index = 0): IrValue | undefined => ann?.args[index]?.value

export const namedArg = (ann: IrAnnotation | undefined, name: string): IrValue | undefined => {
  return ann?.args.find((a) => a.name === name)?.value
}

export const valueText = (v: IrValue | undefined): string | null => {
  if (!v) return null

  if (v.kind === "string" || v.kind === "word" || v.kind === "number") return v.value

  return null
}

export const valueNumber = (v: IrValue | undefined): number | null => {
  if (v && v.kind === "number") return Number(v.value)

  return null
}

export const valueTexts = (v: IrValue | undefined): string[] => {
  if (!v) return []

  if (v.kind === "array") {
    const out: string[] = []

    for (const item of v.items) {
      const t = valueText(item)
      if (t !== null) out.push(t)
    }

    return out
  }

  const t = valueText(v)
  return t !== null ? [t] : []
}

export const resolveSecret = (
  v: IrValue | undefined,
  env: (name: string) => string | undefined,
): string | undefined => {
  if (!v) return undefined

  if (v.kind === "string" || v.kind === "word") return v.value

  if (v.kind === "call" && v.name === "env") {
    const name = v.args[0]

    if (name && name.kind === "string") return env(name.value) ?? undefined
  }

  return undefined
}

export const toJs = (v: IrValue | undefined): unknown => {
  if (!v) return undefined

  switch (v.kind) {
    case "string":
    case "word":
    case "number":
      return v.value
    case "array":
      return v.items.map(toJs)
    case "object": {
      const out: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(v.entries)) out[key] = toJs(value)

      return out
    }
    case "call":
      return undefined
  }
}
