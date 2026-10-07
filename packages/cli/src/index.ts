import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve as pathResolve } from "node:path"
import { compile, RicadaError } from "@ricada/core"
import type { Emitter } from "@ricada/core"
import { emitOpenApi } from "@ricada/emitter-openapi"

const EMITTERS: Record<string, Emitter> = {
  openapi: { name: "openapi", emit: emitOpenApi },
}

function findContract(): string | null {
  for (const name of ["api.ricada", "main.ricada", "ricada.ricada", "ricada.rd", "api.rd"]) {
    if (existsSync(name)) return name
  }
  const any = readdirSync(".").find((f) => f.endsWith(".ricada") || f.endsWith(".rd"))
  return any ?? null
}

function printError(err: unknown, source: string): void {
  if (err instanceof RicadaError) {
    console.error(err.format(source.split("\n")))
  } else {
    console.error(err)
  }
}

export async function run(argv: string[]): Promise<number> {
  const [cmd = "check", fileArg] = argv
  const file = fileArg ?? findContract()

  if (!file) {
    console.error("no contract file found (expected api.ricada or ricada.rd)")
    return 1
  }

  let source: string
  try {
    source = await readFile(file, "utf-8")
  } catch {
    console.error(`cannot read ${file}`)
    return 1
  }

  if (cmd === "check") {
    try {
      compile(source)
      console.log(`ok: ${file} is valid`)
      return 0
    } catch (err) {
      printError(err, source)
      return 1
    }
  }

  if (cmd === "gen") {
    let ir
    try {
      ir = compile(source)
    } catch (err) {
      printError(err, source)
      return 1
    }
    const out = ir.config.out ?? "./generated"
    const targets = ir.config.targets.length > 0 ? ir.config.targets : ["openapi"]
    let emitted = 0
    for (const target of targets) {
      const emitter = EMITTERS[target]
      if (!emitter) {
        console.warn(`skip: no emitter for target \`${target}\``)
        continue
      }
      for (const outFile of emitter.emit(ir)) {
        const dest = pathResolve(out, outFile.path)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, outFile.contents, "utf-8")
        console.log(`  ${target}: ${join(out, outFile.path)}`)
        emitted++
      }
    }
    console.log(`generated ${emitted} file(s) into ${out}`)
    return 0
  }

  console.error(`unknown command \`${cmd}\` (expected: check | gen)`)
  return 1
}
