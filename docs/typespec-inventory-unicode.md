# Unicode-safe TypeSpec declaration inventory

The direct TypeSpec inventory is independent evidence beside the official
compiler/emitter run. It must not reject declarations that the TypeSpec grammar
accepts, because an omitted declaration could otherwise be mistaken for a
mapping or schema-lane defect.

The inventory lexer now follows the TypeSpec stable-identifier profile:

- ASCII starts are letters, `_`, or `$`;
- ASCII continuation additionally permits digits;
- assigned non-ASCII code points are admitted except controls, private-use and
  surrogate code points, noncharacters, Pattern_White_Space, U+FFFD, and
  unassigned code points; and
- international scripts, combining sequences, ZWNJ/ZWJ sequences, and leading
  or continuing emoji remain intact as one identifier token.

The test suite cross-checks representative identifiers against the official
`@typespec/compiler/ast` parser before asserting the inventory result. This
keeps the local inventory from becoming a second language grammar.

The lexer also emits `...` as one token. The previous two-code-unit lookahead
could never match a three-character ellipsis and made spread syntax visible as
three unrelated punctuation tokens.

This remains a declaration inventory, not a substitute for compiler semantic
analysis. A release still requires the pinned TypeSpec compiler and official
JSON Schema emitter, structural parity, bidirectional instance validation, and
an exact-input receipt. TypeSpec and independently authored JSON Schema remain
peer authorities; neither may be generated from or overwritten by the other.
