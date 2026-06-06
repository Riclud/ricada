import fs from "fs/promises";
import { lex } from "./parser/lexer.ts";
import { parse } from "./parser/parser.ts";
import { ParseError } from "./parser/errors.ts";

const text = await fs.readFile(".ricada", "utf-8");
const sourceLines = text.split("\n");

try {
  const tokens = lex(text);
  const ast = parse(tokens, sourceLines);
  console.log(JSON.stringify(ast, null, 2));
} catch (err) {
  if (err instanceof ParseError) {
    console.error(err.format(sourceLines));
  } else {
    console.error(err);
  }
  process.exit(1);
}
