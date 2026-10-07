export type TokenType =
  | "WORD"
  | "NUMBER"
  | "STRING"
  | "PATH"
  | "DECORATOR"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "LPAREN"
  | "RPAREN"
  | "COLON"
  | "COMMA"
  | "DOT"
  | "QUESTION"
  | "EQUALS"
  | "PIPE"
  | "NEWLINE"
  | "EOF";

export interface Location {
  line: number;
  col: number;
  offset: number;
}

export interface Token {
  type: TokenType;
  value: string | null;
  loc: Location;
}

export const PUNCTUATION: Record<string, TokenType> = {
  "{": "LBRACE",
  "}": "RBRACE",
  "[": "LBRACKET",
  "]": "RBRACKET",
  "(": "LPAREN",
  ")": "RPAREN",
  ":": "COLON",
  ",": "COMMA",
  ".": "DOT",
  "?": "QUESTION",
  "=": "EQUALS",
  "|": "PIPE",
};

export const WORD_START = /[\p{L}_]/u;
export const WORD_PART = /[\p{L}\p{N}_-]/u;
