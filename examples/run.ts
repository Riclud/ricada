import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { lex, parse, ParseError } from "@ricada/core";

const file = fileURLToPath(new URL("./basic.ricada", import.meta.url));
const text = await fs.readFile(file, "utf-8");
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
