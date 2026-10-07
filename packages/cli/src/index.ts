import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve as pathResolve } from "node:path"
import { compile, RicadaError } from "@ricada/core"
import type { Emitter, Ir } from "@ricada/core"
import { emitOpenApi } from "@ricada/emitter-openapi"
import { emitTsServer } from "@ricada/emitter-ts-server"
import { emitTsClient } from "@ricada/emitter-ts-client"
import { formatReport, verifyImpl } from "./verify.ts"

const EMITTERS: Record<string, Emitter> = {
  openapi: { name: "openapi", emit: emitOpenApi },
  "ts-server": { name: "ts-server", emit: emitTsServer },
  "ts-client": { name: "ts-client", emit: emitTsClient },
}

interface Options {
  json: boolean
  impl: string | null
  file: string | null
}

function parseArgs(argv: string[]): { cmd: string; opts: Options } {
  const args = [...argv]
  let cmd = "check"
  if (args[0] && !args[0].startsWith("--")) cmd = args.shift()!
  const opts: Options = { json: false, impl: null, file: null }
  while (args.length > 0) {
    const arg = args.shift()!
    if (arg === "--json") opts.json = true
    else if (arg === "--impl") opts.impl = args.shift() ?? null
    else if (!opts.file) opts.file = arg
  }
  return { cmd, opts }
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

async function compileFile(file: string): Promise<{ ir: Ir; source: string } | null> {
  let source: string
  try {
    source = await readFile(file, "utf-8")
  } catch {
    console.error(`cannot read ${file}`)
    return null
  }
  try {
    return { ir: compile(source), source }
  } catch (err) {
    printError(err, source)
    return null
  }
}

function emitReport(report: Awaited<ReturnType<typeof verifyImpl>>, json: boolean): number {
  if (json) console.log(JSON.stringify(report, null, 2))
  else console.log(formatReport(report))
  return report.ok ? 0 : 1
}

export async function run(argv: string[]): Promise<number> {
  const { cmd, opts } = parseArgs(argv)
  const file = opts.file ?? findContract()
  if (!file) {
    console.error("no contract file found (expected api.ricada or ricada.rd)")
    return 1
  }

  const compiled = await compileFile(file)
  if (!compiled) return 1
  const { ir } = compiled

  if (cmd === "check") {
    if (!opts.impl) {
      console.log(`ok: ${file} is valid`)
      return 0
    }
    const out = ir.config.out ?? "./generated"
    return emitReport(await verifyImpl(ir, opts.impl, out), opts.json)
  }

  if (cmd === "status") {
    if (!opts.impl) {
      console.error("status requires --impl <file>")
      return 1
    }
    const out = ir.config.out ?? "./generated"
    return emitReport(await verifyImpl(ir, opts.impl, out), opts.json)
  }

  if (cmd === "gen") {
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

  console.error(`unknown command \`${cmd}\` (expected: check | status | gen)`)
  return 1
}
