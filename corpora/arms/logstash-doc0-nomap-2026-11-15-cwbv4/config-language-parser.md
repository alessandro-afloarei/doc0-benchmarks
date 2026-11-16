---
title: "Configuration Language Parser"
---
## Overview

Pipeline configurations are written in the Logstash configuration language: `input`, `filter` and `output` sections holding plugin blocks with `name => value` attributes and `if`/`else if`/`else` branches. This page covers how one config part becomes Java IR statements. The grammar is a Treetop PEG grammar compiled to Ruby; its syntax nodes are Ruby classes whose `expr` methods call the Java `org.logstash.config.ir.DSL` factory, so the parser's output is already Java objects. What those statements and graphs are is the subject of [[Pipeline Intermediate Representation]].

Sources: [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:4-31](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L4-L31), [logstash-core/lib/logstash/compiler/lscl.rb:24-41](repo://logstash-core/lib/logstash/compiler/lscl.rb#L24-L41)

## Entry point

The Java `ConfigCompiler` calls the parser once per `SourceWithMetadata` part, running `LogStash::Compiler.compile_imperative(part, support_escapes)` in the global JRuby runtime. That method creates a `LogStashCompilerLSCLGrammarParser`, parses the part's text, raises `ConfigurationError` with Treetop's `failure_reason` when parsing fails, sets whether escape sequences are processed, and returns `config.compile(part)`: a hash of `input`, `filter` and `output` to one statement each.

Sources: [logstash-core/lib/logstash/compiler.rb:18-38](repo://logstash-core/lib/logstash/compiler.rb#L18-L38), [logstash-core/src/main/java/org/logstash/config/ir/ConfigCompiler.java:87-110](repo://logstash-core/src/main/java/org/logstash/config/ir/ConfigCompiler.java#L87-L110)

Because every part is parsed separately, a single `.conf` file must be syntactically complete on its own; sections from different files are joined afterwards at the graph level, as described in [[Pipeline Intermediate Representation]].

Sources: [logstash-core/src/main/java/org/logstash/config/ir/ConfigCompiler.java:62-77](repo://logstash-core/src/main/java/org/logstash/config/ir/ConfigCompiler.java#L62-L77)

## The grammar

`lscl_grammar.treetop` defines the language. Each rule names the Ruby node class that represents a match.

Sources: [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:5-64](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L5-L64), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:67-135](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L67-L135), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:137-246](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L137-L246)

| Rule | Matches | Node class |
| --- | --- | --- |
| `config` | Any number of plugin sections with comments and whitespace | `Config` |
| `plugin_section` | `input`, `filter` or `output` followed by `{ ... }` holding plugins and branches | `PluginSection` |
| `plugin` | `name { attribute* }` | `Plugin` |
| `attribute` | `name => value` | `Attribute` |
| `value` | plugin (a codec), bareword, string, number, array or hash | various |
| `branch` | `if`, any number of `else if`, optional `else` | `Branch` |
| `condition` | Expressions joined by `and`, `or`, `xor`, `nand` | `Condition` |
| `expression` | Parenthesised condition, `!`, `in`, `not in`, comparison, regexp match, or a bare rvalue | `Expression` |
| `selector` | One or more `[field]` elements | `Selector` |

Sources: [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:5-64](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L5-L64), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:67-135](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L67-L135), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:137-246](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L137-L246)

Some details matter when reading configs. A bareword needs at least two characters (`[A-Za-z_][A-Za-z0-9_]+`). Strings are single- or double-quoted with `\"` or `\'` escapes; regular expressions are written between slashes. Comparison operators are `==`, `!=`, `<=`, `>=`, `<`, `>`, and regexp operators `=~` and `!~`. A selector element is any text without `[`, `]` or `,` between brackets, so `[foo][bar]` parses as two elements and the text is interpreted later as a [[Field References and String Interpolation]] path. A `method_call` rule exists, but its node class is empty: "Not implemented because no one uses this".

