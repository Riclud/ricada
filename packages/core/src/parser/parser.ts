import { ParseError } from "./errors.ts"
import { HTTP_METHODS, PARAM_KINDS } from "./types.ts"
import type { Token, DecoratorNode, ObjectFieldNode, ParamNode, RouteNode, TypeNode, AstNode } from "./types.ts"

export function parse(tokens: Token[], sourceLines: string[]): AstNode {
  let pos = 0

  function peek(): Token {
    return tokens[pos]!
  }

  function consume(expected?: Token["type"]): Token {
    const t = peek()
    if (expected !== undefined && t.type !== expected) {
      throw new ParseError("error", `ожидался ${expected}, получен ${t.type}`, t.loc.line, t.loc.col)
    }
    pos++
    return t
  }

  function skip(type: Token["type"]): void {
    while (peek().type === type) consume()
  }

  function parseRouteDecorators(): DecoratorNode[] {
    const decorators: DecoratorNode[] = []
    while (peek().type === "DECORATOR") {
      const d = consume().value as { name: string; arg: string | null }
      decorators.push(d)
    }
    return decorators
  }

  function parseRouteDecl(): RouteNode {
    const decorators = parseRouteDecorators()
    skip("NEWLINE")
    skip("INDENT") // отступ перед методом роута (после декоратора)

    const token = peek()
    const raw = consume("WORD").value as string
    const method = raw.toUpperCase()

    if (!HTTP_METHODS.has(method as typeof HTTP_METHODS extends Set<infer T> ? T : never)) {
      throw new ParseError(
        "error",
        `неизвестный HTTP-метод \`${raw}\``,
        token.loc.line,
        token.loc.col,
        raw.length,
        `допустимые методы: ${[...HTTP_METHODS].join(", ")}`,
      )
    }

    const path = consume("PATH").value as string

    const route: RouteNode = { method, path, decorators, params: [] }
    return route
  }

  // парсит поля внутри { name: type, age: type }
  function parseObjectFields(): ObjectFieldNode[] {
    const fields: ObjectFieldNode[] = []
    skip("NEWLINE")

    while (peek().type === "INDENT") {
      const next = pos + 1 < tokens.length ? tokens[pos + 1] : null
      if (next?.type === "RBRACE") break
      consume()

      const fName = consume("WORD").value as string
      const fOptional = peek().type === "OPTIONAL"
      if (fOptional) consume()
      consume("COLON")
      skip("INDENT")

      const fType = consume("WORD").value as string
      const fNullable = peek().type === "OPTIONAL"
      if (fNullable) consume()

      const fDecorators: DecoratorNode[] = []
      while (peek().type === "DECORATOR") {
        const d = consume().value as { name: string; arg: string | null }
        fDecorators.push(d)
      }

      fields.push({ name: fName, type: fType, optional: fOptional, nullable: fNullable, decorators: fDecorators })
      skip("NEWLINE")
    }

    return fields
  }

  function parseParam(): ParamNode {
    // декораторы перед параметром (например @description)
    const paramDecorators: DecoratorNode[] = []
    while (peek().type === "DECORATOR") {
      const d = consume().value as { name: string; arg: string | null }
      paramDecorators.push(d)
      skip("NEWLINE")
      skip("INDENT")
    }

    const inToken = peek()
    const rawKind = consume("WORD").value as string

    if (!PARAM_KINDS.has(rawKind)) {
      throw new ParseError(
        "error",
        `неизвестный тип параметра \`${rawKind}\``,
        inToken.loc.line,
        inToken.loc.col,
        rawKind.length,
        "используйте body, param, query, header (или b, p, q, h)",
      )
    }

    const nameToken = peek()
    const name = consume("WORD").value as string

    const optional = peek().type === "OPTIONAL"
    if (optional) consume()

    if (peek().type !== "COLON") {
      throw new ParseError(
        "error",
        "поле без типа",
        nameToken.loc.line,
        nameToken.loc.col,
        name.length,
        `попробуйте \`${rawKind} ${name} : string\``,
      )
    }
    consume("COLON")

    skip("INDENT")

    let type: string
    let fields: ObjectFieldNode[] | undefined

    if (peek().type === "LBRACE") {
      consume() // skip '{'
      type = "object"
      fields = parseObjectFields()

      skip("INDENT")
      if (peek().type === "RBRACE") consume()
    } else {
      // простой тип: string, number, email
      if (peek().type !== "WORD") {
        throw new ParseError(
          "error",
          "ожидался тип поля после `:`",
          peek().loc.line,
          peek().loc.col,
          1,
          "например: string, number, boolean",
        )
      }
      type = consume("WORD").value as string
      const nullable = peek().type === "OPTIONAL"
      if (nullable) consume()

      const decorators: DecoratorNode[] = [...paramDecorators]
      while (peek().type === "DECORATOR") {
        const d = consume().value as { name: string; arg: string | null }
        decorators.push(d)
      }

      return { in: rawKind, name, type, optional, nullable, decorators }
    }

    // декораторы после объекта
    const decorators: DecoratorNode[] = [...paramDecorators]
    while (peek().type === "DECORATOR") {
      const d = consume().value as { name: string; arg: string | null }
      decorators.push(d)
    }

    return { in: rawKind, name, type, optional, nullable: false, decorators, fields }
  }

  // === MAIN ===
  const types: TypeNode[] = []
  const routes: RouteNode[] = []
  let groupPrefix = ""
  let baseIndent = 0

  while (peek().type !== "EOF") {
    skip("NEWLINE")
    if (peek().type === "EOF") break

    if (peek().type === "PATH") {
      groupPrefix = consume().value as string
      baseIndent = 0
      continue
    }

    if (peek().type === "INDENT") {
      baseIndent = consume().value as number
      continue
    }

    // type definition: type User { name: string, age: number }
    if (peek().type === "WORD" && peek().value === "type") {
      consume()
      const name = consume("WORD").value as string
      consume("LBRACE")
      const fields = parseObjectFields()
      skip("INDENT")
      if (peek().type === "RBRACE") consume()
      types.push({ name, fields })
      continue
    }

    const route = parseRouteDecl()
    route.path = groupPrefix + route.path
    skip("NEWLINE")

    while (peek().type === "INDENT" && (peek().value as number) > baseIndent) {
      consume()
      route.params.push(parseParam())
      skip("NEWLINE")
    }

    routes.push(route)
  }

  return { types, routes }
}
