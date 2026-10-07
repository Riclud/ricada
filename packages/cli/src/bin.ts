#!/usr/bin/env bun
import { run } from "./index.ts"

const code = await run(process.argv.slice(2))
process.exit(code)
