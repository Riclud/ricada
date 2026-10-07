import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parse.ts";
import { ParseError } from "../src/errors.ts";
import type { Ast } from "../src/ast.ts";

const p = (src: string): Ast => parse(lex(src));

function stripLoc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLoc);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "loc") continue;
      out[k] = stripLoc(v);
    }
    return out;
  }
  return value;
}

const basicPath = fileURLToPath(
  new URL("../../../examples/basic.ricada", import.meta.url),
);

describe("parser v2", () => {
  test("parses an object type with annotations", () => {
    const ast = p("type T {\n  name: string @min(1) @max(100)\n}");
    const decl = ast.declarations[0] as any;
    expect(decl.kind).toBe("object");
    expect(decl.name).toBe("T");
    expect(decl.fields[0].name).toBe("name");
    expect(decl.fields[0].type).toEqual(
      expect.objectContaining({ name: "string", array: false, literal: false }),
    );
    expect(decl.fields[0].annotations.map((a: any) => a.name)).toEqual(["min", "max"]);
  });

  test("parses vertical (Style A) field annotations across lines", () => {
    const ast = p(
      'type T {\n  id: string\n    @uuid\n    @example(\n      "x"\n    )\n  name: string\n}',
    );
    const fields = (ast.declarations[0] as any).fields;
    expect(fields[0].annotations.map((a: any) => a.name)).toEqual(["uuid", "example"]);
    expect(fields[0].annotations[1].args[0].value.value).toBe("x");
    expect(fields[1].name).toBe("name");
    expect(fields[1].annotations).toEqual([]);
  });

  test("parses union aliases and literal types", () => {
    const ast = p('type Id = string | int\ntype Circle { kind: "circle" }');
    const alias = ast.declarations[0] as any;
    expect(alias.kind).toBe("alias");
    expect(alias.union.map((u: any) => u.name)).toEqual(["string", "int"]);
    const circle = ast.declarations[1] as any;
    expect(circle.fields[0].type).toEqual(
      expect.objectContaining({ name: "circle", literal: true }),
    );
  });

  test("parses enums and errors", () => {
    const ast = p(
      'enum Role { admin, user, guest }\nerror NotFound { message: string, code: string = "NOT_FOUND" }',
    );
    const e = ast.declarations[0] as any;
    expect(e).toEqual(expect.objectContaining({ kind: "enum", name: "Role", members: ["admin", "user", "guest"] }));
    const err = ast.declarations[1] as any;
    expect(err.kind).toBe("error");
    expect(err.fields[1].default).toEqual({ kind: "string", value: "NOT_FOUND" });
  });

  test("parses a route with blocks, returns, errors and handler", () => {
    const ast = p(
      '/api {\n  GET /users/:id {\n    @tag("Users")\n    params { id: string @uuid }\n    returns 200: User\n    returns 204\n    errors { 404: NotFound }\n    handler getUser\n  }\n}',
    );
    const group = ast.declarations[0] as any;
    expect(group.kind).toBe("group");
    expect(group.path).toBe("/api");
    const route = group.items[0];
    expect(route.kind).toBe("route");
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/users/:id");
    expect(route.params[0].in).toBe("params");
    expect(route.returns[0]).toEqual(
      expect.objectContaining({ status: 200, type: expect.objectContaining({ name: "User" }) }),
    );
    expect(route.returns[1]).toEqual(expect.objectContaining({ status: 204, type: null }));
    expect(route.errors[0]).toEqual(expect.objectContaining({ status: 404, type: "NotFound" }));
    expect(route.handler).toBe("getUser");
    expect(route.annotations.map((a: any) => a.name)).toEqual(["tag"]);
  });

  test("parses config with nested blocks, arrays and calls", () => {
    const ast = p(
      'config {\n  targets: [ts-client, docs]\n  auth { bearer { type: jwt, secret: env("X") } }\n}',
    );
    const cfg = ast.declarations[0] as any;
    expect(cfg.kind).toBe("config");
    expect(cfg.entries[0]).toEqual(
      expect.objectContaining({ key: "targets", value: { kind: "array", items: [{ kind: "word", value: "ts-client" }, { kind: "word", value: "docs" }] } }),
    );
    const auth = cfg.entries[1];
    expect(auth.key).toBe("auth");
    expect(auth.value.kind).toBe("object");
    const bearer = auth.value.entries[0];
    expect(bearer.key).toBe("bearer");
    const secret = bearer.value.entries.find((e: any) => e.key === "secret");
    expect(secret.value).toEqual({ kind: "call", name: "env", args: [{ kind: "string", value: "X" }] });
  });

  test("throws on an unknown HTTP method", () => {
    expect(() => p("/api {\n  FETCH /x { handler h }\n}")).toThrow(ParseError);
  });

  test("parses the reference example without errors", () => {
    const source = readFileSync(basicPath, "utf-8");
    expect(() => parse(lex(source))).not.toThrow();
  });

  test("reference example AST snapshot", () => {
    const source = readFileSync(basicPath, "utf-8");
    expect(stripLoc(parse(lex(source)))).toMatchSnapshot();
  });
});
