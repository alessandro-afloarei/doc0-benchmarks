---
title: "Secret Store and Variable Substitution"
---
## Overview

Settings files and pipeline configs can refer to values held elsewhere with `${NAME}` or `${NAME:default}`. Logstash looks the name up first in its keystore, then in the process environment, then falls back to the default, and fails when none applies. This keeps passwords out of `logstash.yml`, `pipelines.yml` and `.conf` files. There are two resolvers: a Ruby one for settings and `pipelines.yml`, and a Java one for pipeline plugin arguments and conditionals. Both read the same keystore through the `SecretStore` interface, which `bin/logstash-keystore` manages.

Sources: [logstash-core/lib/logstash/util/substitution_variables.rb:23-83](repo://logstash-core/lib/logstash/util/substitution_variables.rb#L23-L83), [logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java:32-119](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java#L32-L119)

## Lookup order

| Step | Source | Result |
| --- | --- | --- |
| 1 | Keystore entry for the lower-cased name | Secret value |
| 2 | Environment variable with the exact name | Variable value |
| 3 | `:default` part of the placeholder | Default text |
| 4 | Nothing found | Error "Cannot evaluate `${NAME}`" |

Sources: [logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java:80-119](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java#L80-L119), [logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java:115-130](repo://logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java#L115-L130)

Names must match `[a-zA-Z_.][a-zA-Z0-9_.]*`: ASCII letters, digits, underscores and dots, not starting with a digit. `SecretIdentifier` lower-cases keys, so keystore names are case-insensitive while environment names are not.

Sources: [logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java:38-43](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java#L38-L43), [logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java:44-51](repo://logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java#L44-L51)

## Ruby resolver for settings

`LogStash::Util::SubstitutionVariables` is mixed into `LogStash::Settings` and `Source::MultiLocal`. `deep_replace` walks hashes and arrays and calls `replace_placeholders` on each leaf, which replaces every placeholder inside a string with `gsub`, so `"http://${HOST}:9200"` works. A `LogStash::Util::Password` is unwrapped, substituted and wrapped again so it stays masked.

Sources: [logstash-core/lib/logstash/util/substitution_variables.rb:31-83](repo://logstash-core/lib/logstash/util/substitution_variables.rb#L31-L83)

`Settings#from_yaml` calls `deep_replace` with `refine = true`. Refining strips one pair of enclosing single or double quotes from a substituted value, and turns a value written as `[a, "b"]` into an array with each element's quotes stripped. This lets an environment variable supply a list setting.

Sources: [logstash-core/lib/logstash/util/substitution_variables.rb:85-115](repo://logstash-core/lib/logstash/util/substitution_variables.rb#L85-L115), [logstash-core/lib/logstash/settings.rb:191-195](repo://logstash-core/lib/logstash/settings.rb#L191-L195)

The keystore is opened lazily, once per process, by a `LazySingleton` that calls `SecretStoreExt.getIfExists` with `keystore.file` and `keystore.classname`. A missing keystore simply skips step 1.

Sources: [logstash-core/lib/logstash/util/substitution_variables.rb:26-29](repo://logstash-core/lib/logstash/util/substitution_variables.rb#L26-L29), [logstash-core/lib/logstash/util/substitution_variables.rb:117-133](repo://logstash-core/lib/logstash/util/substitution_variables.rb#L117-L133), [logstash-core/src/main/java/org/logstash/secret/store/SecretStoreExt.java:57-66](repo://logstash-core/src/main/java/org/logstash/secret/store/SecretStoreExt.java#L57-L66)

## Java resolver for pipelines

`ConfigVariableExpander` is created by `AbstractPipelineExt` with the pipeline's secret store and the default environment provider, and handed to both the IR compiler and `CompiledPipeline`. Unlike the Ruby resolver, `expand` substitutes only a value that is entirely one placeholder (`m.matches()`); `"prefix-${X}"` passes through unchanged.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:283-289](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L283-L289), [logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java:80-91](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigVariableExpander.java#L80-L91)

Plugin arguments are expanded in `CompiledPipeline` when each plugin is built: `expandConfigVariables` walks maps and lists and expands each string. Values in conditionals go through `ExpressionSubstitution.substituteBoolExpression` when an `IfStatement` becomes a graph, with `keepSecrets` set: a keystore value is wrapped in a `SecretVariable`, whose `toString` prints `${NAME}`, so the secret does not appear in logs or the pipeline graph shown by the API.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:262-297](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L262-L297), [logstash-core/src/main/java/org/logstash/config/ir/imperative/IfStatement.java:115-122](repo://logstash-core/src/main/java/org/logstash/config/ir/imperative/IfStatement.java#L115-L122), [logstash-core/src/main/java/org/logstash/secret/SecretVariable.java:8-36](repo://logstash-core/src/main/java/org/logstash/secret/SecretVariable.java#L8-L36)

`jvm.options` has a third, simpler `${VAR:default}` resolver that reads only the environment, described on [[Startup and the Runner]].

Sources: [tools/jvm-options-parser/src/main/java/org/logstash/launchers/JvmOptionsParser.java:408-423](repo://tools/jvm-options-parser/src/main/java/org/logstash/launchers/JvmOptionsParser.java#L408-L423)

## The SecretStore interface

`SecretStore` defines `create`, `load`, `exists` and `delete` for the store itself, and `list`, `persistSecret`, `purgeSecret`, `retrieveSecret` and `containsSecret` for entries keyed by `SecretIdentifier`. Secrets travel as `byte[]` so callers can clear them after use. Every lifecycle method takes a `SecureConfig`, a map of `char[]` values that is cleared once read.

Sources: [logstash-core/src/main/java/org/logstash/secret/store/SecretStore.java:33-104](repo://logstash-core/src/main/java/org/logstash/secret/store/SecretStore.java#L33-L104)

`SecretStoreFactory` picks the implementation class from `keystore.classname` in the `SecureConfig` (default `org.logstash.secret.store.backend.JavaKeyStore`), loads it by reflection, and adds `keystore.pass` from the `LOGSTASH_KEYSTORE_PASS` environment variable when it is set. A class that cannot be found or constructed raises an exception pointing at `keystore.classname`.

Sources: [logstash-core/src/main/java/org/logstash/secret/store/SecretStoreFactory.java:35-75](repo://logstash-core/src/main/java/org/logstash/secret/store/SecretStoreFactory.java#L35-L75), [logstash-core/src/main/java/org/logstash/secret/store/SecretStoreFactory.java:118-163](repo://logstash-core/src/main/java/org/logstash/secret/store/SecretStoreFactory.java#L118-L163)

Entries are stored under the URN `urn:logstash:secret:v1:<key>`.

Sources: [logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java:94-108](repo://logstash-core/src/main/java/org/logstash/secret/SecretIdentifier.java#L94-L108)

## The Java keystore backend

`JavaKeyStore` is a PKCS12 file at `keystore.file` (by default `config/logstash.keystore`, or next to `logstash.yml` when `--path.settings` is given). Each secret is a `SecretKeyEntry` made by a `PBE` key factory from the base64-encoded secret. `create` refuses to overwrite an existing file, writes a marker entry `keystore.seed` so that `load` can tell a Logstash keystore from any other PKCS12 file, and sets POSIX permissions `rw-r--r--`.

Sources: [logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java:77-130](repo://logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java#L77-L130), [logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java:276-314](repo://logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java#L276-L314)

The keystore password comes from `LOGSTASH_KEYSTORE_PASS` when set; an empty value is rejected. Without it, `create` generates 32 random bytes and the password is stored obfuscated at the end of the file, where `getKeyStorePassword` reads it back from a trailing length byte. Setting the variable therefore protects the keystore with a secret that is not on disk; without it, the file only resists casual reading.

Sources: [logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java:177-230](repo://logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java#L177-L230)

`persistSecret` and the other entry operations reload the file under a lock before changing it, because another process (the CLI while Logstash runs, for instance) may have modified it. A wrong password surfaces as `AccessException` "Please verify correct file permissions and keystore password".

Sources: [logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java:316-345](repo://logstash-core/src/main/java/org/logstash/secret/store/backend/JavaKeyStore.java#L316-L345)

## bin/logstash-keystore

The script runs `lib/secretstore/cli.rb` on the vendored JRuby. The Ruby wrapper strips `--path.settings DIR` from the arguments, loads `logstash.yml` from that directory to learn `keystore.file` and `keystore.classname`, and passes the rest to the Java `SecretStoreCli`.

Sources: [bin/logstash-keystore:1-10](repo://bin/logstash-keystore#L1-L10), [lib/secretstore/cli.rb:18-58](repo://lib/secretstore/cli.rb#L18-L58)

| Command | Behaviour |
| --- | --- |
| `create` | Create the keystore, asking before overwriting an existing one |
| `list` | Print the sorted keys, never the values, hiding the `keystore.seed` marker |
| `add KEY...` | Prompt for each value; reject invalid key names, empty and non-ASCII values; ask before overwriting |
| `remove KEY...` | Purge each key, reporting keys that do not exist |

Sources: [logstash-core/src/main/java/org/logstash/secret/cli/SecretStoreCli.java:159-165](repo://logstash-core/src/main/java/org/logstash/secret/cli/SecretStoreCli.java#L159-L165), [logstash-core/src/main/java/org/logstash/secret/cli/SecretStoreCli.java:224-326](repo://logstash-core/src/main/java/org/logstash/secret/cli/SecretStoreCli.java#L224-L326)

## Password policies

A related set of classes checks password strength rather than storing secrets. `PasswordValidator` builds one validator per requested policy (empty string, minimum length, upper case, lower case, digit, symbol) and joins their failure reasons. The HTTP API uses it through `Setting::ValidatedPassword` for `api.auth.basic.password`: the `api.auth.basic.password_policy.*` settings choose the rules, and `mode` `WARN` logs a weak password while `ERROR` refuses to start ([[Monitoring API]]).

Sources: [logstash-core/src/main/java/org/logstash/secret/password/PasswordValidator.java:38-91](repo://logstash-core/src/main/java/org/logstash/secret/password/PasswordValidator.java#L38-L91), [logstash-core/lib/logstash/settings.rb:506-547](repo://logstash-core/lib/logstash/settings.rb#L506-L547), [logstash-core/lib/logstash/environment.rb:72-80](repo://logstash-core/lib/logstash/environment.rb#L72-L80)
