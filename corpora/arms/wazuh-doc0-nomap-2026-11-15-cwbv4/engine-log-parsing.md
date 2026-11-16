---
title: "Log Parsing (HLP and Logpar)"
---
## Overview

Turning a raw log line into structured fields is the job of the `parse|<field>` stage of a decoder. Each entry in that stage is a logpar expression: a template mixing literal text with `<field>` captures, such as `<source.ip> - <user.name> [<event.start>]`. The logpar module (`src/engine/source/logpar`) compiles an expression into a parser built from the HLP library (`src/engine/source/hlp`), whose combinators come from the small `parsec` library. Which parser captures each field is decided by the field's type in the schema, so `<source.ip>` is parsed as an IP and `<event.start>` as a date without saying so. How the parse stage fits into an asset is on [[Engine Assets, Policies and the Builder]].

Sources: [src/engine/source/builder/src/builders/stage/parse.cpp:10-115](repo://src/engine/source/builder/src/builders/stage/parse.cpp#L10-L115), [src/engine/source/logpar/src/logpar.cpp:630-644](repo://src/engine/source/logpar/src/logpar.cpp#L630-L644)

## The parse stage

In an asset, `parse|message:` takes a list of expressions for the `message` field (any field may be named after the `|`). The builder rewrites the list into objects of the form `{field: expression}` and the parse stage builder compiles each expression with `logpar->build`, after expanding `$definitions`. The stage is an `Or` of the expressions: the first one that matches wins, so a decoder can list several layouts of the same log from most to least specific.

Sources: [src/engine/source/builder/src/policy/assetBuilder.cpp:120-174](repo://src/engine/source/builder/src/policy/assetBuilder.cpp#L120-L174), [src/engine/source/builder/src/builders/stage/parse.cpp:22-115](repo://src/engine/source/builder/src/builders/stage/parse.cpp#L22-L115)

At run time each expression fails when the field is missing ("reference not found") or not a string, and otherwise runs the parser over the field's value. A failed parse fails the decoder's condition, so the decoder does not apply.

Sources: [src/engine/source/builder/src/builders/stage/parse.cpp:79-101](repo://src/engine/source/builder/src/builders/stage/parse.cpp#L79-L101)

## Expression syntax

| Element | Syntax | Meaning |
| --- | --- | --- |
| Literal | Any text | Must match exactly; `\` escapes the reserved characters `<`, `?`, `(` and `)` |
| Field | `<field.name>` | Captures into `field.name` with the parser for its type |
| Field with arguments | `<field/arg1/arg2>` | Passes options to the parser (for example a date format) |
| Optional field | `<?field>` | May be absent |
| Choice | `<field1>?<field2>` | Either the first or the second capture |
| Optional group | `(?...)` | A sub-expression that may be absent |
| Discard | `<~>` or `<~/parser/args>` | Parses but does not store |
| Temporary field | `<_name>` | Stored as a variable, deleted when the asset ends |

Sources: [src/engine/source/logpar/include/logpar/logpar.hpp:145-160](repo://src/engine/source/logpar/include/logpar/logpar.hpp#L145-L160), [src/engine/source/logpar/include/logpar/logpar.hpp:180-255](repo://src/engine/source/logpar/include/logpar/logpar.hpp#L180-L255), [src/engine/source/logpar/src/logpar.cpp:158-224](repo://src/engine/source/logpar/src/logpar.cpp#L158-L224), [src/engine/source/logpar/src/logpar.cpp:410-420](repo://src/engine/source/logpar/src/logpar.cpp#L410-L420)

A full expression always ends with an end-of-input parser, so an expression must account for the whole string.

Sources: [src/engine/source/logpar/src/logpar.cpp:630-642](repo://src/engine/source/logpar/src/logpar.cpp#L630-L642)

## Choosing the parser for a field

### Schema fields

`buildFieldParser` looks the field up in the schema. For a schema field the parser type comes first from the overrides document (`schema/wazuh-logpar-overrides/0`, a `fields` object mapping field names to parser names), and otherwise from the table that maps schema types to parsers:

Sources: [src/engine/source/logpar/src/logpar.cpp:372-405](repo://src/engine/source/logpar/src/logpar.cpp#L372-L405), [src/engine/source/logpar/include/logpar/logpar.hpp:318-345](repo://src/engine/source/logpar/include/logpar/logpar.hpp#L318-L345)

| Schema type | Parser |
| --- | --- |
| `boolean` | `bool` |
| `byte` | `byte` |
| `short`, `integer`, `long` | `long` |
| `float`, `half_float` | `float` |
| `scaled_float` | `scaled_float` |
| `double` | `double` |
| `keyword`, `text`, `wildcard` | `text` |
| `date`, `date_nanos` | `date` |
| `ip` | `ip` |
| `binary` | `binary` |
| `object`, `nested`, `geo_point` | not parseable |

Sources: [src/engine/source/logpar/src/logpar.cpp:331-350](repo://src/engine/source/logpar/src/logpar.cpp#L331-L350)

Array fields cannot be captured directly. The overrides file shipped in `src/engine/ruleset/schemas` has an empty `fields` object, so out of the box the schema types decide; the constructor rejects overrides for fields that are not in the schema or that name an unknown parser.

Sources: [src/engine/source/logpar/src/logpar.cpp:286-330](repo://src/engine/source/logpar/src/logpar.cpp#L286-L330), [src/engine/ruleset/schemas/wazuh-logpar-overrides.json:1-4](repo://src/engine/ruleset/schemas/wazuh-logpar-overrides.json#L1-L4)

### Custom fields

A field that is not in the schema uses the parser named in its first argument (`<_payload/json>`, `<custom.kv/kv/=/ >`) or `text` when there is none. This is how decoders use structured parsers such as `json`, `kv`, `csv` or `xml`, whose output is an object.

Sources: [src/engine/source/logpar/src/logpar.cpp:378-398](repo://src/engine/source/logpar/src/logpar.cpp#L378-L398)

### Stop tokens

Many parsers, `text` first among them, consume input until a stop string. `buildParsers` computes the stop tokens for each field from the literal that follows it (looking through optional groups), so in `<user.name> from <source.ip>` the text parser stops at ` from `. Two adjacent captures with no literal between them therefore need a parser that knows its own end.

Sources: [src/engine/source/logpar/src/logpar.cpp:450-560](repo://src/engine/source/logpar/src/logpar.cpp#L450-L560), [src/engine/source/logpar/src/logpar.cpp:560-600](repo://src/engine/source/logpar/src/logpar.cpp#L560-L600)

## Parser catalogue

All parsers are registered on the `Logpar` instance at engine start by `hlp::registerParsers`:

Sources: [src/engine/source/logpar/include/logpar/registerParsers.hpp:1-45](repo://src/engine/source/logpar/include/logpar/registerParsers.hpp#L1-L45), [src/engine/source/main.cpp:401-402](repo://src/engine/source/main.cpp#L401-L402)

| Name | Accepts |
| --- | --- |
| `text` | Any text up to the stop token |
| `literal` | An exact string |
| `quoted` | A quoted string, with configurable quote and escape characters |
| `between` | Text between a start and an end string |
| `alphanumeric` | Letters and digits |
| `long`, `double`, `float`, `scaled_float`, `byte` | Numbers |
| `bool` | `true` or `false` |
| `binary` | Base64 |
| `date` | A date in a given format (`std::chrono::parse` syntax), normalized to UTC |
| `ip` | IPv4 or IPv6, validated with `inet_pton` |
| `uri` | A URL, returned as an ECS `url` object |
| `useragent` | A user-agent string |
| `fqdn` | A domain name |
| `file` | A file path, split into path, name and extension |
| `json` | A JSON value |
| `xml` | An XML document, returned as JSON |
| `csv`, `dsv` | Delimited values; arguments name the fields in order |
| `kv` | Key-value pairs; arguments give the separator and the delimiter |
| `ignore` | Skips a repeated string |

Sources: [src/engine/source/hlp/include/hlp/hlp.hpp:45-160](repo://src/engine/source/hlp/include/hlp/hlp.hpp#L45-L160), [src/engine/source/hlp/include/hlp/hlp.hpp:160-270](repo://src/engine/source/hlp/include/hlp/hlp.hpp#L160-L270), [src/engine/source/hlp/include/hlp/hlp.hpp:270-358](repo://src/engine/source/hlp/include/hlp/hlp.hpp#L270-L358)

The same parsers are available as helpers (`parse_json`, `parse_date`, `parse_key_value`, ...) for parsing a field later in `normalize`; see [[Engine Helper Functions]].

Sources: [src/engine/source/builder/src/register.hpp:272-316](repo://src/engine/source/builder/src/register.hpp#L272-L316)

## Three-phase parsing

An HLP parser does not write to the event while it scans. `hlp::parser::run` runs three phases:

Sources: [src/engine/source/hlp/include/hlp/parser.hpp:57-110](repo://src/engine/source/hlp/include/hlp/parser.hpp#L57-L110)

1. **Syntax**: the combined parser scans the text and returns a tree of results, each with the substring it consumed and a semantic parser. On failure the error reports which parser failed and the remaining input.
2. **Semantics**: each result's semantic parser converts the substring into a typed value (a number, a date, a JSON object) and returns a mapper, or an error.
3. **Mapping**: only when every step succeeded are the mappers applied to the event.

Sources: [src/engine/source/hlp/include/hlp/parser.hpp:57-110](repo://src/engine/source/hlp/include/hlp/parser.hpp#L57-L110)

Splitting the phases means a failing expression never leaves half-written fields in the event, which matters because the parse stage tries several expressions in turn.

Sources: [src/engine/source/builder/src/builders/stage/parse.cpp:94-112](repo://src/engine/source/builder/src/builders/stage/parse.cpp#L94-L112)
