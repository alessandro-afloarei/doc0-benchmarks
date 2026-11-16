---
title: "Field References and String Interpolation"
---
## Overview

Plugins and conditionals name event fields with field references such as `message`, `[http][response][status]` or `[@metadata][index]`, and build strings from events with `%{...}` templates such as `logs-%{[service]}-%{+YYYY.MM.dd}`. Three classes implement this. `FieldReference` parses a reference string into a path and a key, once, and caches the result. `Accessors` walks an event's nested maps and lists along that path to read, write, test or delete. `StringInterpolation` expands templates for `Event#sprintf`. The event container they operate on is described on [[Event Model]].

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:38-135](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L38-L135), [logstash-core/src/main/java/org/logstash/Accessors.java:25-53](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L25-L53), [logstash-core/src/main/java/org/logstash/Event.java:396-399](repo://logstash-core/src/main/java/org/logstash/Event.java#L396-L399)

## Reference syntax

The tokenizer accepts a bare top-level name or a sequence of bracketed elements; the table shows how each input splits into path, key and type.

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:243-263](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L243-L263), [logstash-core/src/main/java/org/logstash/FieldReference.java:269-359](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L269-L359)

| Input | Path | Key | Type |
| --- | --- | --- | --- |
| `message` (no brackets) | none | `message` | data |
| `[message]` | none | `message` | data |
| `[http][response][status]` | `http`, `response` | `status` | data |
| `[@metadata]` | none | `@metadata` | metadata parent |
| `[@metadata][index]` | none | `index` | metadata child |
| `[tags][0]` | `tags` | `0` | data |

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:243-263](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L243-L263), [logstash-core/src/main/java/org/logstash/FieldReference.java:269-359](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L269-L359)

A string with no brackets is taken whole as a top-level key, so `a.b` is a field literally named `a.b`, not a nested path. Once a bracket appears, the whole reference must be brackets: the tokenizer throws `IllegalSyntaxException("Invalid FieldReference: ...")` for text outside brackets after a `]` (`[a]b`), text before a `[` (`a[b]`), an empty element (`[]`), an unmatched `]`, or an unclosed `[`. Nested brackets that each wrap a whole fragment, such as `[[a]][b]`, are flattened.

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:275-359](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L275-L359)

The reference type decides which map an event uses: `META_PARENT` returns the whole metadata map, `META_CHILD` reads under metadata, and everything else reads the data map ([[Event Model]] lists what each operation does for each type).

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:72-86](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L72-L86), [logstash-core/src/main/java/org/logstash/FieldReference.java:251-263](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L251-L263)

## Parsing and caching

`FieldReference.from(String)` looks the string up in `CACHE`; on a miss it parses, deduplicates the result against a global `DEDUP` map so equal references share one object, and stores it while the cache holds fewer than 10,000 entries. `from(RubyString)` has its own `RUBY_CACHE` in front, keyed by a frozen copy of the Ruby string, with the same limit. Past the limits, references are still parsed correctly but not cached, so configs that build field names dynamically do not grow memory without bound.

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:88-158](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L88-L158), [logstash-core/src/main/java/org/logstash/FieldReference.java:200-241](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L200-L241)

The constructor interns the key and every path element through `ConvertedMap.internStringForUseAsKey`, which is what lets the identity-based `ConvertedMap` find fields by reference. A precomputed hash covers path, key and type. `isValid(reference)` reports whether a string parses.

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:129-135](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L129-L135), [logstash-core/src/main/java/org/logstash/FieldReference.java:161-199](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L161-L199)

## Escaping brackets in field names

A field whose name contains `[` or `]` cannot be referenced in the plain syntax. The global escape style, set at startup from `config.field_reference.escape_style` (a technical preview, see [[Startup and the Runner]]), selects an `EscapeHandler` that unescapes each token after tokenizing, as listed below.

