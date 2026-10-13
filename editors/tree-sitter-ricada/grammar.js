// tree-sitter grammar for the Ricada API contract language.
//
// The language is brace-delimited; indentation is cosmetic. Fields and
// statements are separated by newlines or commas. Comments use // and #.
// See grammar notes in docs.

module.exports = grammar({
  name: "ricada",

  extras: ($) => [/[ \t\r]+/, $.comment],

  word: $ => $.identifier,

  conflicts: ($) => [],

  rules: {
    source_file: ($) => list($, $.statement),

    sep: ($) => choice("\n", ","),

    // ---- top-level statements ----

    statement: ($) =>
      choice(
        $.import_statement,
        $.config_block,
        $.type_declaration,
        $.enum_declaration,
        $.error_declaration,
        $.route_group,
        $.annotation,
        $.comment,
      ),

    import_statement: ($) => seq("import", field("source", $.string)),

    config_block: ($) =>
      seq("config", "{", list($, $.config_entry), "}"),

    config_entry: ($) =>
      seq(
        field("key", $.identifier),
        choice(
          seq(":", field("value", $.value)),
          seq("{", list($, $.config_entry), "}"),
        ),
      ),

    type_declaration: ($) =>
      choice(
        seq(
          "type",
          field("name", $.identifier),
          "{",
          list($, choice($.field, $.annotation)),
          "}",
        ),
        seq("type", field("name", $.identifier), "=", field("type", $.union_type)),
      ),

    enum_declaration: ($) =>
      seq("enum", field("name", $.identifier), "{", list($, $.identifier), "}"),

    error_declaration: ($) =>
      seq(
        "error",
        field("name", $.identifier),
        "{",
        list($, choice($.field, $.annotation)),
        "}",
      ),

    // ---- routes ----

    route_group: ($) =>
      seq(
        field("path", $.path),
        "{",
        list($, choice($.route, $.route_group, $.annotation)),
        "}",
      ),

    route: ($) =>
      seq(
        field("method", $.method),
        field("path", $.path),
        "{",
        list($, choice($.route_body_item, $.annotation)),
        "}",
      ),

    route_body_item: ($) =>
      choice(
        $.param_block,
        $.returns_statement,
        $.errors_statement,
        $.handler_statement,
      ),

    param_block: ($) =>
      seq(
        field("kind", $.param_kind),
        "{",
        list($, choice($.field, $.annotation)),
        "}",
      ),

    param_kind: ($) => choice("body", "params", "query", "headers"),

    returns_statement: ($) =>
      seq(
        "returns",
        field(
          "value",
          choice(
            seq($.number, ":", $.type_ref),
            $.number,
            $.type_ref,
          ),
        ),
      ),

    errors_statement: ($) => seq("errors", "{", list($, $.error_ref), "}"),

    error_ref: ($) => seq($.number, ":", $.type_name),

    handler_statement: ($) => seq("handler", field("name", $.identifier)),

    method: ($) =>
      choice(
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "HEAD",
        "TRACE",
        "CONNECT",
      ),

    // ---- fields and types ----

    field: ($) =>
      seq(
        field("name", $.identifier),
        optional("?"),
        ":",
        field("type", $.type_ref),
        optional(seq("=", field("default", $.value))),
        repeat($.annotation),
      ),

    type_ref: ($) =>
      seq(
        field("type", $.type_name),
        optional(seq("[", "]")),
        optional("?"),
      ),

    type_name: ($) => choice($.identifier, $.string, "null"),

    union_type: ($) =>
      seq(
        field("left", $.type_ref),
        repeat1(seq("|", field("right", $.type_ref))),
      ),

    // ---- values ----

    annotation: ($) =>
      seq(
        field("name", $.decorator),
        optional(seq("(", list($, $.arg), ")")),
      ),

    arg: ($) =>
      choice(
        seq(field("name", $.identifier), ":", field("value", $.value)),
        field("value", $.value),
      ),

    value: ($) =>
      choice(
        $.string,
        $.number,
        $.identifier,
        $.array,
        $.call,
        $.object,
      ),

    object: ($) => seq("{", list($, $.config_entry), "}"),

    array: ($) => seq("[", list($, $.array_item), "]"),

    array_item: ($) =>
      choice($.string, $.number, $.identifier, $.array, $.call, $.object),

    call: ($) =>
      seq(field("name", $.identifier), "(", list($, $.arg), ")"),

    // ---- tokens ----

    identifier: ($) => /[\p{L}_][\p{L}\p{N}_.-]*/,

    number: ($) => /\d+(\.\d+)?/,

    string: ($) =>
      choice(
        seq(
          '"',
          repeat(choice(/[^"\\\n]/, $.escape_sequence)),
          '"',
        ),
        seq("'", repeat(choice(/[^'\\\n]/, $.escape_sequence)), "'"),
      ),

    escape_sequence: ($) => token.immediate(/\\[^\n]/),

    decorator: ($) => /@[\p{L}\p{N}_.-]+/,

    path: ($) => /\/[^ \t\r\n{}()\[\],#]+/,

    comment: ($) =>
      token(
        prec(1, choice(seq("//", /[^\n]*/), seq("#", /[^\n]*/))),
      ),
  },
})

// A comma/newline separated list, tolerating leading and trailing separators.
function list($, item) {
  return seq(
    repeat($.sep),
    optional(seq(item, repeat(seq($.sep, optional(item))))),
  )
}