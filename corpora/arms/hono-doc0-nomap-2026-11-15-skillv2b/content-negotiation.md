---
title: "Accepts and Language Detection"
---
## Overview

Content negotiation picks one representation of a resource from what the client says it accepts. Hono has one parser for `Accept`-style headers (`parseAccept` in `src/utils/accept.ts`) and three consumers of it: the `accepts` helper (`hono/accepts`) for any `Accept-*` header, the `languageDetector` middleware (`hono/language`) for choosing a locale, and the compress middleware for choosing an encoding ([[Cache, ETag, Compression and Pretty JSON]]).

Sources: [src/utils/accept.ts:211-238](repo://src/utils/accept.ts#L211-L238), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)

## Parsing Accept headers

`parseAccept(header)` returns a list of `{ type, params, q }` entries ordered by descending quality. It is a hand-written character scanner rather than a chain of `split` calls, which lets it follow the RFC grammar: quoted parameter values with backslash escapes, whitespace around `;`, `,` and `=`, and recovery from malformed entries.

Sources: [src/utils/accept.ts:1-5](repo://src/utils/accept.ts#L1-L5), [src/utils/accept.ts:66-157](repo://src/utils/accept.ts#L66-L157)

| Input | Handling |
| --- | --- |
| Entry with an empty type (`;q=0.5`) | Skipped up to the next comma, respecting quotes |
| Parameter without a value, or a doubled `=` | Dropped; parsing continues with the next parameter |
| Missing or empty `q` | `1` |
| `q` outside `0..1`, or not a number | `1` (`NaN` and `-Infinity` give `0`) |

Sources: [src/utils/accept.ts:159-209](repo://src/utils/accept.ts#L159-L209), [src/utils/accept.ts:240-266](repo://src/utils/accept.ts#L240-L266)

Sorting is skipped when the values already arrive in descending quality, the common case for browser headers such as `text/html, application/json;q=0.9, */*;q=0.8`. `Array.prototype.sort` is stable, so entries of equal quality keep their header order.

Sources: [src/utils/accept.ts:216-237](repo://src/utils/accept.ts#L216-L237)

## The accepts helper

`accepts(c, { header, supports, default, match? })` reads the named header (`Accept`, `Accept-Language`, `Accept-Encoding`, ...). Without the header it returns `default`. Otherwise `defaultMatch` returns the first parsed type, in quality order, that appears in `supports`, or `default` when none does. A custom `match(accepts, config)` can implement wildcards or language prefixes.

Sources: [src/helper/accepts/accepts.ts:11-49](repo://src/helper/accepts/accepts.ts#L11-L49)

```ts
import { accepts } from 'hono/accepts'

app.get('/report', (c) => {
  const type = accepts(c, {
    header: 'Accept',
    supports: ['application/json', 'text/csv'],
    default: 'application/json',
  })
  return type === 'text/csv' ? c.body(toCsv(data), 200, { 'Content-Type': type }) : c.json(data)
})
```

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

The default matcher compares strings exactly: `*/*` or `text/*` in the header does not match a supported type, and such a request falls back to `default`.

Sources: [src/helper/accepts/accepts.ts:21-25](repo://src/helper/accepts/accepts.ts#L21-L25)

## languageDetector

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `supportedLanguages` | `['en']` | Languages the app serves; must include `fallbackLanguage` |
| `fallbackLanguage` | `en` | Used when no detector finds a supported language |
| `order` | `['querystring', 'cookie', 'header']` | Detectors to try; `path` is also available |
| `lookupQueryString` | `lang` | Query parameter name |
| `lookupCookie` | `language` | Cookie name, read and written |
| `lookupFromHeaderKey` | `accept-language` | Header name |
| `lookupFromPathIndex` | `0` | Which path segment holds the language |
| `caches` | `['cookie']` | Store the detected language in the cookie; `false` disables |
| `cookieOptions` | `Strict`, `secure`, `httpOnly`, one year | Merged with user values |
| `ignoreCase` | `true` | Case-insensitive comparison |
| `convertDetectedLanguage` | | Maps a raw value before matching, such as `en_US` to `en-US` |
| `debug` | `false` | Logs which detector matched and detector errors |

Sources: [src/middleware/language/language.ts:13-68](repo://src/middleware/language/language.ts#L13-L68)

`validateOptions` runs when the middleware is created and throws if the fallback is not supported, the path index is negative, or `order` names an unknown detector, so configuration mistakes fail at start-up.

Sources: [src/middleware/language/language.ts:195-207](repo://src/middleware/language/language.ts#L195-L207)

### Detection flow

For each request, `detectLanguage` runs the detectors in `order` and stops at the first that returns a supported language. A detector that throws is skipped. The result, or the fallback, is stored as `c.get('language')`, typed through `ContextVariableMap`. Only a detected language is written to the cookie; the fallback never is, so a later request with a better header can still be detected.

Sources: [src/middleware/language/language.ts:229-258](repo://src/middleware/language/language.ts#L229-L258), [src/middleware/language/index.ts:1-12](repo://src/middleware/language/index.ts#L1-L12)

| Detector | Reads |
| --- | --- |
| `querystring` | `c.req.query(lookupQueryString)` |
| `cookie` | The `lookupCookie` cookie |
| `header` | Every `Accept-Language` entry in quality order, until one normalises to a supported language |
| `path` | Segment `lookupFromPathIndex` of the URL path, so `/fr/about` gives `fr` |

Sources: [src/middleware/language/language.ts:128-182](repo://src/middleware/language/language.ts#L128-L182)

### Normalisation

`normalizeLanguage` trims the value, applies `convertDetectedLanguage`, and compares it with `supportedLanguages` (case-insensitively by default). An exact match returns the supported spelling. Otherwise it drops subtags from the right, so `en-GB-oxendict` tries `en-GB` and then `en`. Anything else is not a match, so values outside the supported list never reach the app.

Sources: [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123)

The cookie is written with the cookie helper ([[Cookies]]), which means the response of every request where detection succeeded carries a `Set-Cookie` header. Responses that should be shared by a cache need `caches: false`, because the cache middleware refuses to store responses that set cookies.

Sources: [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/middleware/cache/index.ts:27-35](repo://src/middleware/cache/index.ts#L27-L35)
