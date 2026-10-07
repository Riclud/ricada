import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { lex, parse, RicadaError } from "@ricada/core";

const file = fileURLToPath(new URL("./basic.ricada", import.meta.url));
const text = await fs.readFile(file, "utf-8");
const sourceLines = text.split("\n");

try {
  const ast = parse(lex(text));
  console.log(JSON.stringify(ast, null, 2));
} catch (err) {
  if (err instanceof RicadaError) {
    console.error(err.format(sourceLines));
  } else {
    console.error(err);
  }
  process.exit(1);
}
