import { Cursor } from "./cursor.ts";
import { LexError } from "./errors.ts";
import { PUNCTUATION, WORD_PART, WORD_START } from "./tokens.ts";
import type { Token, TokenType } from "./tokens.ts";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

const isPathStop = (ch: string): boolean =>
  ch === "" ||
  ch === " " ||
  ch === "\t" ||
  ch === "\n" ||
  ch === "\r" ||
  ch === "{" ||
  ch === "}" ||
  ch === "(" ||
  ch === ")" ||
  ch === "[" ||
  ch === "]" ||
  ch === ",";

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const c = new Cursor(source);

  const add = (type: TokenType, value: string | null, loc = c.loc()): void => {
    tokens.push({ type, value, loc });
  };

  while (!c.isEOF) {
    const ch = c.ch;

    // newlines
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && c.peek() === "\n") c.advance(2);
      else c.advance();
      add("NEWLINE", null);
      continue;
    }

    // whitespace (indentation is cosmetic)
    if (ch === " " || ch === "\t") {
      c.advance();
      continue;
    }

    // comments: "// ..." and "# ..."
    if (ch === "#" || (ch === "/" && c.peek() === "/")) {
      c.skipWhile((x) => x !== "\n" && x !== "\r");
      continue;
    }

    // strings
    if (ch === '"' || ch === "'") {
      const start = c.loc();
      const quote = ch;
      c.advance();
      let value = "";
      while (!c.isEOF && c.ch !== quote) {
        if (c.ch === "\\") {
          c.advance();
          const e: string = c.ch;
          if (e === "n") value += "\n";
          else if (e === "t") value += "\t";
          else if (e === "r") value += "\r";
          else if (e === "\\") value += "\\";
          else if (e === quote) value += quote;
          else if (e === "") {
            value += "\\";
            break;
          } else value += "\\" + e;
          c.advance();
        } else {
          value += c.ch;
          c.advance();
        }
      }
      if (c.isEOF) {
        throw new LexError("unterminated string", start, 1, `add a closing ${quote}`);
      }
      c.advance(); // closing quote
      add("STRING", value, start);
      continue;
    }

    // decorators: @name, @ns.name
    if (ch === "@") {
      const start = c.loc();
      c.advance();
      let name = c.eatWhile((x) => WORD_PART.test(x));
      if (name === "") {
        throw new LexError("empty annotation name", start, 1, "e.g. @min, @cache");
      }
      while (c.is(".")) {
        c.advance();
        const seg = c.eatWhile((x) => WORD_PART.test(x));
        if (seg === "") {
          throw new LexError("empty annotation namespace", start, 1, "e.g. @http.status");
        }
        name += "." + seg;
      }
      add("DECORATOR", name, start);
      continue;
    }

    // paths: /users/:id
    if (ch === "/") {
      const start = c.loc();
      const path = c.eatWhile((x) => !isPathStop(x));
      add("PATH", path, start);
      continue;
    }

    // words / identifiers
    if (WORD_START.test(ch)) {
      const start = c.loc();
      const word = c.eatWhile((x) => WORD_PART.test(x));
      add("WORD", word, start);
      continue;
    }

    // numbers: 120, 4.5
    if (isDigit(ch)) {
      const start = c.loc();
      let num = c.eatWhile(isDigit);
      if (c.is(".") && isDigit(c.peek())) {
        c.advance();
        num += "." + c.eatWhile(isDigit);
      }
      add("NUMBER", num, start);
      continue;
    }

    // punctuation
    const punct = PUNCTUATION[ch];
    if (punct) {
      add(punct, null);
      c.advance();
      continue;
    }

    throw new LexError(`unexpected character \`${ch}\``, c.loc(), 1);
  }

  add("EOF", null);
  return tokens;
}