Sources: [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:75-99](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L75-L99), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop:194-244](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.treetop#L194-L244), [logstash-core/lib/logstash/compiler/lscl.rb:500-501](repo://logstash-core/lib/logstash/compiler/lscl.rb#L500-L501)

The generated parser `lscl_grammar.rb` is checked in. `rake compile:grammar` (or `./gradlew compileGrammar`) regenerates it with Treetop's `GrammarCompiler`, together with the older `config/grammar.rb`, which is used only by the legacy `LogStash::Config::File` class.

Sources: [rakelib/compile.rake:18-41](repo://rakelib/compile.rake#L18-L41), [logstash-core/lib/logstash/compiler/lscl/lscl_grammar.rb:1-5](repo://logstash-core/lib/logstash/compiler/lscl/lscl_grammar.rb#L1-L5), [logstash-core/lib/logstash/config/file.rb:18-34](repo://logstash-core/lib/logstash/config/file.rb#L18-L34)

## Source metadata on every node

Treetop nodes cannot carry state between them, so Logstash patches `Treetop::Runtime::SyntaxNode` with `set_meta` and `get_meta`, where `get_meta` walks up to the parent until it finds the key. `Config#compile` stores the part's `SourceWithMetadata` as `base_source_with_metadata` and the escape flag as `process_escape_sequences` on the root; every descendant reads them through the parent chain.

Sources: [logstash-core/lib/logstash/compiler/treetop_monkeypatches.rb:20-31](repo://logstash-core/lib/logstash/compiler/treetop_monkeypatches.rb#L20-L31), [logstash-core/lib/logstash/compiler/lscl.rb:43-78](repo://logstash-core/lib/logstash/compiler/lscl.rb#L43-L78)

`Helpers#source_meta` builds a new `SourceWithMetadata` for any node from the base part's protocol and id, the node's line and column in the part, and the node's text. Every plugin and expression carries this, which is how a plugin gets a stable default id and an error names `file:/etc/logstash/conf.d/a.conf` with a line and column.

Sources: [logstash-core/lib/logstash/compiler/lscl/helpers.rb:18-65](repo://logstash-core/lib/logstash/compiler/lscl/helpers.rb#L18-L65)

## From syntax tree to statements

### Sections and plugins

`Config#compile` collects every `PluginSection`, groups their `expr` results by section name, and composes each group: filters with `DSL.iComposeSequence` (they run one after the other) and inputs and outputs with `DSL.iComposeParallel` (they are independent). A plugin inside another plugin's attribute is a codec, which `section_type` detects by finding a `Plugin` ancestor.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:30-41](repo://logstash-core/lib/logstash/compiler/lscl.rb#L30-L41), [logstash-core/lib/logstash/compiler/lscl.rb:50-87](repo://logstash-core/lib/logstash/compiler/lscl.rb#L50-L87), [logstash-core/lib/logstash/compiler/lscl/helpers.rb:42-52](repo://logstash-core/lib/logstash/compiler/lscl/helpers.rb#L42-L52)

`Plugin#expr` turns the attributes into a hash and returns `DSL.iPlugin(source_meta, type, name, attributes)`. Repeated attributes are merged for compatibility: two hash values with the same name are merged (grok's repeated `match`), arrays are concatenated, and two different scalars become an array. An input or output with more than one `codec` raises a `ConfigurationError` naming the line, because the merged array could not be serialized.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:91-162](repo://logstash-core/lib/logstash/compiler/lscl.rb#L91-L162)

### Values

| Node | Result |
| --- | --- |
| `Bareword` | `eValue(text)` |
| `String` | `eValue(text without quotes)`, after `StringEscape.process_escapes` when `config.support_escapes` is true |
| `Number` | `eValue(Float)` if the text has a `.`, else `eValue(Integer)` |
| `Array` | `eValue` of the element values |
| `Hash` | `eValue` of a Ruby hash; duplicate keys raise `ConfigurationError` with line and column |
| `RegExp` | `eRegex(text without slashes)` |
| `Selector` | `eEventValue(text)`, a reference to an event field |

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:164-251](repo://logstash-core/lib/logstash/compiler/lscl.rb#L164-L251), [logstash-core/lib/logstash/compiler/lscl.rb:583-593](repo://logstash-core/lib/logstash/compiler/lscl.rb#L583-L593)

With escapes on, `\"`, `\'` and `\\` become the quoted character, `\n`, `\r`, `\t` and `\0` become control characters, and any other backslash sequence is left as written.

Sources: [logstash-core/lib/logstash/config/string_escape.rb:18-44](repo://logstash-core/lib/logstash/config/string_escape.rb#L18-L44)

### Branches

`Branch#expr` rewrites `if / else if / else` into nested two-way ifs. It first builds s-expressions: the `if` with its condition and body, each `else if` pushed on a stack as a new `[:if, cond, body]`, and the `else` body appended to the last stacked entry. The stack is folded so each `else if` becomes the false branch of the one before. `javaify_sexpr` then emits `DSL.iIf(condition_source, condition, true_branch, false_branch)`, using `DSL.noop` for a missing branch and dropping an `if` whose branches are both empty.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:253-330](repo://logstash-core/lib/logstash/compiler/lscl.rb#L253-L330)

### Conditions

`Condition#expr` returns the single expression directly when there is one; a bare selector becomes `eTruthy`. With boolean operators it runs the shunting-yard algorithm: `and` binds tighter than `or`, then the output queue is folded into `eAnd`, `eOr`, `eNand` and `eXor` calls. `precedence` knows only `and` and `or` and raises `ArgumentError` for others, so a condition chaining `xor` or `nand` with another operator needs parentheses.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:332-447](repo://logstash-core/lib/logstash/compiler/lscl.rb#L332-L447), [logstash-core/lib/logstash/compiler/lscl/helpers.rb:67-71](repo://logstash-core/lib/logstash/compiler/lscl/helpers.rb#L67-L71)

The other expression nodes map onto DSL calls: `!` becomes `eNot`; comparisons call `eEq`, `eNeq`, `eGt`, `eLt`, `eGte` or `eLte`; `in` and `not in` become `eIn` and `eNot(eIn)`; `=~` and `!~` call `eRegexEq` or `eRegexNeq`, turning a string on the right into a regex.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:449-523](repo://logstash-core/lib/logstash/compiler/lscl.rb#L449-L523), [logstash-core/lib/logstash/compiler/lscl.rb:527-581](repo://logstash-core/lib/logstash/compiler/lscl.rb#L527-L581)

The DSL builds the derived operators from primitives: `nand` is `Not(And)`, `xor` is `Or(And(Not(a), b), And(a, Not(b)))`, `!~` is `Not(RegexEq)`, and `eTruthy` returns an expression unchanged when it is already boolean.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/DSL.java:153-216](repo://logstash-core/src/main/java/org/logstash/config/ir/DSL.java#L153-L216)

## Example

```text
filter {
  if [type] == "apache" and [status] >= 500 {
    mutate { add_tag => "error" }
  } else if "debug" in [tags] {
    drop { }
  }
}
```

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:253-330](repo://logstash-core/lib/logstash/compiler/lscl.rb#L253-L330), [logstash-core/lib/logstash/compiler/lscl.rb:394-427](repo://logstash-core/lib/logstash/compiler/lscl.rb#L394-L427)

The filter section becomes one `iComposeSequence` holding `iIf(eAnd(eEq([type], "apache"), eGte([status], 500)), iPlugin(mutate), iIf(eIn("debug", [tags]), iPlugin(drop), noop))`. [[Pipeline Intermediate Representation]] turns this into a graph with two `IfVertex` nodes.

Sources: [logstash-core/lib/logstash/compiler/lscl.rb:253-330](repo://logstash-core/lib/logstash/compiler/lscl.rb#L253-L330), [logstash-core/lib/logstash/compiler/lscl.rb:394-427](repo://logstash-core/lib/logstash/compiler/lscl.rb#L394-L427)
