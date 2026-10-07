import { ParseError } from "./errors.ts";
import type {
  AliasNode,
  Annotation,
  AnnotationArg,
  Ast,
  ConfigEntry,
  ErrorNode,
  ErrorRef,
  FieldNode,
  GroupNode,
  ObjectTypeNode,
  ParamBlock,
  ReturnNode,
  RouteNode,
  TypeRef,
  Value,
} from "./ast.ts";
import { HTTP_METHODS } from "./ast.ts";
import type { Token, TokenType } from "./tokens.ts";

const PARAM_BLOCKS = new Set(["body", "params", "query", "headers"]);

export function parse(tokens: Token[]): Ast {
  let pos = 0;

  const peek = (n = 0): Token => tokens[pos + n] ?? tokens[tokens.length - 1]!;
  const at = (type: TokenType): boolean => peek().type === type;
  const atWord = (value: string): boolean =>
    peek().type === "WORD" && peek().value === value;

  const consume = (expected?: TokenType): Token => {
    const t = peek();
    if (expected !== undefined && t.type !== expected) {
      throw new ParseError(
        `expected ${expected}, got ${t.type}`,
        t.loc,
        (t.value ?? "").length || 1,
      );
    }
    pos++;
    return t;
  };

  const skipSeparators = (): void => {
    while (at("NEWLINE") || at("COMMA")) pos++;
  };

  // === Values (config / annotation arguments) ===

  function parseValue(): Value {
    const t = peek();
    if (t.type === "STRING") {
      consume();
      return { kind: "string", value: t.value ?? "" };
    }
    if (t.type === "NUMBER") {
      consume();
      return { kind: "number", value: t.value ?? "" };
    }
    if (t.type === "LBRACKET") {
      consume();
      const items: Value[] = [];
      while (!at("RBRACKET") && !at("EOF")) {
        skipSeparators();
        if (at("RBRACKET")) break;
        items.push(parseValue());
      }
      consume("RBRACKET");
      return { kind: "array", items };
    }
    if (t.type === "LBRACE") {
      consume();
      const entries = parseConfigEntries();
      consume("RBRACE");
      return { kind: "object", entries };
    }
    if (t.type === "WORD") {
      consume();
      let name = t.value ?? "";
      while (at("DOT")) {
        consume();
        name += "." + (consume("WORD").value ?? "");
      }
      if (at("LPAREN")) {
        consume();
        const args: Value[] = [];
        while (!at("RPAREN") && !at("EOF")) {
          skipSeparators();
          if (at("RPAREN")) break;
          args.push(parseArg().value);
        }
        consume("RPAREN");
        return { kind: "call", name, args };
      }
      return { kind: "word", value: name };
    }
    throw new ParseError("expected a value", t.loc, 1, "string, number, identifier, [...] or {...}");
  }

  function parseConfigEntries(): ConfigEntry[] {
    const entries: ConfigEntry[] = [];
    while (true) {
      skipSeparators();
      if (at("RBRACE") || at("EOF")) break;
      const keyTok = consume("WORD");
      const entry: ConfigEntry = { key: keyTok.value ?? "", value: { kind: "word", value: "" }, loc: keyTok.loc };
      if (at("COLON")) {
        consume();
        entry.value = parseValue();
      } else if (at("LBRACE")) {
        consume();
        const nested = parseConfigEntries();
        consume("RBRACE");
        entry.value = { kind: "object", entries: nested };
      } else {
        throw new ParseError(
          `expected ':' or '{' after config key \`${entry.key}\``,
          peek().loc,
          1,
        );
      }
      entries.push(entry);
    }
    return entries;
  }

  // === Annotations ===

  function parseArg(): AnnotationArg {
    if (at("WORD") && peek(1).type === "COLON") {
      const name = consume("WORD").value ?? "";
      consume("COLON");
      return { name, value: parseValue() };
    }
    return { name: null, value: parseValue() };
  }

  function parseAnnotation(): Annotation {
    const tok = consume("DECORATOR");
    const args: AnnotationArg[] = [];
    if (at("LPAREN")) {
      consume();
      while (!at("RPAREN") && !at("EOF")) {
        skipSeparators();
        if (at("RPAREN")) break;
        args.push(parseArg());
      }
      consume("RPAREN");
    }
    return { name: tok.value ?? "", args, loc: tok.loc };
  }

  // === Types and fields ===

  function parseTypeRef(): TypeRef {
    const t = peek();
    if (t.type === "STRING") {
      consume();
      const array = matchArraySuffix();
      return { name: t.value ?? "", array, literal: true, loc: t.loc };
    }
    const nameTok = consume("WORD");
    const array = matchArraySuffix();
    return { name: nameTok.value ?? "", array, literal: false, loc: nameTok.loc };
  }

  function matchArraySuffix(): boolean {
    if (at("LBRACKET") && peek(1).type === "RBRACKET") {
      consume();
      consume();
      return true;
    }
    return false;
  }

  function collectAnnotations(): Annotation[] {
    const annotations: Annotation[] = [];
    while (true) {
      if (at("DECORATOR")) {
        annotations.push(parseAnnotation());
        continue;
      }
      // Style A: annotations may continue on following lines.
      let i = pos;
      while (tokens[i]?.type === "NEWLINE" || tokens[i]?.type === "COMMA") i++;
      if (tokens[i]?.type === "DECORATOR") {
        pos = i;
        continue;
      }
      break;
    }
    return annotations;
  }

  function parseField(): FieldNode {
    const nameTok = consume("WORD");
    let optional = false;
    if (at("QUESTION")) {
      consume();
      optional = true;
    }
    consume("COLON");
    const type = parseTypeRef();
    if (at("QUESTION")) {
      consume();
      optional = true;
    }
    let def: Value | null = null;
    if (at("EQUALS")) {
      consume();
      def = parseValue();
    }
    const annotations = collectAnnotations();
    return { name: nameTok.value ?? "", optional, type, default: def, annotations, loc: nameTok.loc };
  }

  function parseFields(): FieldNode[] {
    const fields: FieldNode[] = [];
    while (true) {
      skipSeparators();
      if (at("RBRACE") || at("EOF")) break;
      fields.push(parseField());
    }
    return fields;
  }

  // === Routes ===

  function parseReturn(): ReturnNode {
    const loc = peek().loc;
    let status: number | null = null;
    let type: TypeRef | null = null;
    if (at("NUMBER") && peek(1).type === "COLON") {
      status = Number(consume().value);
      consume("COLON");
      type = parseTypeRef();
    } else if (at("NUMBER")) {
      status = Number(consume().value);
    } else {
      type = parseTypeRef();
    }
    return { status, type, loc };
  }

  function parseErrorRefs(): ErrorRef[] {
    consume("LBRACE");
    const refs: ErrorRef[] = [];
    while (!at("RBRACE") && !at("EOF")) {
      skipSeparators();
      if (at("RBRACE")) break;
      const statusTok = consume("NUMBER");
      consume("COLON");
      const typeTok = consume("WORD");
      refs.push({ status: Number(statusTok.value), type: typeTok.value ?? "", loc: statusTok.loc });
    }
    consume("RBRACE");
    return refs;
  }

  function parseRoute(): RouteNode {
    const methodTok = consume("WORD");
    const method = (methodTok.value ?? "").toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      throw new ParseError(
        `unknown HTTP method \`${methodTok.value}\``,
        methodTok.loc,
        (methodTok.value ?? "").length || 1,
        `allowed: ${[...HTTP_METHODS].join(", ")}`,
      );
    }
    const pathTok = consume("PATH");
    consume("LBRACE");

    const annotations: Annotation[] = [];
    const params: ParamBlock[] = [];
    const returns: ReturnNode[] = [];
    const errors: ErrorRef[] = [];
    let handler: string | null = null;

    while (true) {
      skipSeparators();
      if (at("RBRACE") || at("EOF")) break;

      if (at("DECORATOR")) {
        annotations.push(parseAnnotation());
        continue;
      }

      if (at("WORD")) {
        const kw = peek().value ?? "";
        if (PARAM_BLOCKS.has(kw)) {
          const kwTok = consume();
          consume("LBRACE");
          const fields = parseFields();
          consume("RBRACE");
          params.push({ in: kw, fields, loc: kwTok.loc });
          continue;
        }
        if (kw === "returns") {
          consume();
          returns.push(parseReturn());
          continue;
        }
        if (kw === "errors") {
          consume();
          errors.push(...parseErrorRefs());
          continue;
        }
        if (kw === "handler") {
          consume();
          handler = consume("WORD").value ?? "";
          continue;
        }
      }

      throw new ParseError(
        `unexpected token in route body`,
        peek().loc,
        1,
        "expected body/params/query/headers, returns, errors, handler or an annotation",
      );
    }
    consume("RBRACE");

    return {
      kind: "route",
      method,
      path: pathTok.value ?? "",
      annotations,
      params,
      returns,
      errors,
      handler,
      loc: methodTok.loc,
    };
  }

  function parseGroup(): GroupNode {
    const pathTok = consume("PATH");
    consume("LBRACE");
    const items: Array<RouteNode | GroupNode> = [];
    while (true) {
      skipSeparators();
      if (at("RBRACE") || at("EOF")) break;
      if (at("PATH")) {
        items.push(parseGroup());
        continue;
      }
      if (at("WORD") && HTTP_METHODS.has((peek().value ?? "").toUpperCase())) {
        items.push(parseRoute());
        continue;
      }
      throw new ParseError(
        "expected a route or a nested group",
        peek().loc,
        1,
      );
    }
    consume("RBRACE");
    return { kind: "group", path: pathTok.value ?? "", items, loc: pathTok.loc };
  }

  // === Declarations ===

  function parseTypeDecl(): ObjectTypeNode | AliasNode {
    const keywordTok = consume("WORD"); // `type`
    const nameTok = consume("WORD");
    const name = nameTok.value ?? "";
    if (at("EQUALS")) {
      consume();
      const union: TypeRef[] = [parseTypeRef()];
      while (at("PIPE")) {
        consume();
        union.push(parseTypeRef());
      }
      return { kind: "alias", name, union, loc: keywordTok.loc };
    }
    consume("LBRACE");
    const fields = parseFields();
    consume("RBRACE");
    return { kind: "object", name, fields, loc: keywordTok.loc };
  }

  function parseEnum(): { name: string; members: string[]; loc: Token["loc"] } {
    const keywordTok = consume("WORD"); // `enum`
    const name = consume("WORD").value ?? "";
    consume("LBRACE");
    const members: string[] = [];
    while (!at("RBRACE") && !at("EOF")) {
      skipSeparators();
      if (at("RBRACE")) break;
      members.push(consume("WORD").value ?? "");
    }
    consume("RBRACE");
    return { name, members, loc: keywordTok.loc };
  }

  function parseErrorDecl(): ErrorNode {
    const keywordTok = consume("WORD"); // `error`
    const name = consume("WORD").value ?? "";
    consume("LBRACE");
    const fields = parseFields();
    consume("RBRACE");
    return { kind: "error", name, fields, loc: keywordTok.loc };
  }

  function parseImport(): { source: string; loc: Token["loc"] } {
    consume("WORD"); // `import`
    const src = consume("STRING");
    return { source: src.value ?? "", loc: src.loc };
  }

  function parseConfig(): ConfigEntry[] {
    consume("WORD"); // `config`
    consume("LBRACE");
    const entries = parseConfigEntries();
    consume("RBRACE");
    return entries;
  }

  // === Entry point ===

  const declarations: Ast["declarations"] = [];
  while (true) {
    skipSeparators();
    if (at("EOF")) break;

    if (at("WORD")) {
      const kw = peek().value ?? "";
      if (kw === "import") {
        const { source, loc } = parseImport();
        declarations.push({ kind: "import", source, loc });
        continue;
      }
      if (kw === "config") {
        const keywordTok = peek();
        const entries = parseConfig();
        declarations.push({ kind: "config", entries, loc: keywordTok.loc });
        continue;
      }
      if (kw === "type") {
        declarations.push(parseTypeDecl());
        continue;
      }
      if (kw === "enum") {
        const { name, members, loc } = parseEnum();
        declarations.push({ kind: "enum", name, members, loc });
        continue;
      }
      if (kw === "error") {
        declarations.push(parseErrorDecl());
        continue;
      }
      throw new ParseError(
        `unexpected keyword \`${kw}\``,
        peek().loc,
        kw.length,
        "expected import, config, type, enum, error or a route group",
      );
    }

    if (at("PATH")) {
      declarations.push(parseGroup());
      continue;
    }

    throw new ParseError("unexpected token", peek().loc, 1);
  }

  return { declarations };
}
