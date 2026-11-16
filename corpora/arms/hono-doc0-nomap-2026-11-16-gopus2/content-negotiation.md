---
title: "Content Negotiation"
---
## Overview

Several headers share the `Accept` syntax: a comma-separated list of values, each with optional `;key=value` parameters and a `q` quality weight. Hono parses all of them with one function, `parseAccept` in `utils/accept`, and builds three features on it: the `accepts` helper (`hono/accepts`) for picking a supported value in a handler, the `languageDetector` middleware (`hono/language`) for choosing a user's language from several sources, and the encoding choice of the `compress` middleware described in [[Response and Observability Middleware]].

Sources: [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300), [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44)

## parseAccept

### Output

`parseAccept(header)` returns an array of `{ type, params, q }`, one per list entry, sorted by `q` from highest to lowest. An empty header returns an empty array. The parser is hand-written over character codes rather than built on regular expressions or `split`.

Sources: [src/utils/accept.ts:1-5](repo://src/utils/accept.ts#L1-L5), [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238)

```ts
parseAccept('text/html, application/json;q=0.9, */*;q=0.8')
// [
//   { type: 'text/html', params: {}, q: 1 },
//   { type: 'application/json', params: { q: '0.9' }, q: 0.9 },
//   { type: '*/*', params: { q: '0.8' }, q: 0.8 },
// ]
```

Sources: [src/utils/accept.ts:1-5](repo://src/utils/accept.ts#L1-L5), [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238)

### Parsing rules

Each entry starts with its type, up to the first `;` or `,`, trimmed of whitespace; an empty type drops the entry. Parameters follow as `key=value` pairs separated by `;`. A value may be quoted, with `\` escaping the next character inside quotes, so a quoted value can contain `;` or `,`. Malformed parameters, such as a key without `=`, a value starting with `=`, or characters after a closing quote, are skipped without losing the rest of the header.

Sources: [src/utils/accept.ts:30-64](repo://src/utils/accept.ts#L30-L64), [src/utils/accept.ts:66-157](repo://src/utils/accept.ts#L66-L157), [src/utils/accept.ts:159-209](repo://src/utils/accept.ts#L159-L209)

### Quality values

`parseQuality` turns the `q` parameter into a number. A missing or empty `q` counts as 1. `NaN` and `-Infinity` count as 0, `Infinity` as 1, and a non-numeric value or one outside 0–1 as 1.

Sources: [src/utils/accept.ts:240-266](repo://src/utils/accept.ts#L240-L266)

The sort only runs when an entry has a higher quality than the one before it, since headers usually arrive already sorted, as the source comment notes.

Sources: [src/utils/accept.ts:219-235](repo://src/utils/accept.ts#L219-L235)

## accepts helper

`accepts(c, { header, supports, default, match })` reads one `Accept`-style header and returns the value to use. Without the header it returns `default`. Otherwise it parses the header and calls `match`, by default `defaultMatch`, which takes the highest-quality entry whose type is exactly one of `supports`, or `default` when none is.

Sources: [src/helper/accepts/accepts.ts:11-49](repo://src/helper/accepts/accepts.ts#L11-L49)

```ts
import { accepts } from 'hono/accepts'

app.get('/users', (c) => {
  const lang = accepts(c, {
    header: 'Accept-Language',
    supports: ['en', 'zh'],
    default: 'en',
  })
  return c.text(lang)
})
```

Sources: [src/helper/accepts/accepts.ts:11-49](repo://src/helper/accepts/accepts.ts#L11-L49)

`defaultMatch` compares types exactly, so wildcards such as `*/*` or language ranges such as `en-US` against `en` do not match. A custom `match(accepts, config)` can implement other rules.

Sources: [src/helper/accepts/accepts.ts:21-25](repo://src/helper/accepts/accepts.ts#L21-L25)

## languageDetector

### Configuration

`languageDetector(options)` decides the request's language once, stores it as `c.get('language')`, and continues. Options are merged over the defaults, with `cookieOptions` merged separately so a partial override keeps the other cookie settings. `validateOptions` throws when the middleware is created if `fallbackLanguage` is not in `supportedLanguages`, if `lookupFromPathIndex` is negative, or if `order` names an unknown detector.

Sources: [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300), [src/middleware/language/language.ts:195-207](repo://src/middleware/language/language.ts#L195-L207)

| Option | Default | Meaning |
| --- | --- | --- |
| `order` | `['querystring', 'cookie', 'header']` | Detectors to try, in order; `path` is also available |
| `lookupQueryString` | `lang` | Query parameter name |
| `lookupCookie` | `language` | Cookie name, read and written |
| `lookupFromHeaderKey` | `accept-language` | Header to parse |
| `lookupFromPathIndex` | `0` | Path segment holding the language |
| `supportedLanguages` | `['en']` | Languages that may be returned |
| `fallbackLanguage` | `en` | Result when nothing is detected |
| `caches` | `['cookie']` | Where to remember a detected language, or `false` |
| `cookieOptions` | `SameSite=Strict`, `Secure`, `HttpOnly`, one year | Cookie attributes for the cache |
| `ignoreCase` | `true` | Compare codes case-insensitively |
| `convertDetectedLanguage` | none | Transform a raw code before matching |
| `debug` | `false` | Log detections and errors |

Sources: [src/middleware/language/language.ts:10-68](repo://src/middleware/language/language.ts#L10-L68)

### Detection

`detectLanguage` runs the detectors in `order` and stops at the first that returns a supported language; a detector that throws is skipped. The four detectors read the query parameter, the cookie, the header and the path segment. The header detector walks the parsed `Accept-Language` entries from highest quality down and returns the first that normalises to a supported language.

Sources: [src/middleware/language/language.ts:125-182](repo://src/middleware/language/language.ts#L125-L182), [src/middleware/language/language.ts:229-258](repo://src/middleware/language/language.ts#L229-L258)

### Normalisation

Every candidate goes through `normalizeLanguage`: it is trimmed, passed through `convertDetectedLanguage` if given, and compared with the supported list, case-insensitively by default. An exact match wins. Otherwise subtags are removed from the end one at a time, following RFC 4647 lookup, so `en-GB-oxendict` falls back to `en-GB` and then `en`. The returned value is the entry from `supportedLanguages`, with its original casing.

Sources: [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123)

### Caching

When a detector found a language and `caches` includes `cookie`, the result is written back with `setCookie` under `lookupCookie`, so later requests are answered by the cookie detector. The fallback language is never cached. Cookie errors are ignored, and logged when `debug` is on. [[Cookies]] describes `setCookie` and its options.

Sources: [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/middleware/language/language.ts:251-257](repo://src/middleware/language/language.ts#L251-L257)

```ts
import { languageDetector } from 'hono/language'

app.use(
  languageDetector({
    supportedLanguages: ['en', 'ja', 'ar'],
    fallbackLanguage: 'en',
  })
)

app.get('/', (c) => c.text(`Language: ${c.get('language')}`))
```

Sources: [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)
