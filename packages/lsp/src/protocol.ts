export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface Diagnostic {
  range: Range
  severity: number
  source: string
  message: string
}

export interface CompletionItem {
  label: string
  kind: number
  detail?: string
}

export interface ServerCapabilities {
  textDocumentSync: number
  completionProvider: { triggerCharacters: string[] }
  hoverProvider: boolean
  definitionProvider: boolean
}
