---
title: "Engine Helper Functions"
---
## Overview

Inside an asset's `check`, `map` and `normalize` stages, every entry has the shape `target.field: value`. When the value is a literal, the engine compares (in a check) or assigns (in a map). When it is a call such as `starts_with('ssh')` or `kvdb_get(users, $user.id)`, the engine runs a helper function. Helpers are the engine's vocabulary: about a hundred operations registered by name in the builder's registry, each with a type validator and a builder that produces the runtime operation. This page explains how a helper entry is parsed and compiled, and lists the families; how stages fit together is on [[Engine Assets, Policies and the Builder]].

Sources: [src/engine/source/builder/src/register.hpp:46-160](repo://src/engine/source/builder/src/register.hpp#L46-L160), [src/engine/source/builder/src/builders/baseHelper.cpp:191-235](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L191-L235)

## The three kinds

Every registered helper is an `OpBuilderEntry`: a validation token (what type the target field must have) plus a builder of one of three kinds.

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:175-184](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L175-L184)

| Kind | Produces | Used in | Example |
| --- | --- | --- | --- |
| Filter | Pass or fail; never changes the event | `check` | `int_greater(5)` |
| Map | A value that is written to the target field | `map`, `normalize` | `downcase($user.name)` |
| Transform | Any change to the event, including the target | `map`, `normalize` | `array_append(foo)`, `parse_json($message)` |

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:119-184](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L119-L184)

`baseHelperBuilder` refuses a filter used in a map stage or a map/transform used in a check, with "is not a filter builder" or "is not a map/transform builder". Internally all three are normalized into transforms: `mapToTransform` checks the allowed fields for the target, runs the map operation and writes its result with `event->set`; `filterToTransform` turns a filter result into a success or failure that leaves the event untouched.

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:222-240](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L222-L240), [src/engine/source/builder/src/builders/baseHelper.cpp:119-174](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L119-L174)

## Writing a helper call

### Syntax

The helper parser (`parsers::getHelperParser`) accepts `name(arg1, arg2, ...)`. Each argument is one of:

