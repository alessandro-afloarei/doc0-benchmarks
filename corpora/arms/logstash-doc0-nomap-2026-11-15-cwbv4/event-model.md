---
title: "Event Model"
---
## Overview

Everything that moves through a pipeline is an `org.logstash.Event`: a tree of fields holding the data, a second tree for `@metadata` that outputs do not send, a timestamp, and a cancelled flag that filters set to drop the event. The class is Java and implements the public `co.elastic.logstash.api.Event` interface used by Java plugins ([[Java Plugin API]]), while Ruby plugins see it through the `LogStash::Event` wrapper defined in `JrubyEventExtLibrary`. To make both worlds share one object without copying, values inside an event are stored as Ruby objects, and conversion classes translate on the way in (`Valuefier`) and on the way out (`Javafier`, `Rubyfier`). Paths such as `[http][status]` and `%{field}` templates are covered on [[Field References and String Interpolation]].

Sources: [logstash-core/src/main/java/org/logstash/Event.java:51-82](repo://logstash-core/src/main/java/org/logstash/Event.java#L51-L82), [logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java:92-130](repo://logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java#L92-L130)

## Structure

| Part | Storage | Notes |
| --- | --- | --- |
| Data | `ConvertedMap data` | All normal fields, including `@timestamp`, `@version`, `tags` |
| Metadata | `ConvertedMap metadata` | The `[@metadata]` tree; not part of `toJson` or `to_hash` |
| Cancelled | `boolean` | Set by `cancel()`; cancelled events are dropped between pipeline stages |

Sources: [logstash-core/src/main/java/org/logstash/Event.java:57-82](repo://logstash-core/src/main/java/org/logstash/Event.java#L57-L82), [logstash-core/src/main/java/org/logstash/Event.java:132-155](repo://logstash-core/src/main/java/org/logstash/Event.java#L132-L155)

A new empty event gets `@version` `"1"` and `@timestamp` set to now. When an event is built from a map, the constructor runs four steps.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:75-130](repo://logstash-core/src/main/java/org/logstash/Event.java#L75-L130), [logstash-core/src/main/java/org/logstash/Event.java:432-470](repo://logstash-core/src/main/java/org/logstash/Event.java#L432-L470)

1. Adds `@version: "1"` if absent.
2. Moves an `@metadata` key out of the data into the metadata map.
3. Checks `tags`: a string, a list of strings or nothing is legal; anything else is moved to `_tags` and the event is tagged `_tagsparsefailure`.
4. Parses `@timestamp`. A missing value means now. A value that cannot be parsed is kept in `_@timestamp`, the timestamp becomes now, and the event is tagged `_timestampparsefailure`.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:75-130](repo://logstash-core/src/main/java/org/logstash/Event.java#L75-L130), [logstash-core/src/main/java/org/logstash/Event.java:432-470](repo://logstash-core/src/main/java/org/logstash/Event.java#L432-L470)

## ConvertedMap and ConvertedList

`ConvertedMap` extends `IdentityHashMap<String, Object>`: keys are compared by reference, not by `equals`. This is fast, but it means every key must be interned. `putInterned` and the field-reference parser route keys through `internStringForUseAsKey`, which keeps a cache of up to 10,000 interned strings in front of the JVM intern pool. `get` with a non-interned string has undefined behaviour, so code should go through `Event` and `FieldReference` rather than touching the map directly. `ConvertedList` is an `ArrayList` holding converted values.

Sources: [logstash-core/src/main/java/org/logstash/ConvertedMap.java:33-80](repo://logstash-core/src/main/java/org/logstash/ConvertedMap.java#L33-L80), [logstash-core/src/main/java/org/logstash/ConvertedList.java:31-60](repo://logstash-core/src/main/java/org/logstash/ConvertedList.java#L31-L60)

## Value conversion

Values are stored in Ruby form so Ruby plugins can read them without conversion. `Valuefier.convert` is applied on every `setField` and turns Java values into that form.

Sources: [logstash-core/src/main/java/org/logstash/Valuefier.java:53-101](repo://logstash-core/src/main/java/org/logstash/Valuefier.java#L53-L101), [logstash-core/src/main/java/org/logstash/Valuefier.java:126-200](repo://logstash-core/src/main/java/org/logstash/Valuefier.java#L126-L200)

| Java input | Stored as |
| --- | --- |
| `String` | `RubyString` |
| `Integer`, `Long`, `Short`, `Byte` | `RubyFixnum` |
| `Float`, `Double` | `RubyFloat` |
| `BigInteger`, `BigDecimal` | `RubyBignum`, `RubyBigDecimal` |
| `Boolean` | `RubyBoolean` |
| `Map`, `RubyHash` | `ConvertedMap` |
| `List`, `RubyArray` | `ConvertedList` |
| `Timestamp`, `Date`, Joda `DateTime`, `RubyTime`, `LocalDate`, `LocalDateTime`, `ZonedDateTime` | `RubyTimestamp` |
| `null` | `nil` |

Sources: [logstash-core/src/main/java/org/logstash/Valuefier.java:53-101](repo://logstash-core/src/main/java/org/logstash/Valuefier.java#L53-L101), [logstash-core/src/main/java/org/logstash/Valuefier.java:126-200](repo://logstash-core/src/main/java/org/logstash/Valuefier.java#L126-L200)

Values already in Ruby form pass through unchanged. Java objects wrapped in JRuby proxies are unwrapped and converted, and an unknown class falls back to the first registered supertype, which is then cached under the new class. A class with no match raises "Missing Valuefier handling".

Sources: [logstash-core/src/main/java/org/logstash/Valuefier.java:63-124](repo://logstash-core/src/main/java/org/logstash/Valuefier.java#L63-L124)

`Javafier.deep` goes the other way for Java callers: `Event.getField` returns plain Java strings, numbers, `HashMap`s and `ArrayList`s, with `nil` becoming `null`. `Rubyfier.deep` produces Ruby objects for `LogStash::Event#get` and `to_hash`. `Cloner.deep` copies nested maps and lists for `clone` and `toMap`.

Sources: [logstash-core/src/main/java/org/logstash/Javafier.java:37-83](repo://logstash-core/src/main/java/org/logstash/Javafier.java#L37-L83), [logstash-core/src/main/java/org/logstash/Event.java:186-206](repo://logstash-core/src/main/java/org/logstash/Event.java#L186-L206), [logstash-core/src/main/java/org/logstash/Rubyfier.java:45-105](repo://logstash-core/src/main/java/org/logstash/Rubyfier.java#L45-L105), [logstash-core/src/main/java/org/logstash/Cloner.java:34-45](repo://logstash-core/src/main/java/org/logstash/Cloner.java#L34-L45)

## Field access

Every accessor takes a string path, parses it into a cached `FieldReference`, and dispatches on its type.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:186-265](repo://logstash-core/src/main/java/org/logstash/Event.java#L186-L265), [logstash-core/src/main/java/org/logstash/Event.java:377-394](repo://logstash-core/src/main/java/org/logstash/Event.java#L377-L394)

| Reference type | `get` | `set` | `remove` |
| --- | --- | --- | --- |
| `[@metadata]` itself | The metadata map | Replace the metadata map | Empty the metadata map, return the old content |
| Under `[@metadata]` | Read from metadata | Write to metadata | Delete from metadata |
| Anything else | Read from data | Write to data | Delete from data |

Sources: [logstash-core/src/main/java/org/logstash/Event.java:186-265](repo://logstash-core/src/main/java/org/logstash/Event.java#L186-L265), [logstash-core/src/main/java/org/logstash/Event.java:377-394](repo://logstash-core/src/main/java/org/logstash/Event.java#L377-L394)

`setField` refuses to make `tags` anything but a string or a list of strings, and refuses nested paths under `tags` (`[tags][x]`), throwing `InvalidTagsTypeException`. Through the Ruby wrapper, setting `@timestamp` requires a `LogStash::Timestamp` and raises a `TypeError` otherwise.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:213-249](repo://logstash-core/src/main/java/org/logstash/Event.java#L213-L249), [logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java:113-125](repo://logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java#L113-L125)

## Tags

`tag(name)` creates `tags` as a one-element list when absent, turns a scalar `tags` into a list, and appends the tag only if it is not already present. Tags are therefore unique, in insertion order.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:472-537](repo://logstash-core/src/main/java/org/logstash/Event.java#L472-L537)

## Timestamp

`org.logstash.Timestamp` is an immutable wrapper around a `java.time.Instant`. It parses ISO-8601 strings, accepts epoch milliseconds, `Date` and Joda `DateTime`, and prints ISO-8601 in UTC with at least millisecond precision (`2024-01-01T00:00:00.000Z`) and more digits when the instant has them. Inside the event it is stored as a `RubyTimestamp`, the class Ruby code knows as `LogStash::Timestamp`.

Sources: [logstash-core/src/main/java/org/logstash/Timestamp.java:44-119](repo://logstash-core/src/main/java/org/logstash/Timestamp.java#L44-L119), [logstash-core/src/main/java/org/logstash/Event.java:157-184](repo://logstash-core/src/main/java/org/logstash/Event.java#L157-L184)

## Copying and combining

| Method | Behaviour |
| --- | --- |
| `clone()` | Deep copy of data and metadata into a new event (not cancelled) |
| `overwrite(other)` | Take the other event's data map, cancelled flag and timestamp |
| `append(other)` | Merge the other event's data into this one with `Util.mapMerge` |
| `toMap()` | Deep copy of the data as Java maps |

Sources: [logstash-core/src/main/java/org/logstash/Event.java:342-375](repo://logstash-core/src/main/java/org/logstash/Event.java#L342-L375), [logstash-core/src/main/java/org/logstash/Event.java:401-407](repo://logstash-core/src/main/java/org/logstash/Event.java#L401-L407)

`toString()` prints `<timestamp> <host> <message>`, substituting `%{host}` or `%{message}` when a field is missing; the `plain` codec uses it as the default line format.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:409-419](repo://logstash-core/src/main/java/org/logstash/Event.java#L409-L419)

## Serialization

Two encodings exist, for two purposes.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:267-340](repo://logstash-core/src/main/java/org/logstash/Event.java#L267-L340), [logstash-core/src/main/java/org/logstash/Event.java:539-552](repo://logstash-core/src/main/java/org/logstash/Event.java#L539-L552)

- **JSON** (`toJson`, `fromJson`): the data map only, without metadata. `fromJson` returns no event for blank input, one event for a JSON object, one event per element for a JSON array, and fails for anything else. It accepts an `EventFactory` so plugins can control event creation.
- **CBOR** (`serialize`, `deserialize`): a map with `DATA` and `META` keys, so metadata survives. The [[Persistent Queue]] and the [[Dead Letter Queue]] store events this way. Deserializing an empty byte array yields an empty event.

Sources: [logstash-core/src/main/java/org/logstash/Event.java:267-340](repo://logstash-core/src/main/java/org/logstash/Event.java#L267-L340), [logstash-core/src/main/java/org/logstash/Event.java:539-552](repo://logstash-core/src/main/java/org/logstash/Event.java#L539-L552)

## The Ruby face: LogStash::Event

`JrubyEventExtLibrary.RubyEvent` is the Ruby class `LogStash::Event`. It wraps one Java `Event` and exposes `get`, `set`, `include?`, `remove`, `cancel`, `uncancel`, `cancelled?`, `clone`, `overwrite`, `append`, `sprintf`, `tag`, `timestamp`, `timestamp=`, `to_hash`, `to_hash_with_metadata`, `to_json`, `to_s`, `to_java` and the class method `from_json`. The constructor accepts a Ruby hash or an existing Java event. `to_hash_with_metadata` adds `@metadata` to the copy when it is not empty.

Sources: [logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java:92-130](repo://logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java#L92-L130), [logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java:195-285](repo://logstash-core/src/main/java/org/logstash/ext/JrubyEventExtLibrary.java#L195-L285)

`logstash/event.rb` is an empty file kept for plugins that still `require` it; the class it once defined now comes from the Java extension.

Sources: [logstash-core/lib/logstash/event.rb:18-19](repo://logstash-core/lib/logstash/event.rb#L18-L19)
