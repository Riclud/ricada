#!/usr/bin/env bun
import { dirname } from "path"
import { fileURLToPath } from "url"
import { analyze, completions, definition, hover } from "./features.ts"
import type { Position } from "./protocol.ts"

interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

interface DidOpenParams {
  textDocument: { uri: string; text: string }
}

interface DidChangeParams {
  textDocument: { uri: string }
  contentChanges: Array<{ text: string }>
}

interface DocumentParams {
  textDocument: { uri: string }
}

interface PositionParams {
  textDocument: { uri: string }
  position: Position
}

const documents = new Map<string, string>()
let shuttingDown = false

const write = (message: JsonRpcMessage): void => {
  const payload = Buffer.from(JSON.stringify(message), "utf-8")
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

const respond = (id: JsonRpcMessage["id"], result: unknown): void => write({ jsonrpc: "2.0", id, result })

const respondError = (id: JsonRpcMessage["id"], code: number, message: string): void =>
  write({ jsonrpc: "2.0", id, error: { code, message } })

const notify = (method: string, params: unknown): void => write({ jsonrpc: "2.0", method, params })

const uriToPath = (uri: string): string | undefined => {
  if (!uri.startsWith("file://")) return undefined

  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

const publishDiagnostics = (uri: string): void => {
  const source = documents.get(uri)

  if (source === undefined) return

  const path = uriToPath(uri)
  const analysis = analyze(source, path ? dirname(path) : undefined)
  notify("textDocument/publishDiagnostics", { uri, diagnostics: analysis.diagnostics })
}

const handle = (msg: JsonRpcMessage): void => {
  const { id, method, params } = msg

  if (!method) return

  if (method === "initialize") {
    respond(id, {
      capabilities: {
        textDocumentSync: 1,
        completionProvider: { triggerCharacters: [":", "@", " ", "|"] },
        hoverProvider: true,
        definitionProvider: true,
      },
      serverInfo: { name: "ricada-lsp", version: "0.1.0" },
    })
    return
  }

  if (method === "initialized") return

  if (method === "shutdown") {
    shuttingDown = true
    respond(id, null)
    return
  }

  if (method === "exit") {
    process.exit(shuttingDown ? 0 : 1)
  }

  if (method === "textDocument/didOpen") {
    const p = params as DidOpenParams
    documents.set(p.textDocument.uri, p.textDocument.text)
    publishDiagnostics(p.textDocument.uri)
    return
  }

  if (method === "textDocument/didChange") {
    const p = params as DidChangeParams
    const change = p.contentChanges[p.contentChanges.length - 1]

    if (change) documents.set(p.textDocument.uri, change.text)

    publishDiagnostics(p.textDocument.uri)
    return
  }

  if (method === "textDocument/didClose") {
    const p = params as DocumentParams
    documents.delete(p.textDocument.uri)
    notify("textDocument/publishDiagnostics", { uri: p.textDocument.uri, diagnostics: [] })
    return
  }

  if (method === "textDocument/completion") {
    const p = params as PositionParams
    const source = documents.get(p.textDocument.uri) ?? ""
    respond(id, { isIncomplete: false, items: completions(analyze(source), source, p.position) })
    return
  }

  if (method === "textDocument/hover") {
    const p = params as PositionParams
    const source = documents.get(p.textDocument.uri) ?? ""
    const value = hover(analyze(source), source, p.position)
    respond(id, value ? { contents: { kind: "markdown", value } } : null)
    return
  }

  if (method === "textDocument/definition") {
    const p = params as PositionParams
    const source = documents.get(p.textDocument.uri) ?? ""
    respond(id, definition(analyze(source), p.textDocument.uri, source, p.position) ?? null)
    return
  }

  if (id !== undefined && id !== null) respondError(id, -32601, `method not found: ${method}`)
}

let buffer = Buffer.alloc(0)

const drain = (): void => {
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n")

    if (headerEnd === -1) return

    const header = buffer.subarray(0, headerEnd).toString("utf-8")
    const match = /Content-Length: (\d+)/i.exec(header)

    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }

    const length = Number(match[1])
    const start = headerEnd + 4

    if (buffer.length < start + length) return

    const body = buffer.subarray(start, start + length).toString("utf-8")
    buffer = buffer.subarray(start + length)

    try {
      handle(JSON.parse(body) as JsonRpcMessage)
    } catch {
      continue
    }
  }
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  drain()
})

process.stdin.on("end", () => process.exit(0))
