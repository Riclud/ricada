<p align="center">
  <strong>English</strong> ·
  <a href="docs/README.ru.md">Русский</a>
</p>

# Ricada

**API compiler and API edge.** A single human-readable `.ricada` contract is the single source of
truth for request/response validation, backend handlers, frontend clients, OpenAPI, documentation,
and gateway policies (auth, rate limiting, CORS, security).

From one file you get:

- request / response validation (compiler → IR → validators);
- backend handler interfaces (`Handlers` / `defineHandlers`);
- a typed frontend client;
- OpenAPI 3.1 and documentation;
- executable gateway policies: auth (JWT/apiKey), rate limiting, CORS, security headers.

Plus a language server for editors (diagnostics, context-aware completions, hover, go-to-definition)
and a tree-sitter grammar for syntax highlighting.

## Table of contents

1. [Quick start](#quick-start)
2. [Language reference](#language-reference)
   - [Files and syntax](#files-and-syntax)
   - [Types](#types)
   - [Errors](#errors)
   - [Config](#config)
   - [Routes](#routes)
   - [Annotations reference](#annotations-reference)
3. [CLI](#cli)
4. [Generation and emitters](#generation-and-emitters)
5. [Runtime](#runtime)
6. [LSP and editors](#lsp-and-editors)
7. [Examples](#examples)
8. [Commands](#commands)
9. [Structure](#structure)
10. [Development](#development)

## Quick start

```bash
bun install
bun run dev        # compile examples/basic.ricada and print the IR
bun run check      # validate the contract
bun run gen        # generate ts-server/ts-client/openapi into ./generated
bun run mock       # run a mock server on :3000
bun run lsp        # start the language server (stdio)
```

## Language reference

### Files and syntax

- Files use the `.ricada` extension (alias `.rd`).
- **Structure is `{}`-braced; indentation is cosmetic.** Inside a block, items are separated by a
  newline or a comma.
- Comments: `// this style` and `# also this`.
- Strings: `"double"` and `'single'`, with `\n \t \r \\ \" \'` escapes.
- Identifiers may contain letters, digits, `_`, `-` and `.` (so `jwt.sub`, `x-request-id`,
  `ts-client` are single identifiers).
- Modules: `import "./common.ricada"` — imported declarations are merged before the importer,
  shared modules are deduplicated, and cycles are detected.
- A `config {}` block holds compile-time/gateway settings (see [Config](#config)).

### Types

Primitives (cross-language):

| Type       | Meaning                     |
| ---------- | --------------------------- |
| `string`   | UTF-8 string                |
| `int`      | integer                     |
| `float`    | number                      |
| `bool`     | boolean                     |
| `uuid`     | UUID string (validated)     |
| `datetime` | ISO-8601 string (validated) |

Object, enum, arrays, optionals, defaults:

```ricada
enum Role { admin, user, guest }

type Address {
  city: string @min(1)
  zip: string @regex("^[0-9]{5}$")
  country: string = "US"        // default
}

type User {
  id: string @uuid
  name: string @min(1) @max(100)
  age: int?                       // optional
  tags: string[]                  // array
  address: Address?               // optional nested
  role: Role = user               // enum default
  active: bool = true
}
```

Unions, literals and `null`:

```ricada
type Id = string | int
type MaybeAddress = Address | null

type Circle { kind: "circle", radius: float @min(0) }
type Square { kind: "square", side: float @min(0) }

// a union of objects sharing a literal field becomes a *discriminated union*
type Shape = Circle | Square
```

Field modifiers:

| Modifier | Example             | Meaning                                                |
| -------- | ------------------- | ------------------------------------------------------ |
| `?`      | `age: int?`         | optional (may be absent)                               |
| `[]`     | `tags: string[]`    | array of the value type                                |
| `= x`    | `role: Role = user` | default value (also makes the field optional on input) |

### Errors

`error` is a first-class type and can be referenced from routes:

```ricada
type FieldError { field: string, reason: string }

error ValidationFailed {
  message: string
  fields: FieldError[]
}

error TooManyRequests {
  message: string
  retryAfter: int
}
```

Basic set: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `TooManyRequests`.
The runtime builds error bodies from these declared types (filling `message`, `code` defaults and
extra fields such as `retryAfter`), so the wire format matches your contract.

### Config

```ricada
config {
  targets: [ts-server, ts-client, ts-elysia, ts-nestjs, openapi, docs]
  out: "./generated"
  wire: json
}
```

| Key       | Type       | Meaning                                  |
| --------- | ---------- | ---------------------------------------- |
| `targets` | `[string]` | which emitters to run on `gen`           |
| `out`     | `string`   | output directory (default `./generated`) |
| `wire`    | `json`     | wire format                              |

**Auth schemes** — verified natively by the runtime:

```ricada
config {
  auth {
    bearer {
      type: jwt
      issuer: env("JWT_ISSUER")
      audience: "api"
      secret: env("JWT_SECRET")
      algorithm: HS256
    }
    apiKey {
      type: apiKey
      in: header
      name: "X-API-Key"
      key: env("API_KEY")
    }
  }
}
```

| Field                 | Applies to  | Type                    |
| --------------------- | ----------- | ----------------------- |
| `type`                | jwt, apiKey | `jwt` / `apiKey`        |
| `secret`              | jwt         | `env("…")`              |
| `algorithm`           | jwt         | `HS256`                 |
| `issuer` / `audience` | jwt         | `string`                |
| `name`                | apiKey      | header name             |
| `in`                  | apiKey      | `header`                |
| `key`                 | apiKey      | credential (`env("…")`) |

**CORS** and **security headers**:

```ricada
config {
  cors {
    origins: [env("APP_ORIGIN")]
    methods: [GET, POST, PUT, PATCH, DELETE]
    headers: ["Authorization", "Content-Type", "Idempotency-Key"]
    credentials: true
    maxAge: "1h"
  }
  security {
    headers {
      hsts: true
      xContentTypeOptions: nosniff
      xFrameOptions: DENY
      referrerPolicy: "no-referrer"
      contentSecurityPolicy: "default-src 'self'"
    }
  }
}
```

| Section key                              | Options                                      |
| ---------------------------------------- | -------------------------------------------- |
| `cors.origins` / `.methods` / `.headers` | arrays of strings                            |
| `cors.credentials`                       | `true` / `false`                             |
| `cors.maxAge`                            | duration string (`"1h"`)                     |
| `security.headers.hsts`                  | `true`                                       |
| `security.headers.*`                     | `nosniff`, `DENY`, `"no-referrer"`, `string` |

**Rate limiting**:

```ricada
config {
  rateLimit {
    algorithm: tokenBucket
    store: memory
    default { limit: 1000, window: "1m", key: ip, burst: 50 }
  }
}
```

| Key              | Type                                                        |
| ---------------- | ----------------------------------------------------------- |
| `algorithm`      | `tokenBucket`                                               |
| `store`          | `memory` (redis planned)                                    |
| `default.limit`  | `int` — refill rate per window                              |
| `default.window` | duration string (`"30s"`, `"1m"`, `"1h"`, `"1d"`)           |
| `default.key`    | `ip` / `route` / `jwt.sub` / `param:<name>` / `header("X")` |
| `default.burst`  | `int` — bucket capacity                                     |

**Control plane** (backend → gateway state):

```ricada
config {
  control { secret: env("RICADA_CONTROL_SECRET"), allow: [rateLimit, deny, cache, metrics, breaker] }
}
```

### Routes

Routes live inside group blocks:

```ricada
/api {
  GET /users {
    @tag("Users")
    @summary("List users")
    @description("Returns a paginated list of users.")
    @auth(bearer, scopes: ["read:users"])
    @rateLimit(limit: 120, window: "1m", key: jwt.sub, burst: 30)

    query {
      page: int? @min(1)
      size: int? @min(1) @max(100)
    }

    returns 200: PageOfUser
    errors { 401: Unauthorized, 403: Forbidden, 429: TooManyRequests }
    handler listUsers
  }

  GET /users/:id {
    @auth(bearer, scopes: ["read:users"])
    params { id: string @uuid }
    returns 200: User
    errors { 401: Unauthorized, 404: NotFound }
    handler getUser
  }

  POST /users {
    @auth(public: true)
    body {
      name: string @min(1) @max(100)
      email: string @email
    }
    returns 201: User
    errors { 400: ValidationFailed, 409: Conflict }
    handler createUser
  }
}
```

Route parts:

| Part         | Form                                                      | Meaning                                |
| ------------ | --------------------------------------------------------- | -------------------------------------- |
| Method       | `GET POST PUT PATCH DELETE OPTIONS HEAD`                  | HTTP method                            |
| Path         | `/users/:id`                                              | `:name` are path parameters            |
| Param blocks | `body {}` `params {}` `query {}` `headers {}`             | input locations, each a list of fields |
| `returns`    | `200: Type` / `204` / `Type`                              | success status + type (optional)       |
| `errors`     | `{ 401: Unauthorized, ... }`                              | declared errors per status             |
| `handler`    | `listUsers`                                               | backend function to implement          |
| Annotations  | `@auth(...) @rateLimit(...) @cache(...) @deprecated(...)` | see below                              |

### Annotations reference

**Field / type-level annotations** (apply to a field; affect validation, OpenAPI and mock values):

| Annotation          | Argument | Type     | Effect                                       |
| ------------------- | -------- | -------- | -------------------------------------------- |
| `@min(n)`           | `n`      | `int`    | numeric minimum; on strings — minimum length |
| `@max(n)`           | `n`      | `int`    | numeric maximum; on strings — maximum length |
| `@email`            | —        | —        | validates email format                       |
| `@regex("…")`       | pattern  | `string` | validates against the regex                  |
| `@uuid`             | —        | —        | validates UUID format                        |
| `@sensitive`        | —        | —        | marks `writeOnly` in OpenAPI                 |
| `@example(v)`       | value    | any      | used by docs and the mock server             |
| `@description("…")` | text     | `string` | doc comment in generated types               |

**Route-level annotations**:

| Annotation                              | Argument                    | Type                     | Effect                                           |
| --------------------------------------- | --------------------------- | ------------------------ | ------------------------------------------------ |
| `@tag("…")`                             | tag                         | `string` (or `string[]`) | grouping in OpenAPI/docs                         |
| `@summary("…")`                         | text                        | `string`                 | short docs                                       |
| `@description("…")`                     | text                        | `string`                 | detailed docs                                    |
| `@auth(scheme, …)`                      | scheme                      | `string`                 | runtime auth (JWT/apiKey)                        |
| `@auth(public: true)`                   | —                           | `boolean`                | disables auth for the route                      |
| `@auth(scopes: […], roles: […])`        | arrays                      | `string[]`               | scopes (AND) + roles (OR) checked against claims |
| `@rateLimit(limit, window, key, burst)` |                             | see table                | per-route token bucket (overrides config)        |
| `@cache(ttl, key)`                      | `ttl` `int`, `key` `string` |                          | parsed (execution planned)                       |
| `@deprecated(reason: "…")`              | text                        | `string`                 | marks the route deprecated                       |

`@rateLimit` arguments (all optional — fall back to `config.rateLimit.default`):

| Argument | Type     | Meaning                                                     |
| -------- | -------- | ----------------------------------------------------------- |
| `limit`  | `int`    | refill per window                                           |
| `window` | `string` | `"30s"`, `"1m"`, `"1h"`, `"1d"`                             |
| `key`    | `string` | `ip` / `route` / `jwt.sub` / `param:<name>` / `header("X")` |
| `burst`  | `int`    | bucket capacity                                             |

## CLI

`bun run <script>` — all scripts run `@ricada/cli`:

| Command                                                  | Description                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bun run check <file>`                                   | validate a contract and print the result                                                    |
| `bun run check <file> --impl backend.ts`                 | static conformance: generate the contract and type-check a backend against `Handlers` (tsc) |
| `bun run status <file> --impl backend.ts`                | same as `check --impl`                                                                      |
| `bun run gen <file>`                                     | run every emitter listed in `config.targets` into `config.out`                              |
| `bun run mock <file> --port 3000`                        | serve example responses for every route                                                     |
| `bun run test:api <file> --target http://localhost:3000` | hit every route and verify status/body against the contract                                 |

If no file is given, the CLI looks for `api.ricada`, `main.ricada`, `ricada.ricada`, `ricada.rd`,
`api.rd`, then any `.ricada`/`.rd` file in the working directory.

## Generation and emitters

An emitter is a function `emit(ir): EmittedFile[]`. Existing targets:

| Target      | Output                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `ts-server` | `ts-server/types.ts`, `ts-server/contract.ts` — `Handlers`/`defineHandlers` stubs and `RouteName`  |
| `ts-client` | `ts-client/{types,validators,client,index}.ts` — a typed fetch client with dev response validation |
| `openapi`   | `openapi.json` — OpenAPI 3.1 (parameters, requestBody, responses, discriminator)                   |

Planned targets (declared in the reference contract but not yet emitted): `ts-elysia`,
`ts-nestjs`, `docs`, `asyncapi`.

## Runtime

`@ricada/runtime` executes a contract. `createHandler(ir, handlers)` returns a
`(req: Request) => Promise<Response>` that works with `Bun.serve` or any fetch adapter:

```ts
import { createHandler, HttpError } from "@ricada/runtime"
import { compile } from "@ricada/core"

const ir = compile(`...`) // or from a file with { baseDir }

const app = createHandler(ir, {
  async getUser(input) {
    if (input.params.id !== "known") throw new HttpError(404, undefined)
    return { id: input.params.id, name: "Jane" }
  },
})
```

The handler contract mirrors the generated `Handlers` — `input` is `{ params, query, headers, body, identity }`
and a thrown `HttpError(status, body)` (or any object with `status`/`body`) becomes the declared error
response for that status.

Per request the runtime:

1. **validates input** (query/params/headers/body, including annotation constraints and defaults);
2. **authenticates** per `@auth(...)` using the schemes from `config.auth` — JWT HS256 or apiKey,
   `scopes` (all required) and `roles` (any required), and exposes `input.identity`;
3. **rate-limits** per `@rateLimit(...)`/config with a token bucket and emits
   `X-RateLimit-Limit`/`X-RateLimit-Remaining`, `Retry-After` + `429`;
4. **validates the handler output** against the declared `returns`;
5. sets **CORS** and **security headers** from the config (including `OPTIONS` preflight);
6. responds, building error bodies from the declared `error` types.

Exported helpers: `buildTypeMap`, `typeReason`, `fieldsReason`, `validateRequestInput`,
`matchOutput`, `MemoryStore`, `HttpError`.

## LSP and editors

`@ricada/lsp` is a Language Server over stdio (start it with `bun run lsp`):

- **diagnostics** — parser/resolver/import errors with ranges;
- **context-aware completion** — the list depends on the cursor position:
  declaration keywords at the top level, `body/params/query/headers/returns/errors/handler` in routes,
  types after `:`, and **annotations filtered by field type** (`string @` suggests only string
  annotations, `int @` only `@min/@max`, route `@` suggests route annotations);
- **hover** — type and field info;
- **go-to-definition** — jump to a type declaration.

**Zed** — `editors/ricada-zed` bundles the tree-sitter grammar (highlighting, brackets, outline,
indentation) and the LSP adapter. Use it as a dev extension from `editors/ricada-zed`.

Other editors get the same LSP binary; only a thin client (language registration + grammar) is needed.

## Examples

The reference contract is `examples/basic.ricada` (users, sessions, discriminated unions, admin
routes). Companion files:

- `examples/run.ts` — compile and dump the IR;
- `examples/backend.ts` — a full `Handlers` implementation (run `bun run gen` first);
- `examples/client.ts` — using the generated client (run `bun run gen` first).

## Commands

| Command                                    | Description                                      |
| ------------------------------------------ | ------------------------------------------------ |
| `bun run dev` / `start`                    | compile `examples/basic.ricada`, print the IR    |
| `bun run check`                            | validate the contract                            |
| `bun run gen`                              | generate per `config.targets` into `./generated` |
| `bun run mock`                             | mock server on :3000                             |
| `bun run test:api -- --target <url>`       | run the contract against a target                |
| `bun run lsp`                              | language server (stdio)                          |
| `bun test`                                 | tests                                            |
| `bun run typecheck` / `lint` / `fmt:check` | static checks                                    |

## Structure

```
packages/
  core/              # @ricada/core — lexer, parser, resolver, IR, module loader, errors
  cli/               # @ricada/cli — check | status | gen | mock | test
  emitter-openapi/   # OpenAPI 3.1
  emitter-ts-client/ # typed fetch client + validators
  emitter-ts-common/ # shared codegen helpers
  emitter-ts-server/ # Handlers stubs
  runtime/           # createHandler, auth, rate-limit, cors/security, validators
  lsp/               # language server
editors/
  tree-sitter-ricada/ # tree-sitter grammar
  ricada-zed/        # Zed extension (highlighting + LSP adapter)
examples/
  basic.ricada       # reference contract
  backend.ts         # example Handlers implementation
  client.ts          # example of using the generated client
```

## Development

- Monorepo on Bun workspaces: a new package is a folder in `packages/` plus a dependency in the root
  `package.json`.
- Code is strict TypeScript (`tsconfig.base.json`); `typecheck`, `eslint` and `prettier` are enforced.
- Tests: `bun test` (snapshots are regenerated with `bun test --update-snapshots`).
- Adding an emitter: implement the `Emitter` interface (`emit(ir): EmittedFile[]`) and register it in
  `cli/src/index.ts`.
- Adding a language feature that changes structure: update the core parser, the LSP context scanner,
  and — if it is a new syntax construct — the tree-sitter grammar and its queries.
- Status and development phases are described in the roadmap (kept outside the repository).

## License

MIT.