Sources: [src/engine/source/builder/src/builders/helperParser.hpp:33-60](repo://src/engine/source/builder/src/builders/helperParser.hpp#L33-L60)

- a reference, `$field.path`, read from the event at run time;
- a quoted string, `'text, with commas'`, always a string;
- a JSON value (number, `true`, `null`, `[...]`, `{...}`) or a bare string.

Sources: [src/engine/source/builder/src/builders/helperParser.hpp:52-160](repo://src/engine/source/builder/src/builders/helperParser.hpp#L52-L160), [src/engine/source/builder/src/syntax.hpp:53-70](repo://src/engine/source/builder/src/syntax.hpp#L53-L70)

A value that is not a call is shorthand. In a check, `field: value` means `filter(value)`, an equality test; in a map, it means `map(value)`, an assignment. A string starting with `$` is a reference, and `\$` escapes it as a literal dollar. An array value expands into one entry per element (`field.0`, `field.1`, ...) joined with `And` in a check and `Chain` in a map.

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:300-372](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L300-L372), [src/engine/source/builder/src/builders/baseHelper.cpp:372-390](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L372-L390)

```yaml
check:
  - event.code: "4625"                     # filter("4625")
  - source.ip: ip_cidr_match(10.0.0.0, 8)  # filter helper
map:
  - user.name: downcase($user.name)        # map helper
  - related.ip: array_append($source.ip)   # transform helper
  - event.kind: event                      # map("event")
```

Sources: [src/engine/source/builder/src/register.hpp:46-160](repo://src/engine/source/builder/src/register.hpp#L46-L160)

### Compilation

For one entry `baseHelperBuilder` does the following: replaces arguments that name a `definitions` entry with the definition's value; looks the helper up in the registry; checks the kind against the stage; resolves the validation token (some helpers compute it from their arguments); names the operation `<field>: <helper>(<args>)` for traces; and builds the transform. Any error is rethrown as "Failed to build operation ...", which is what the catalog API returns when an asset is rejected.

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:191-285](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L191-L285)

## Catalogue

### Filters

| Family | Helpers |
| --- | --- |
| Presence and type | `exists`, `not_exists`, `is_string`, `is_number`, `is_boolean`, `is_array`, `is_object`, `is_null` and their `is_not_*` forms |
| Equality and order | `filter` (default), `int_equal`, `int_greater`, `int_less` (and `_or_equal`, `_not_equal`), `number_*`, `string_equal`, `string_greater`, `string_less` and variants |
| Strings | `starts_with`, `ends_with`, `contains`, `regex_match`, `regex_not_match` |
| Arrays and keys | `array_contains`, `array_contains_any`, `array_not_contains`, `array_not_contains_any`, `keys_exist_in_list`, `match_value`, `exists_key_in` |
| Network | `ip_cidr_match`, `is_public_ip`, `is_ipv4`, `is_ipv6` |
| Bits and session | `binary_and`, `is_test_session` |
| KVDB | `kvdb_match`, `kvdb_not_match` |

Sources: [src/engine/source/builder/src/register.hpp:46-160](repo://src/engine/source/builder/src/register.hpp#L46-L160), [src/engine/source/builder/src/register.hpp:160-178](repo://src/engine/source/builder/src/register.hpp#L160-L178), [src/engine/source/builder/src/register.hpp:317-341](repo://src/engine/source/builder/src/register.hpp#L317-L341)

### Maps

| Family | Helpers |
| --- | --- |
| Values | `map` (default), `to_string`, `hex_to_number`, `ip_version`, `join`, `decode_base16`, `regex_extract` |
| Arithmetic | `int_calculate`, `float_calculate` |
| Strings | `downcase`, `upcase` |
| Hashes | `sha1` |
| Time | `system_epoch`, `date_from_epoch`, `get_date` |

Sources: [src/engine/source/builder/src/register.hpp:179-218](repo://src/engine/source/builder/src/register.hpp#L179-L218)

### Transforms

| Family | Helpers |
| --- | --- |
| Arrays | `array_append`, `array_append_any`, `array_append_unique`, `array_append_unique_any`, `split` |
| Fields | `delete`, `rename`, `merge`, `merge_recursive`, `erase_custom_fields` |
| Strings | `concat`, `concat_any`, `replace`, `trim`, `to_int` |
| Definitions | `get_key_in`, `merge_key_in`, `merge_recursive_key_in` (look up a key in a definition object) |
| Geolocation | `geoip`, `as` (MaxMind city and ASN lookups) |
| Parsing | `parse_bool`, `parse_long`, `parse_double`, `parse_date`, `parse_ip`, `parse_uri`, `parse_useragent`, `parse_fqdn`, `parse_file`, `parse_json`, `parse_xml`, `parse_csv`, `parse_dsv`, `parse_key_value`, `parse_quoted`, `parse_between`, `parse_alphanumeric`, and others |
| KVDB | `kvdb_get`, `kvdb_get_merge`, `kvdb_get_merge_recursive`, `kvdb_get_array`, `kvdb_decode_bitmask` |

Sources: [src/engine/source/builder/src/register.hpp:219-262](repo://src/engine/source/builder/src/register.hpp#L219-L262), [src/engine/source/builder/src/register.hpp:263-340](repo://src/engine/source/builder/src/register.hpp#L263-L340)

The `parse_*` helpers run one HLP parser on a single field, which is handy inside `normalize` when a value needs parsing after the main parse stage; the parsers themselves are described on [[Log Parsing (HLP and Logpar)]]. The KVDB and geolocation helpers read databases managed as described on [[Engine Store, KVDB, Schema and Geo]]. The Windows SID description helper is present in the code but its registration is commented out in this version.

Sources: [src/engine/source/builder/src/register.hpp:263-316](repo://src/engine/source/builder/src/register.hpp#L263-L316), [src/engine/source/builder/src/register.hpp:342-347](repo://src/engine/source/builder/src/register.hpp#L342-L347)

## Choosing a helper

Use a filter whenever the asset should stop when a condition fails: a decoder's `check` decides whether it applies at all, and a failed check means the event moves on to the decoder's siblings. Use a map to compute a value for one field; the allowed-fields check applies to that field. Use a transform when the operation needs to touch more than the target, such as merging an object, deleting fields or appending to arrays. Within `normalize`, a failing helper only fails its own block, because the blocks are chained.

Sources: [src/engine/source/builder/src/builders/baseHelper.cpp:141-174](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L141-L174), [src/engine/source/builder/src/builders/stage/normalize.cpp:120-131](repo://src/engine/source/builder/src/builders/stage/normalize.cpp#L120-L131)
