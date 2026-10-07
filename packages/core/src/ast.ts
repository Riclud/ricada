import type { Location } from "./tokens.ts";

export interface AnnotationArg {
  name: string | null;
  value: Value;
}

export interface Annotation {
  name: string;
  args: AnnotationArg[];
  loc: Location;
}

export type Value =
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "word"; value: string }
  | { kind: "array"; items: Value[] }
  | { kind: "object"; entries: ConfigEntry[] }
  | { kind: "call"; name: string; args: Value[] };

export interface ConfigEntry {
  key: string;
  value: Value;
  loc: Location;
}

export interface TypeRef {
  name: string;
  array: boolean;
  literal: boolean;
  loc: Location;
}

export interface FieldNode {
  name: string;
  optional: boolean;
  type: TypeRef;
  default: Value | null;
  annotations: Annotation[];
  loc: Location;
}

export interface ObjectTypeNode {
  kind: "object";
  name: string;
  fields: FieldNode[];
  loc: Location;
}

export interface EnumNode {
  kind: "enum";
  name: string;
  members: string[];
  loc: Location;
}

export interface AliasNode {
  kind: "alias";
  name: string;
  union: TypeRef[];
  loc: Location;
}

export interface ErrorNode {
  kind: "error";
  name: string;
  fields: FieldNode[];
  loc: Location;
}

export type TypeDecl = ObjectTypeNode | EnumNode | AliasNode | ErrorNode;

export interface ParamBlock {
  in: string;
  fields: FieldNode[];
  loc: Location;
}

export interface ReturnNode {
  status: number | null;
  type: TypeRef | null;
  loc: Location;
}

export interface ErrorRef {
  status: number;
  type: string;
  loc: Location;
}

export interface RouteNode {
  kind: "route";
  method: string;
  path: string;
  annotations: Annotation[];
  params: ParamBlock[];
  returns: ReturnNode[];
  errors: ErrorRef[];
  handler: string | null;
  loc: Location;
}

export interface GroupNode {
  kind: "group";
  path: string;
  items: Array<RouteNode | GroupNode>;
  loc: Location;
}

export interface ImportNode {
  kind: "import";
  source: string;
  loc: Location;
}

export interface ConfigNode {
  kind: "config";
  entries: ConfigEntry[];
  loc: Location;
}

export type Declaration = ImportNode | ConfigNode | TypeDecl | GroupNode;

export interface Ast {
  declarations: Declaration[];
}

export const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "TRACE",
  "CONNECT",
]);
