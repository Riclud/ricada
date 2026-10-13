export type HandlerFunction = (input: RequestInput) => unknown | Promise<unknown>

export type HandlerMap = Record<string, HandlerFunction>

export interface Identity {
  scheme: string
  subject: string | null
  claims: Record<string, unknown>
}

export interface RequestInput {
  params: Record<string, unknown>
  query: Record<string, unknown>
  headers: Record<string, unknown>
  body: unknown
  identity: Identity | null
}

export interface RuntimeOptions {
  env?: (name: string) => string | undefined
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`HTTP ${status}`)
    this.name = "HttpError"
  }
}

export interface ValidationIssue {
  field: string
  reason: string
}