Sources: [logstash-core/src/main/java/org/logstash/util/EscapeHandler.java:7-71](repo://logstash-core/src/main/java/org/logstash/util/EscapeHandler.java#L7-L71), [logstash-core/src/main/java/org/logstash/FieldReference.java:50-70](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L50-L70)

| Style | Writes `[` as | Writes `]` as | Unescape |
| --- | --- | --- | --- |
| `none` (default) | not possible | not possible | none |
| `percent` | `%5B` | `%5D` | URL-decode tokens that contain a `%XX` sequence; a lone `%` stays literal |
| `ampersand` | `&#91;` | `&#93;` | Replace `&#NN;` with the code point |

Sources: [logstash-core/src/main/java/org/logstash/util/EscapeHandler.java:7-71](repo://logstash-core/src/main/java/org/logstash/util/EscapeHandler.java#L7-L71), [logstash-core/src/main/java/org/logstash/FieldReference.java:50-70](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L50-L70)

Changing the style clears both caches, since the same string may now parse differently.

Sources: [logstash-core/src/main/java/org/logstash/FieldReference.java:52-70](repo://logstash-core/src/main/java/org/logstash/FieldReference.java#L52-L70), [logstash-core/lib/logstash/runner.rb:313-319](repo://logstash-core/lib/logstash/runner.rb#L313-L319)

## Accessors

`Accessors` operates on a `ConvertedMap` and a `FieldReference`. Each path element is looked up in a map by key, or in a list by integer index; negative indexes count from the end (`[tags][-1]` is the last tag).

Sources: [logstash-core/src/main/java/org/logstash/Accessors.java:152-187](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L152-L187)

| Method | Behaviour |
| --- | --- |
| `get` | Walk the path; return `null` as soon as an element is missing or is not a map or list |
| `includes` | True when the parent exists and the key is present in a map, or the index holds a non-null value in a list |
| `del` | Remove from the parent map, or remove the list element at the index; `null` when absent |
| `set` | Walk the path creating empty maps for missing elements, then write the key |

Sources: [logstash-core/src/main/java/org/logstash/Accessors.java:29-53](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L29-L53), [logstash-core/src/main/java/org/logstash/Accessors.java:91-120](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L91-L120)

Writing has two edge cases worth knowing. Setting an index past the end of a list pads the list with `null`s up to that index (behaviour kept from the old Ruby implementation), and a non-numeric key on a list is ignored. Setting a child of a field that holds a scalar, such as `[foo][bar]` when `foo` is a string, throws `InvalidFieldSetException`.

Sources: [logstash-core/src/main/java/org/logstash/Accessors.java:55-89](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L55-L89), [logstash-core/src/main/java/org/logstash/Accessors.java:122-150](repo://logstash-core/src/main/java/org/logstash/Accessors.java#L122-L150)

## String interpolation

`Event#sprintf(template)` calls `StringInterpolation.evaluate`. A template with no `%{` or no closing `}` is returned unchanged. Otherwise each `%{...}` is replaced according to its content, as listed below.

Sources: [logstash-core/src/main/java/org/logstash/StringInterpolation.java:57-137](repo://logstash-core/src/main/java/org/logstash/StringInterpolation.java#L57-L137)

| Placeholder | Result |
| --- | --- |
| `%{field}` or `%{[a][b]}` | The field's value; lists joined with `,`; maps as JSON; left as `%{field}` when missing |
| `%{+%s}` | `@timestamp` as Unix epoch seconds |
| `%{+FORMAT}` | `@timestamp` formatted with a Joda-Time pattern in UTC, e.g. `%{+YYYY.MM.dd}` |
| `%{{FORMAT}}` | `@timestamp` formatted with a `java.time` `DateTimeFormatter` pattern in UTC, e.g. `%{{yyyy-MM-dd}}` |
| `%{{TIME_NOW}}` | The current time, not the event's timestamp |

Sources: [logstash-core/src/main/java/org/logstash/StringInterpolation.java:57-137](repo://logstash-core/src/main/java/org/logstash/StringInterpolation.java#L57-L137)

A missing field is left in the output as written rather than becoming empty, so an index name like `logs-%{service}` visibly shows the problem. Timestamp placeholders produce nothing when the event has no `@timestamp`. The builder is a reused thread-local `StringBuilder`, because `sprintf` runs once per event in outputs such as Elasticsearch's index name.

Sources: [logstash-core/src/main/java/org/logstash/StringInterpolation.java:36-51](repo://logstash-core/src/main/java/org/logstash/StringInterpolation.java#L36-L51), [logstash-core/src/main/java/org/logstash/StringInterpolation.java:95-127](repo://logstash-core/src/main/java/org/logstash/StringInterpolation.java#L95-L127)

> [!NOTE]
> Joda patterns and `java.time` patterns differ: in Joda `YYYY` is the year of era, in `java.time` `YYYY` is the week-based year. Use `%{+YYYY.MM.dd}` or `%{{yyyy.MM.dd}}` for calendar dates.

Sources: [logstash-core/src/main/java/org/logstash/StringInterpolation.java:84-113](repo://logstash-core/src/main/java/org/logstash/StringInterpolation.java#L84-L113)

## Where references are parsed

Conditionals keep the selector text from the config (`[type]`) in an `EventValueExpression`, which the compiled conditions turn into a `FieldReference` once at compile time ([[Compiled Pipeline Execution]]). Ruby plugins pass strings to `event.get` and `event.set`, which hit `RUBY_CACHE`. Java plugins call `Event.getField(String)`, which hits `CACHE`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java:293-310](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java#L293-L310), [logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java:105-125](repo://logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java#L105-L125), [logstash-core/src/main/java/org/logstash/Event.java:186-206](repo://logstash-core/src/main/java/org/logstash/Event.java#L186-L206)
