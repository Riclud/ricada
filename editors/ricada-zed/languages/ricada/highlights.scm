; Ricada syntax highlighting queries.

(comment) @comment

(string) @string
(escape_sequence) @string.escape

(number) @number

(decorator) @attribute

(route path: (path) @function)
(route_group path: (path) @label)
(path) @label

(field name: (identifier) @property)
(config_entry key: (identifier) @property)
(arg name: (identifier) @property)

(handler_statement name: (identifier) @function)
(call name: (identifier) @function)
(method) @function

(type_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(error_declaration name: (identifier) @type)
(type_ref (type_name (identifier) @type))
(error_ref (type_name (identifier) @type))
(union_type (type_ref (type_name (identifier) @type)))

(identifier) @variable

[
  "import"
  "config"
  "type"
  "enum"
  "error"
  "returns"
  "errors"
  "handler"
  "null"
] @keyword

(param_kind) @keyword

["|" "="] @operator
