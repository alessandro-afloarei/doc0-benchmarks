---
title: "Errors and Warnings"
---
## Overview

Every diagnostic Svelte can produce, from a compile error in a template to a hydration warning in the browser, has a stable code such as `a11y_missing_attribute` or `hydration_mismatch`, a message, and a documentation URL `https://svelte.dev/e/<code>`. The messages are not written in JavaScript. They live as markdown under `packages/svelte/messages/`, and `scripts/process-messages` generates one function per code into seven `errors.js`/`warnings.js` files, plus the reference pages under `documentation/docs/98-reference/.generated`. Code throws or warns by calling the generated function, as in `e.props_duplicate(node, rune)` or `w.a11y_autofocus(attribute)`.

Sources: [packages/svelte/scripts/process-messages/index.js:13-94](repo://packages/svelte/scripts/process-messages/index.js#L13-L94), [packages/svelte/scripts/process-messages/index.js:398-406](repo://packages/svelte/scripts/process-messages/index.js#L398-L406)

| Folder in `messages/` | Generated file | Used by |
| --- | --- | --- |
| `compile-errors` | `src/compiler/errors.js` | Parser, analyzer, transforms, option validation |
| `compile-warnings` | `src/compiler/warnings.js` | Same, plus [[Accessibility Checks]] and [[Scoped CSS]] |
| `client-errors` | `src/internal/client/errors.js` | Browser runtime |
| `client-warnings` | `src/internal/client/warnings.js` | Browser runtime, dev only |
| `server-errors` | `src/internal/server/errors.js` | [[Server Rendering Runtime]] |
| `shared-errors`, `shared-warnings` | `src/internal/shared/*.js` | Both runtimes; re-exported by the client and server files |

Sources: [packages/svelte/scripts/process-messages/index.js:398-406](repo://packages/svelte/scripts/process-messages/index.js#L398-L406), [packages/svelte/scripts/process-messages/templates/client-errors.js:1-3](repo://packages/svelte/scripts/process-messages/templates/client-errors.js#L1-L3)

## Message files

Each markdown file is a list of `## code` sections. The blockquoted paragraphs (`> ...`) are the message text; any paragraphs after the last blockquote are details that only go into the generated documentation. Placeholders are written `%name%` and become parameters of the generated function.

Sources: [packages/svelte/scripts/process-messages/index.js:39-64](repo://packages/svelte/scripts/process-messages/index.js#L39-L64)

```markdown
## await_waterfall

> An async derived, `%name%` (%location%) was not read immediately after it resolved. This often indicates an unnecessary waterfall, which can slow down your app
```

Sources: [packages/svelte/messages/client-warnings/warnings.md:78-80](repo://packages/svelte/messages/client-warnings/warnings.md#L78-L80)

The generator enforces a few rules: a code may appear only once across all folders, a section must have message text, and the sections of each file are rewritten in alphabetical order on every run. A code may have several blockquotes to form overloads; each later one must introduce a new placeholder, and the generated function picks the most specific message whose extra parameter was passed (a conditional expression that tests the extra parameter).

Sources: [packages/svelte/scripts/process-messages/index.js:42-71](repo://packages/svelte/scripts/process-messages/index.js#L42-L71), [packages/svelte/scripts/process-messages/index.js:173-259](repo://packages/svelte/scripts/process-messages/index.js#L173-L259)

## Generating the functions

Each output file has a template in `scripts/process-messages/templates/` that contains one placeholder function `export function CODE(PARAMETER)` and any shared helpers. `transform` parses the template with acorn, removes the placeholder, and for every code clones it with zimmerframe: the function is renamed to the code, `PARAMETER` is replaced by the message's placeholders, the literal `'CODE'` becomes the code, and the identifier `MESSAGE` becomes the message as a string or template literal. The JSDoc above the placeholder is copied with the message text and typed `@param` lines (later overload parameters are optional). The result is printed with esrap under a "Do not edit!" header. An identifier named `CODES` in a template is replaced with the array of all codes.

Sources: [packages/svelte/scripts/process-messages/index.js:96-171](repo://packages/svelte/scripts/process-messages/index.js#L96-L171), [packages/svelte/scripts/process-messages/index.js:261-348](repo://packages/svelte/scripts/process-messages/index.js#L261-L348), [packages/svelte/scripts/process-messages/index.js:350-396](repo://packages/svelte/scripts/process-messages/index.js#L350-L396)

`pnpm build` runs the generator before rollup, and `pnpm dev` runs it with `-w`, which watches `messages/` and regenerates on change ([[Building and Releasing]]).

Sources: [packages/svelte/package.json:140-142](repo://packages/svelte/package.json#L140-L142), [packages/svelte/scripts/process-messages/index.js:407-429](repo://packages/svelte/scripts/process-messages/index.js#L407-L429)

## Compiler diagnostics

The compile-error template defines `InternalCompileError` and a helper `e(node, code, message)`. `node` may be an AST node, a character offset, or `null`; its `start` and `end` become the `position`. The error extends `Error` so bundler plugins handle it as one, but copies its fields from a `CompileDiagnostic` so errors and warnings share a shape; its `stack` is emptied to avoid noise, and its `name` is `CompileError`.

Sources: [packages/svelte/scripts/process-messages/templates/compile-errors.js:1-60](repo://packages/svelte/scripts/process-messages/templates/compile-errors.js#L1-L60)

`CompileDiagnostic` reads the [[Compiler Pipeline]]'s shared state when it is created: the `filename` (omitted when unknown), `start` and `end` as `{ line, column, character }` from the `locator`, and a `frame`: the source lines around the problem with line numbers and a `^` under the column, tabs expanded to two spaces. `toString()` formats `code: message`, the file and position, and the frame.

Sources: [packages/svelte/src/compiler/utils/compile_diagnostic.js:13-107](repo://packages/svelte/src/compiler/utils/compile_diagnostic.js#L13-L107)

Warnings do not throw. The generated `w(node, code, message)` checks whether the code is ignored for the node, builds an `InternalCompileWarning` (a `CompileDiagnostic` named `CompileWarning`), passes it to `warning_filter`, and pushes it onto `state.warnings`, which becomes `CompileResult.warnings`.

Sources: [packages/svelte/src/compiler/warnings.js:1-39](repo://packages/svelte/src/compiler/warnings.js#L1-L39)

## Silencing warnings

### svelte-ignore and warningFilter

There are two mechanisms, applied in this order:

Sources: [packages/svelte/src/compiler/warnings.js:25-39](repo://packages/svelte/src/compiler/warnings.js#L25-L39)

1. **`svelte-ignore` comments.** During analysis the catch-all visitor reads the HTML comments immediately before a template node, or the leading comments of a script node, with `extract_svelte_ignore`, and pushes the codes on `ignore_stack` for the node's subtree. A snapshot of the stack is stored per node in `ignore_map`, so a warning raised later for that node (even during the transform) is still suppressed ([[Component Analysis]]).
2. **`warningFilter`.** The compile option is called with each remaining warning; returning `false` drops it.

Sources: [packages/svelte/src/compiler/phases/2-analyze/index.js:87-139](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L87-L139), [packages/svelte/src/compiler/warnings.js:25-39](repo://packages/svelte/src/compiler/warnings.js#L25-L39), [packages/svelte/src/compiler/state.js:59-95](repo://packages/svelte/src/compiler/state.js#L59-L95)

`extract_svelte_ignore` parses `svelte-ignore code_a, code_b` comments. In runes mode the codes are comma-separated and must exist; an unknown code produces an `unknown_code` warning with a fuzzy-matched suggestion, and a Svelte 4 dashed code produces `legacy_code` naming its replacement (`a11y-missing-attribute` → `a11y_missing_attribute`, plus a few renamed codes such as `unused-export-let` → `export_let_unused`). In legacy mode any word is accepted, and dashed codes also ignore their underscore form.

Sources: [packages/svelte/src/compiler/utils/extract_svelte_ignore.js:1-82](repo://packages/svelte/src/compiler/utils/extract_svelte_ignore.js#L1-L82)

### Ignoring runtime warnings

Some warnings are raised by the runtime, but the compiler decides whether to emit the dev check at all. `IGNORABLE_RUNTIME_WARNINGS` lists them (`await_waterfall`, `await_reactivity_loss`, `state_snapshot_uncloneable`, `binding_property_non_reactive`, the hydration attribute/HTML change warnings and the ownership warnings). These codes are valid in `svelte-ignore` comments, and transforms call `is_ignored(node, code)` (true only in dev and when the node's ignore stack contains the code) to omit the check or pass a flag that silences it.

Sources: [packages/svelte/src/constants.js:44-53](repo://packages/svelte/src/constants.js#L44-L53), [packages/svelte/src/compiler/utils/extract_svelte_ignore.js:20-20](repo://packages/svelte/src/compiler/utils/extract_svelte_ignore.js#L20-L20), [packages/svelte/src/compiler/state.js:88-95](repo://packages/svelte/src/compiler/state.js#L88-L95), [packages/svelte/src/compiler/phases/3-transform/client/visitors/AwaitExpression.js:20-26](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/AwaitExpression.js#L20-L26)

## Runtime diagnostics

Runtime errors and warnings are shaped by `DEV` from `esm-env`. In development a client error is an `Error` named `Svelte error` whose message is the code, the full text and the URL; a warning is a styled `console.warn` with `[svelte] code` in bold. In production both shrink to the URL alone, so the message strings are dead code that bundlers remove.

Sources: [packages/svelte/scripts/process-messages/templates/client-errors.js:1-18](repo://packages/svelte/scripts/process-messages/templates/client-errors.js#L1-L18), [packages/svelte/scripts/process-messages/templates/client-warnings.js:1-20](repo://packages/svelte/scripts/process-messages/templates/client-warnings.js#L1-L20)
