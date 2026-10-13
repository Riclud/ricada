import type { EmittedFile, Ir } from "@ricada/core"
import {
  handlerName,
  inputTypeName,
  renderErrorDecl,
  renderInputInterface,
  renderTypeDecl,
  routeOutputType,
} from "@ricada/emitter-ts-common"

const renderTypes = (ir: Ir): string => {
  const parts: string[] = []

  for (const type of ir.types) parts.push(renderTypeDecl(type))
  for (const error of ir.errors) parts.push(renderErrorDecl(error))

  return parts.join("\n\n") + "\n"
}

const renderContract = (ir: Ir): string => {
  const inputs: string[] = []
  const methods: string[] = []

  for (const route of ir.routes) {
    const input = renderInputInterface(route, { prefix: "T." })

    if (input) inputs.push(input)

    const name = handlerName(route)
    const output = routeOutputType(route, { prefix: "T." })

    if (input) {
      methods.push(`  ${name}(input: ${inputTypeName(route)}): Promise<${output}> | ${output};`)
      continue
    }

    methods.push(`  ${name}(): Promise<${output}> | ${output};`)
  }

  return [
    'import type * as T from "./types";',
    "",
    inputs.join("\n\n"),
    "",
    "export interface Handlers {",
    methods.join("\n"),
    "}",
    "",
    "export type RouteName = keyof Handlers;",
    "",
    "export function defineHandlers<H extends Handlers>(handlers: H): H {",
    "  return handlers;",
    "}",
    "",
  ].join("\n")
}

export const emitTsServer = (ir: Ir): EmittedFile[] => {
  return [
    { path: "ts-server/types.ts", contents: renderTypes(ir) },
    { path: "ts-server/contract.ts", contents: renderContract(ir) },
    {
      path: "ts-server/index.ts",
      contents: 'export * from "./types";\nexport * from "./contract";\n',
    },
  ]
}
