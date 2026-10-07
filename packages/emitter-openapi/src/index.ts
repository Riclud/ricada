import type {
  EmittedFile,
  Ir,
  IrAnnotation,
  IrField,
  IrRoute,
  IrType,
  IrTypeRef,
} from "@ricada/core";

type Json = Record<string, unknown>;

const PRIMITIVE_SCHEMA: Record<string, Json> = {
  string: { type: "string" },
  int: { type: "integer" },
  float: { type: "number" },
  bool: { type: "boolean" },
  uuid: { type: "string", format: "uuid" },
  datetime: { type: "string", format: "date-time" },
};

function annotationString(ann: IrAnnotation | undefined, index = 0): string | null {
  const arg = ann?.args[index];
  if (!arg) return null;
  const v = arg.value;
  if (v.kind === "string" || v.kind === "word" || v.kind === "number") return v.value;
  return null;
}

function annotationStringArray(ann: IrAnnotation | undefined): string[] {
  const arg = ann?.args[0];
  if (!arg) return [];
  if (arg.value.kind === "string") return [arg.value.value];
  if (arg.value.kind === "array") {
    return arg.value.items
      .filter((i) => i.kind === "string" || i.kind === "word")
      .map((i) => (i as { value: string }).value);
  }
  return [];
}

export function typeRefSchema(ref: IrTypeRef): Json {
  let schema: Json;
  switch (ref.kind) {
    case "primitive":
      schema = { ...(PRIMITIVE_SCHEMA[ref.name] ?? { type: "string" }) };
      break;
    case "literal":
      schema = { const: ref.name };
      break;
    case "null":
      schema = { type: "null" };
      break;
    case "named":
      schema = { $ref: `#/components/schemas/${ref.name}` };
      break;
  }
  if (ref.array) schema = { type: "array", items: schema };
  return schema;
}

export function fieldSchema(field: IrField): Json {
  const schema = typeRefSchema(field.type);
  if (field.default) {
    const d = field.default;
    if (d.kind === "string" || d.kind === "word" || d.kind === "number") {
      schema.default = d.kind === "number" ? Number(d.value) : d.value;
    }
  }

  for (const ann of field.annotations) {
    switch (ann.name) {
      case "min": {
        const v = annotationString(ann);
        const n = v !== null ? Number(v) : undefined;
        if (n === undefined || Number.isNaN(n)) break;
        if (field.type.kind === "primitive" && (field.type.name === "int" || field.type.name === "float")) {
          schema.minimum = n;
        } else {
          schema.minLength = n;
        }
        break;
      }
      case "max": {
        const v = annotationString(ann);
        const n = v !== null ? Number(v) : undefined;
        if (n === undefined || Number.isNaN(n)) break;
        if (field.type.kind === "primitive" && (field.type.name === "int" || field.type.name === "float")) {
          schema.maximum = n;
        } else {
          schema.maxLength = n;
        }
        break;
      }
      case "email":
        schema.format = "email";
        break;
      case "regex":
        schema.pattern = annotationString(ann) ?? undefined;
        break;
      case "example":
        schema.example = annotationString(ann) ?? undefined;
        break;
      case "description":
        schema.description = annotationString(ann) ?? undefined;
        break;
      case "sensitive":
        schema.writeOnly = true;
        break;
    }
  }

  return schema;
}

function objectSchema(fields: IrField[]): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = fieldSchema(f);
    if (!f.optional) required.push(f.name);
  }
  const schema: Json = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function typeSchema(type: IrType): Json {
  if (type.kind === "object") return objectSchema(type.fields);
  if (type.kind === "enum") return { type: "string", enum: type.members };
  // alias / union
  const oneOf = type.union.map(typeRefSchema);
  const schema: Json = { oneOf };
  if (type.discriminated && type.tag) {
    schema.discriminator = {
      propertyName: type.tag,
      mapping: Object.fromEntries(
        type.union
          .filter((r) => r.kind === "named")
          .map((r) => [r.name, `#/components/schemas/${r.name}`]),
      ),
    };
  }
  return schema;
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parameters(route: IrRoute): Json[] {
  const out: Json[] = [];
  for (const block of route.params) {
    for (const field of block.fields) {
      const schema = fieldSchema(field);
      if (block.in === "body") continue;
      const location = block.in === "params" ? "path" : block.in === "query" ? "query" : "header";
      out.push({
        name: field.name,
        in: location,
        required: block.in === "params" ? true : !field.optional,
        schema,
      });
    }
  }
  return out;
}

function requestBody(route: IrRoute): Json | null {
  const body = route.params.find((p) => p.in === "body");
  if (!body) return null;
  return {
    required: true,
    content: { "application/json": { schema: objectSchema(body.fields) } },
  };
}

function responses(ir: Ir, route: IrRoute): Json {
  const out: Json = {};
  for (const ret of route.returns) {
    const key = ret.status === null ? "default" : String(ret.status);
    const response: Json = { description: "" };
    if (ret.type) {
      response.content = { "application/json": { schema: typeRefSchema(ret.type) } };
    }
    out[key] = response;
  }
  for (const err of route.errors) {
    out[String(err.status)] = {
      description: err.type,
      content: {
        "application/json": { schema: { $ref: `#/components/schemas/${err.type}` } },
      },
    };
  }
  if (Object.keys(out).length === 0) out["200"] = { description: "" };
  return out;
}

export function buildOpenApi(ir: Ir): Json {
  const schemas: Json = {};
  for (const type of ir.types) schemas[type.name] = typeSchema(type);
  for (const error of ir.errors) schemas[error.name] = objectSchema(error.fields);

  const paths: Json = {};
  for (const r of ir.routes) {
    const path = toOpenApiPath(r.path);
    const item = (paths[path] ??= {}) as Json;
    const operation: Json = { responses: responses(ir, r) };

    const tag = r.annotations.find((a) => a.name === "tag");
    const summary = r.annotations.find((a) => a.name === "summary");
    const description = r.annotations.find((a) => a.name === "description");
    const deprecated = r.annotations.find((a) => a.name === "deprecated");
    const tags = annotationStringArray(tag);
    if (tags.length > 0) operation.tags = tags;
    const s = annotationString(summary);
    if (s) operation.summary = s;
    const d = annotationString(description);
    if (d) operation.description = d;
    if (deprecated) operation.deprecated = true;

    const params = parameters(r);
    if (params.length > 0) operation.parameters = params;
    const rb = requestBody(r);
    if (rb) operation.requestBody = rb;

    item[r.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: { title: "Ricada API", version: "0.0.0" },
    paths,
    components: { schemas },
  };
}

export function emitOpenApi(ir: Ir): EmittedFile[] {
  return [{ path: "openapi.json", contents: JSON.stringify(buildOpenApi(ir), null, 2) }];
}
