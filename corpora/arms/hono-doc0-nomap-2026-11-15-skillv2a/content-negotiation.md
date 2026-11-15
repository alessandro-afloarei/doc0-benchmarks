---
title: "Content Negotiation and Language"
---
## Overview

Clients state preferences in `Accept`-style headers: media types in `Accept`, encodings in `Accept-Encoding`, languages in `Accept-Language`. Each is a comma-separated list of values with optional parameters and a quality `q`. Hono parses all of them with one function, `parseAccept` in `utils/accept.ts`, and builds three consumers on it: the `accepts` helper for picking a value in a handler, the `languageDetector` middleware for choosing a locale, and the encoding choice inside `compress` (see [[ETag, Cache and Compression]]).

Sources: [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/middleware/language/language.ts:74-76](repo://src/middleware/language/language.ts#L74-L76), [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44)

## Parsing Accept headers

### Output

`parseAccept(header)` returns an array of `{ type, params, q }`, sorted by descending `q`. Parsing an empty header returns `[]`.

Sources: [src/utils/accept.ts:1-5](repo://src/utils/accept.ts#L1-L5), [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238)

```ts
parseAccept('text/html, application/json;q=0.9, */*;q=0.8')
// [
//   { type: 'text/html', params: {}, q: 1 },
//   { type: 'application/json', params: { q: '0.9' }, q: 0.9 },
//   { type: '*/*', params: { q: '0.8' }, q: 0.8 },
// ]
```

Sources: [src/utils/accept.ts:159-209](repo://src/utils/accept.ts#L159-L209)

### How it parses

The parser is a single forward scan with character codes instead of `split` and regular expressions. `getNextAcceptValue` reads a type up to `;` or `,`, then `getNextParam` reads `key=value` pairs until the next `,`. Quoted values may contain `,`, `;` and backslash escapes, and whitespace around keys and values is trimmed.

Sources: [src/utils/accept.ts:66-157](repo://src/utils/accept.ts#L66-L157), [src/utils/accept.ts:159-209](repo://src/utils/accept.ts#L159-L209)

Malformed input is skipped rather than rejected: an empty type, an empty parameter, a parameter whose value starts with `=`, or junk after a closing quote drop only that piece, and parsing resumes at the next `;` or `,`. A hostile header therefore cannot make a handler throw.

Sources: [src/utils/accept.ts:30-64](repo://src/utils/accept.ts#L30-L64), [src/utils/accept.ts:83-102](repo://src/utils/accept.ts#L83-L102)

`parseQuality` turns the `q` parameter into a number. A missing or empty value, an unparseable value, `Infinity`, or a value outside `[0, 1]` counts as `1`; `NaN` and `-Infinity` count as `0`. Most clients already send values in descending quality, so the array is sorted only when a later value has a higher `q` than the one before it.

Sources: [src/utils/accept.ts:219-235](repo://src/utils/accept.ts#L219-L235), [src/utils/accept.ts:240-266](repo://src/utils/accept.ts#L240-L266)

## The accepts helper

`accepts(c, { header, supports, default, match })` from `hono/accepts` reads one header and returns the value the app should use:

Sources: [src/helper/accepts/accepts.ts:11-19](repo://src/helper/accepts/accepts.ts#L11-L19), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

```ts
import { accepts } from 'hono/accepts'

app.get('/data', (c) => {
  const type = accepts(c, {
    header: 'Accept',
    supports: ['application/json', 'text/csv'],
    default: 'application/json',
  })
  return type === 'text/csv' ? c.text(toCsv(data)) : c.json(data)
})
```

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

With no header it returns `default`. Otherwise `defaultMatch` sorts the parsed values by quality and returns the first whose `type` is literally in `supports`, or `default` when none is. Wildcards such as `*/*` or `text/*` are not expanded, and a supported value sent with `q=0` can still be chosen. A custom `match(accepts, config)` handles either case, for example by treating `*/*` as the default and filtering out `q=0`.

Sources: [src/helper/accepts/accepts.ts:21-25](repo://src/helper/accepts/accepts.ts#L21-L25), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

## languageDetector

### Detection order

`languageDetector(options)` from `hono/language` decides the request's language once and stores it as `c.var.language`, typed through `ContextVariableMap`. It tries detectors in `order` and stops at the first that returns a supported language:

Sources: [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300), [src/middleware/language/index.ts:1-12](repo://src/middleware/language/index.ts#L1-L12)

| Detector | Reads | Option |
| --- | --- | --- |
| `querystring` | `?lang=de` | `lookupQueryString` (`lang`) |
| `cookie` | The `language` cookie | `lookupCookie` (`language`) |
| `header` | Each `Accept-Language` value, best quality first | `lookupFromHeaderKey` (`accept-language`) |
| `path` | A path segment, such as `de` in `/de/about` | `lookupFromPathIndex` (`0`) |

Sources: [src/middleware/language/language.ts:128-182](repo://src/middleware/language/language.ts#L128-L182)

The default `order` is `querystring`, `cookie`, `header`; `path` must be added explicitly. A detector that throws is skipped, and with `debug: true` the failure and the winning detector are logged.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:229-249](repo://src/middleware/language/language.ts#L229-L249)

### Matching supported languages

Every candidate goes through `normalizeLanguage`: it is trimmed, passed to `convertDetectedLanguage` if given (for example to map `en_US` to `en-US`), and compared case-insensitively unless `ignoreCase: false`. An exact match wins. Otherwise the tag is truncated from the right, one subtag at a time, as in RFC 4647 lookup, so `de-AT-1996` tries `de-AT` and then `de`. The returned value is the entry from `supportedLanguages`, with its original casing.

Sources: [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123)

When no detector matches, `fallbackLanguage` (`en`) is used. Setup fails if the fallback is not among `supportedLanguages`, if the path index is negative, or if `order` names an unknown detector.

Sources: [src/middleware/language/language.ts:195-207](repo://src/middleware/language/language.ts#L195-L207), [src/middleware/language/language.ts:251-257](repo://src/middleware/language/language.ts#L251-L257)

### Remembering the choice

With `caches: ['cookie']`, the default, a language found by a detector is written back to the `lookupCookie` cookie, so the next request finds it through the `cookie` detector. The fallback is not cached. Cookie attributes come from `cookieOptions`, which defaults to `SameSite=Strict`, `Secure`, `HttpOnly` and a one-year `Max-Age`; options passed in are merged over these defaults. `caches: false` disables the cookie. Writing uses `setCookie` from [[Cookies]], and a write error is swallowed (logged in `debug` mode).

Sources: [src/middleware/language/language.ts:57-66](repo://src/middleware/language/language.ts#L57-L66), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/middleware/language/language.ts:253-255](repo://src/middleware/language/language.ts#L253-L255), [src/middleware/language/language.ts:284-291](repo://src/middleware/language/language.ts#L284-L291)

```ts
import { languageDetector } from 'hono/language'

app.use(
  languageDetector({
    supportedLanguages: ['en', 'de', 'ja'],
    fallbackLanguage: 'en',
  })
)
app.get('/', (c) => c.text(messages[c.get('language')].hello))
```

Sources: [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)
