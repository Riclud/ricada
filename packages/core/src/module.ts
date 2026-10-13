import { readFileSync } from "fs"
import { dirname, join } from "path"
import { ImportError } from "./errors.ts"
import { lex } from "./lexer.ts"
import { parse } from "./parse.ts"
import type { Ast } from "./ast.ts"

export interface ImportOptions {
  baseDir?: string
  read?: (absPath: string) => string
}

export const loadImports = (ast: Ast, opts: ImportOptions = {}): Ast => {
  const first = ast.declarations.find((d) => d.kind === "import")

  if (!first) return ast

  const baseDir = opts.baseDir

  if (!baseDir) {
    throw new ImportError("import requires a base directory to resolve modules", first.loc, first.source.length)
  }

  const read = opts.read ?? ((absPath: string) => readFileSync(absPath, "utf-8"))
  const out: Ast["declarations"] = []
  const done = new Set<string>()
  const inProgress = new Set<string>()

  const visit = (node: Ast, base: string): void => {
    for (const decl of node.declarations) {
      if (decl.kind !== "import") {
        out.push(decl)
        continue
      }

      const absPath = join(base, decl.source)

      if (inProgress.has(absPath)) {
        throw new ImportError(`circular import \`${decl.source}\``, decl.loc, decl.source.length)
      }

      if (done.has(absPath)) continue

      let source: string

      try {
        source = read(absPath)
      } catch (err) {
        throw new ImportError(
          `cannot read import \`${decl.source}\``,
          decl.loc,
          decl.source.length,
          (err as Error).message,
        )
      }

      inProgress.add(absPath)
      visit(parse(lex(source)), dirname(absPath))
      inProgress.delete(absPath)
      done.add(absPath)
    }
  }

  visit(ast, baseDir)
  return { declarations: out }
}
