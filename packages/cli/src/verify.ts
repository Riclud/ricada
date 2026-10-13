import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Ir, IrRoute } from "@ricada/core"
import { handlerName } from "@ricada/emitter-ts-common"
import { emitTsServer } from "@ricada/emitter-ts-server"

const TSC = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url))

export type RouteStatus = "implemented" | "missing" | "mismatch"

export interface RouteResult {
  method: string
  path: string
  handler: string
  status: RouteStatus
  errors: string[]
}

export interface VerifyReport {
  ok: boolean
  importError: string | null
  routes: RouteResult[]
  summary: { total: number; implemented: number; missing: number; mismatch: number }
}

const toImportPath = (fromDir: string, target: string): string => {
  let rel = relative(fromDir, target)

  if (!rel.startsWith(".")) rel = `./${rel}`

  rel = rel.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/, "")
  return rel.split(sep).join("/")
}

const routeHandler = (route: IrRoute): string => handlerName(route)

export const verifyImpl = async (ir: Ir, implPath: string, outDir: string): Promise<VerifyReport> => {
  const outAbs = resolve(outDir)
  const implAbs = resolve(implPath)

  for (const file of emitTsServer(ir)) {
    const dest = join(outAbs, file.path)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, file.contents, "utf-8")
  }

  const lines: string[] = []
  const lineMap: Record<number, string> = {}
  lines.push('import type { Handlers } from "./ts-server/contract";')
  lines.push(`import { handlers } from "${toImportPath(outAbs, implAbs)}";`)
  lines.push("")

  ir.routes.forEach((route, index) => {
    const name = routeHandler(route)
    lineMap[lines.length + 1] = name
    lines.push(`export const __ricada_${index}: Handlers[${JSON.stringify(name)}] = handlers[${JSON.stringify(name)}];`)
  })

  await writeFile(join(outAbs, "conformance.ts"), lines.join("\n") + "\n", "utf-8")
  await writeFile(
    join(outAbs, "tsconfig.conformance.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          skipLibCheck: true,
          types: [],
          lib: ["esnext"],
        },
        files: ["conformance.ts"],
      },
      null,
      2,
    ),
    "utf-8",
  )

  const proc = Bun.spawnSync(["bun", TSC, "-p", join(outAbs, "tsconfig.conformance.json"), "--pretty", "false"])
  const output = proc.stdout.toString() + proc.stderr.toString()

  let importError: string | null = null
  const byHandler: Record<string, string[]> = {}

  for (const line of output.split("\n")) {
    const match = line.match(/conformance\.ts\((\d+),\d+\): (?:error|warning) (TS\d+): (.*)$/)
    if (!match) continue

    const lineNo = Number(match[1])
    const code = match[2]!
    const message = match[3]!.trim()

    if (lineNo <= 2) {
      importError = `${code}: ${message}`
      continue
    }

    const name = lineMap[lineNo]
    if (name) (byHandler[name] ??= []).push(`${code}: ${message}`)
  }

  const routes: RouteResult[] = ir.routes.map((route) => {
    const name = routeHandler(route)
    const errors = byHandler[name] ?? []
    const isMissing = errors.some((e) => e.startsWith("TS2339") || e.startsWith("TS7053"))
    let status: RouteStatus = "implemented"

    if (importError || isMissing) status = "missing"
    if (!importError && !isMissing && errors.length > 0) status = "mismatch"

    return { method: route.method, path: route.path, handler: name, status, errors }
  })

  const summary = {
    total: routes.length,
    implemented: routes.filter((r) => r.status === "implemented").length,
    missing: routes.filter((r) => r.status === "missing").length,
    mismatch: routes.filter((r) => r.status === "mismatch").length,
  }

  return { ok: summary.implemented === summary.total && !importError, importError, routes, summary }
}

const MARK: Record<RouteStatus, string> = { implemented: "ok", missing: "MISSING", mismatch: "MISMATCH" }

export const formatReport = (report: VerifyReport): string => {
  const rows = report.routes.map((r) => {
    const route = `${r.method} ${r.path}`
    return `${route.padEnd(42)} ${r.handler.padEnd(20)} ${MARK[r.status]}`
  })

  const header = `${"ROUTE".padEnd(42)} ${"HANDLER".padEnd(20)} STATUS`
  const lines = [header, "-".repeat(header.length), ...rows, ""]

  if (report.importError) lines.push(`import error: ${report.importError}`, "")

  lines.push(
    `summary: ${report.summary.total} routes, ${report.summary.implemented} implemented, ` +
      `${report.summary.missing} missing, ${report.summary.mismatch} mismatch`,
  )

  return lines.join("\n")
}
