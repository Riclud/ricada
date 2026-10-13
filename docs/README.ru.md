<p align="center">
  <a href="../README.md">English</a> ·
  <strong>Русский</strong>
</p>

# Ricada (README · RU)

**API-компилятор и API-edge.** Один человекочитаемый контракт `.ricada` — единственный источник
правды для валидации запросов/ответов, backend-хендлеров, фронтенд-клиентов, OpenAPI, документации
и gateway-политик (auth, rate limiting, CORS, security).

Из одного файла генерируются:

- валидация запроса и ответа (компилятор → IR → валидаторы);
- интерфейсы backend-хендлеров (`Handlers` / `defineHandlers`);
- типизированный фронтенд-клиент;
- OpenAPI 3.1 и документация;
- исполняемые gateway-политики: auth (JWT/apiKey), rate limiting, CORS, security-заголовки.

Плюс язык-server для редакторов (диагностика, контекстный автокомплит, hover, go-to-definition)
и tree-sitter грамматика для подсветки.

## Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Справочник языка](#справочник-языка)
   - [Файлы и синтаксис](#файлы-и-синтаксис)
   - [Типы](#типы)
   - [Ошибки](#ошибки)
   - [Конфиг](#конфиг)
   - [Роуты](#роуты)
   - [Справочник аннотаций](#справочник-аннотаций)
3. [CLI](#cli)
4. [Генерация и эмиттеры](#генерация-и-эмиттеры)
5. [Рантайм](#рантайм)
6. [LSP и редакторы](#lsp-и-редакторы)
7. [Примеры](#примеры)
8. [Команды](#команды)
9. [Структура](#структура)
10. [Разработка](#разработка)

## Быстрый старт

```bash
bun install
bun run dev        # скомпилировать examples/basic.ricada и напечатать IR
bun run check      # проверить контракт
bun run gen        # сгенерировать ts-server/ts-client/openapi в ./generated
bun run mock       # поднять мок-сервер на :3000
bun run lsp        # запустить language server (stdio)
```

## Справочник языка

### Файлы и синтаксис

- Файлы используют расширение `.ricada` (алиас `.rd`).
- **Структуру задают `{}`; отступы косметика.** Внутри блока элементы разделяются переносом строки
  или запятой.
- Комментарии: `// таком стилем` и `# таким тоже`.
- Строки: `"двойные"` и `'одинарные'`, эскейпы `\n \t \r \\ \" \'`.
- Идентификаторы могут содержать буквы, цифры, `_`, `-` и `.` (поэтому `jwt.sub`, `x-request-id`,
  `ts-client` — единые идентификаторы).
- Модули: `import "./common.ricada"` — импортированные декларации вливаются до импортера, общие
  модули дедуплицируются, циклы детектируются.
- Блок `config {}` — настройки компиляции и gateway (см. [Конфиг](#конфиг)).

### Типы

Примитивы (кросс-язычные):

| Тип        | Назначение                     |
| ---------- | ------------------------------ |
| `string`   | UTF-8 строка                   |
| `int`      | целое число                    |
| `float`    | число с плавающей точкой       |
| `bool`     | булево значение                |
| `uuid`     | строка UUID (валидируется)     |
| `datetime` | строка ISO-8601 (валидируется) |

Объекты, enum, массивы, optional, дефолты:

```ricada
enum Role { admin, user, guest }

type Address {
  city: string @min(1)
  zip: string @regex("^[0-9]{5}$")
  country: string = "US"        // дефолт
}

type User {
  id: string @uuid
  name: string @min(1) @max(100)
  age: int?                       // optional
  tags: string[]                  // массив
  address: Address?               // вложенный optional
  role: Role = user               // дефолт enum
  active: bool = true
}
```

Union, литералы и `null`:

```ricada
type Id = string | int
type MaybeAddress = Address | null

type Circle { kind: "circle", radius: float @min(0) }
type Square { kind: "square", side: float @min(0) }

// union объектов с общим literal-полем становится *discriminated union*
type Shape = Circle | Square
```

Модификаторы полей:

| Модификатор | Пример              | Назначение                                                |
| ----------- | ------------------- | --------------------------------------------------------- |
| `?`         | `age: int?`         | optional (может отсутствовать)                            |
| `[]`        | `tags: string[]`    | массив значений типа                                      |
| `= x`       | `role: Role = user` | значение по умолчанию (поле становится optional на входе) |

### Ошибки

`error` — first-class тип и может упоминаться из роутов:

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

Базовый набор: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`,
`TooManyRequests`. Рантайм собирает тело ошибки из объявленных типов (заполняя `message`, дефолты
`code` и дополнительные поля вроде `retryAfter`), так что wire-формат совпадает с контрактом.

### Конфиг

```ricada
config {
  targets: [ts-server, ts-client, ts-elysia, ts-nestjs, openapi, docs]
  out: "./generated"
  wire: json
}
```

| Ключ      | Тип        | Назначение                                  |
| --------- | ---------- | ------------------------------------------- |
| `targets` | `[string]` | какие эмиттеры запускать на `gen`           |
| `out`     | `string`   | каталог вывода (по умолчанию `./generated`) |
| `wire`    | `json`     | wire-формат                                 |

**Auth-схемы** — проверяются нативно рантаймом:

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

| Поле                  | Применимо к | Тип                 |
| --------------------- | ----------- | ------------------- |
| `type`                | jwt, apiKey | `jwt` / `apiKey`    |
| `secret`              | jwt         | `env("…")`          |
| `algorithm`           | jwt         | `HS256`             |
| `issuer` / `audience` | jwt         | `string`            |
| `name`                | apiKey      | имя заголовка       |
| `in`                  | apiKey      | `header`            |
| `key`                 | apiKey      | секрет (`env("…")`) |

**CORS** и **security-заголовки**:

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

| Ключ секции                              | Опции                                        |
| ---------------------------------------- | -------------------------------------------- |
| `cors.origins` / `.methods` / `.headers` | массивы строк                                |
| `cors.credentials`                       | `true` / `false`                             |
| `cors.maxAge`                            | строка длительности (`"1h"`)                 |
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

| Ключ             | Тип                                                         |
| ---------------- | ----------------------------------------------------------- |
| `algorithm`      | `tokenBucket`                                               |
| `store`          | `memory` (redis планируется)                                |
| `default.limit`  | `int` — скорость пополнения за окно                         |
| `default.window` | строка (`"30s"`, `"1m"`, `"1h"`, `"1d"`)                    |
| `default.key`    | `ip` / `route` / `jwt.sub` / `param:<name>` / `header("X")` |
| `default.burst`  | `int` — вместимость ведра                                   |

**Control plane** (бэкенд → состояние gateway):

```ricada
config {
  control { secret: env("RICADA_CONTROL_SECRET"), allow: [rateLimit, deny, cache, metrics, breaker] }
}
```

### Роуты

Роуты находятся внутри групп:

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

Части роута:

| Часть            | Форма                                                     | Назначение                        |
| ---------------- | --------------------------------------------------------- | --------------------------------- |
| Метод            | `GET POST PUT PATCH DELETE OPTIONS HEAD`                  | HTTP-метод                        |
| Путь             | `/users/:id`                                              | `:name` — параметры пути          |
| Блоки параметров | `body {}` `params {}` `query {}` `headers {}`             | локации входа, каждая из полей    |
| `returns`        | `200: Type` / `204` / `Type`                              | статус успеха + тип (опционально) |
| `errors`         | `{ 401: Unauthorized, ... }`                              | объявленные ошибки по статусам    |
| `handler`        | `listUsers`                                               | функция бэкенда для реализации    |
| Аннотации        | `@auth(...) @rateLimit(...) @cache(...) @deprecated(...)` | см. ниже                          |

### Справочник аннотаций

**Аннотации полей/типов** (влияют на валидацию, OpenAPI и mock-значения):

| Аннотация           | Аргумент | Тип      | Эффект                                             |
| ------------------- | -------- | -------- | -------------------------------------------------- |
| `@min(n)`           | `n`      | `int`    | минимум для числа; для строк — минимальная длина   |
| `@max(n)`           | `n`      | `int`    | максимум для числа; для строк — максимальная длина |
| `@email`            | —        | —        | проверяет email-формат                             |
| `@regex("…")`       | паттерн  | `string` | проверяет по регулярке                             |
| `@uuid`             | —        | —        | проверяет UUID-формат                              |
| `@sensitive`        | —        | —        | `writeOnly` в OpenAPI                              |
| `@example(v)`       | значение | любой    | используется документацией и mock-сервером         |
| `@description("…")` | текст    | `string` | doc-комментарий в сгенерированных типах            |

**Аннотации роутов**:

| Аннотация                               | Аргумент                    | Тип                       | Эффект                                      |
| --------------------------------------- | --------------------------- | ------------------------- | ------------------------------------------- |
| `@tag("…")`                             | тег                         | `string` (или `string[]`) | группировка в OpenAPI/доках                 |
| `@summary("…")`                         | текст                       | `string`                  | краткое описание                            |
| `@description("…")`                     | текст                       | `string`                  | подробное описание                          |
| `@auth(scheme, …)`                      | схема                       | `string`                  | auth рантайма (JWT/apiKey)                  |
| `@auth(public: true)`                   | —                           | `boolean`                 | отключает auth для роута                    |
| `@auth(scopes: […], roles: […])`        | массивы                     | `string[]`                | scopes (AND) + roles (OR) по claims         |
| `@rateLimit(limit, window, key, burst)` |                             | см. таблицу               | per-route token bucket (перекрывает конфиг) |
| `@cache(ttl, key)`                      | `ttl` `int`, `key` `string` |                           | парсится (исполнение планируется)           |
| `@deprecated(reason: "…")`              | текст                       | `string`                  | помечает роут устаревшим                    |

Аргументы `@rateLimit` (все опциональны — фолбэк на `config.rateLimit.default`):

| Аргумент | Тип      | Назначение                                                  |
| -------- | -------- | ----------------------------------------------------------- |
| `limit`  | `int`    | пополнение за окно                                          |
| `window` | `string` | `"30s"`, `"1m"`, `"1h"`, `"1d"`                             |
| `key`    | `string` | `ip` / `route` / `jwt.sub` / `param:<name>` / `header("X")` |
| `burst`  | `int`    | вместимость ведра                                           |

## CLI

`bun run <script>` — все скрипты запускают `@ricada/cli`:

| Команда                                                  | Описание                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `bun run check <file>`                                   | проверить контракт и вывести результат                                                          |
| `bun run check <file> --impl backend.ts`                 | статическая конформность: сгенерировать контракт и прогонить бэкенд через tsc против `Handlers` |
| `bun run status <file> --impl backend.ts`                | то же, что `check --impl`                                                                       |
| `bun run gen <file>`                                     | запустить все эмиттеры из `config.targets` в `config.out`                                       |
| `bun run mock <file> --port 3000`                        | отдавать примеры ответов для каждого роута                                                      |
| `bun run test:api <file> --target http://localhost:3000` | обойти все роуты и сверить статус/тело с контрактом                                             |

Если файл не указан, CLI ищет `api.ricada`, `main.ricada`, `ricada.ricada`, `ricada.rd`, `api.rd`,
затем любой `.ricada`/`.rd` файл в рабочем каталоге.

## Генерация и эмиттеры

Эмиттер — функция `emit(ir): EmittedFile[]`. Существующие targets:

| Target      | Вывод                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `ts-server` | `ts-server/types.ts`, `ts-server/contract.ts` — стабы `Handlers`/`defineHandlers` и `RouteName`       |
| `ts-client` | `ts-client/{types,validators,client,index}.ts` — типизированный fetch-клиент с dev-валидацией ответов |
| `openapi`   | `openapi.json` — OpenAPI 3.1 (parameters, requestBody, responses, discriminator)                      |

Планируемые targets (объявлены в референсном контракте, но ещё не реализованы): `ts-elysia`,
`ts-nestjs`, `docs`, `asyncapi`.

## Рантайм

`@ricada/runtime` исполняет контракт. `createHandler(ir, handlers)` возвращает
`(req: Request) => Promise<Response>` и работает с `Bun.serve` или любым fetch-адаптером:

```ts
import { createHandler, HttpError } from "@ricada/runtime"
import { compile } from "@ricada/core"

const ir = compile(`...`) // или из файла с { baseDir }

const app = createHandler(ir, {
  async getUser(input) {
    if (input.params.id !== "known") throw new HttpError(404, undefined)
    return { id: input.params.id, name: "Jane" }
  },
})
```

Контракт хендлеров совпадает со сгенерированными `Handlers` — `input` это
`{ params, query, headers, body, identity }`, а брошенный `HttpError(status, body)` (или любой объект
с `status`/`body`) превращается в объявленный error-ответ для этого статуса.

Для каждого запроса рантайм:

1. **валидирует вход** (query/params/headers/body, включая констрейнты аннотаций и дефолты);
2. **аутентифицирует** по `@auth(...)`, используя схемы из `config.auth` — JWT HS256 или apiKey,
   `scopes` (все обязательны) и `roles` (любая), и отдаёт в `input.identity`;
3. **лимитирует по rate-limit** согласно `@rateLimit(...)`/конфигу (token bucket),
   выставляя `X-RateLimit-Limit`/`X-RateLimit-Remaining`, `Retry-After` и `429`;
4. **валидирует вывод хендлера** против объявленных `returns`;
5. выставляет **CORS** и **security-заголовки** из конфига (включая `OPTIONS` preflight);
6. отвечает, собирая тела ошибок из объявленных `error`-типов.

Экспортируемые хелперы: `buildTypeMap`, `typeReason`, `fieldsReason`, `validateRequestInput`,
`matchOutput`, `MemoryStore`, `HttpError`.

## LSP и редакторы

`@ricada/lsp` — Language Server поверх stdio (запуск: `bun run lsp`):

- **диагностика** — ошибки парсера/резолвера/импортов с диапазонами;
- **контекстный автокомплит** — список зависит от позиции: ключевые слова деклараций на верхнем
  уровне, `body/params/query/headers/returns/errors/handler` в роутах, типы после `:`, и **аннотации,
  отфильтрованные по типу поля** (`string @` — только строковые аннотации, `int @` — только
  `@min/@max`, в роуте `@` — route-аннотации);
- **hover** — информация о типе и полях;
- **go-to-definition** — переход к объявлению типа.

**Zed** — `editors/ricada-zed` содержит tree-sitter грамматику (подсветка, скобки, outline, отступы)
и адаптер LSP. Подключается как dev-расширение из `editors/ricada-zed`.

Для других редакторов тот же LSP-бинарник; нужен только тонкий клиент (регистрация языка + грамматика).

## Примеры

Референсный контракт — `examples/basic.ricada` (пользователи, сессии, discriminated unions, admin-
роуты). Сопутствующие файлы:

- `examples/run.ts` — скомпилировать контракт и напечатать IR;
- `examples/backend.ts` — полная реализация `Handlers` (сначала `bun run gen`);
- `examples/client.ts` — использование сгенерированного клиента (сначала `bun run gen`).

## Команды

| Команда                                    | Описание                                               |
| ------------------------------------------ | ------------------------------------------------------ |
| `bun run dev` / `start`                    | скомпилировать `examples/basic.ricada` и напечатать IR |
| `bun run check`                            | проверить контракт                                     |
| `bun run gen`                              | сгенерировать по `config.targets` в `./generated`      |
| `bun run mock`                             | мок-сервер на :3000                                    |
| `bun run test:api -- --target <url>`       | прогнать контракт против таргета                       |
| `bun run lsp`                              | language server (stdio)                                |
| `bun test`                                 | тесты                                                  |
| `bun run typecheck` / `lint` / `fmt:check` | статические проверки                                   |

## Структура

```
packages/
  core/              # @ricada/core — лексер, парсер, резолвер, IR, загрузчик модулей, ошибки
  cli/               # @ricada/cli — check | status | gen | mock | test
  emitter-openapi/   # OpenAPI 3.1
  emitter-ts-client/ # типизированный fetch-клиент + валидаторы
  emitter-ts-common/ # шаред-кодоген
  emitter-ts-server/ # стабы Handlers
  runtime/           # createHandler, auth, rate-limit, cors/security, валидаторы
  lsp/               # language server
editors/
  tree-sitter-ricada/ # tree-sitter грамматика
  ricada-zed/        # Zed-расширение (подсветка + адаптер LSP)
examples/
  basic.ricada       # референсный контракт
  backend.ts         # пример реализации Handlers
  client.ts          # пример использования сгенерированного клиента
```

## Разработка

- Монорепо на Bun workspaces: новый пакет — папка в `packages/` + зависимость в корневом
  `package.json`.
- Код — строгий TypeScript (`tsconfig.base.json`); enforced: `typecheck`, `eslint`, `prettier`.
- Тесты: `bun test` (снапшоты перегенерируются через `bun test --update-snapshots`).
- Новый эмиттер: реализовать интерфейс `Emitter` (`emit(ir): EmittedFile[]`) и зарегистрировать
  в `cli/src/index.ts`.
- Новая языковая фича, меняющая структуру: обновить core-парсер, контекстный сканер LSP и — если
  это новая синтаксическая конструкция — tree-sitter грамматику и её queries.
- Статус и фазы развития описаны в roadmap (хранится вне репозитория).

## Лицензия

MIT.
