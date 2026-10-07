export type TokenType =
  | 'NEWLINE'
  | 'INDENT'
  | 'WORD'
  | 'NUMBER'
  | 'PATH'
  | 'COLON'
  | 'OPTIONAL'
  | 'DECORATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'LBRACE'
  | 'RBRACE'
  | 'STRING'
  | 'ARROW'
  | 'EOF'

export interface Location {
  line: number
  col: number
}

export interface Token {
  type: TokenType
  value: string | number | { name: string; arg: string | null } | null
  loc: Location
}

export const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
  'OPTIONS', 'HEAD', 'TRACE', 'CONNECT',
])

export const PARAM_KINDS = new Set(['body', 'param', 'query', 'header', 'b', 'p', 'q', 'h'])

export interface DecoratorNode {
  name: string
  arg: string | null
}

export interface ObjectFieldNode {
  name: string
  type: string
  optional: boolean
  nullable?: boolean
  decorators: DecoratorNode[]
}

export interface ParamNode {
  in: string
  name: string
  type: string
  optional: boolean
  nullable?: boolean
  decorators: DecoratorNode[]
  fields?: ObjectFieldNode[]
}

export interface RouteNode {
  method: string
  path: string
  decorators: DecoratorNode[]
  params: ParamNode[]
}

export interface TypeNode {
  name: string
  fields: ObjectFieldNode[]
}

export interface AstNode {
  types: TypeNode[]
  routes: RouteNode[]
}
