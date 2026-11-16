---
title: "Exposing Native Code to JavaScript"
---
## Overview

A native module is a C++ class that Electron wraps for JavaScript, plus a binding that exports the factory functions. `NativeImage` is the example used here: it is a class in `shell/common/api`, its methods are attached to a v8 template, its factory functions are set on an exports object, and the JavaScript layer re-exports that object as `nativeImage`.

Sources: [shell/common/api/electron_api_native_image.h:48](repo://shell/common/api/electron_api_native_image.h#L48), [shell/common/api/electron_api_native_image.cc:575-604](repo://shell/common/api/electron_api_native_image.cc#L575-L604), [shell/common/api/electron_api_native_image.cc:621-645](repo://shell/common/api/electron_api_native_image.cc#L621-L645), [lib/common/api/native-image.ts:1-3](repo://lib/common/api/native-image.ts#L1-L3)

## Wrapping a C++ object

`NativeImage` derives from `gin_helper::DeprecatedWrappable<NativeImage>`. The base class creates the v8 wrapper on demand through `GetWrapper`, using the static `kWrapperInfo` of the subclass. The header's comment says the class is copied from a Chromium change and will be removed under a tracked Electron issue.

Sources: [shell/common/api/electron_api_native_image.h:48](repo://shell/common/api/electron_api_native_image.h#L48), [shell/common/gin_helper/wrappable.h:78-95](repo://shell/common/gin_helper/wrappable.h#L78-L95)

Factory methods such as `CreateEmpty` and `Create` return `gin_helper::Handle<NativeImage>`, the handle type that a wrapped object is returned to JavaScript through.

Sources: [shell/common/api/electron_api_native_image.h:60-62](repo://shell/common/api/electron_api_native_image.h#L60-L62)

## Building the prototype

`GetObjectTemplateBuilder` looks up the function template for `kWrapperInfo` and creates it once per isolate. It then passes the class name and the instance template to `gin::ObjectTemplateBuilder`, which attaches each method with `SetMethod` and each accessor with `SetProperty`. The `isMacTemplateImage` property reuses the template-image getter and setter.

Sources: [shell/common/api/electron_api_native_image.cc:575-586](repo://shell/common/api/electron_api_native_image.cc#L575-L586), [shell/common/api/electron_api_native_image.cc:586-604](repo://shell/common/api/electron_api_native_image.cc#L586-L604)

`gin_helper::ObjectTemplateBuilder` is a variant that adds to an existing prototype template rather than creating one. Its header states that it uses `gin_helper::CreateFunctionTemplate` so that its methods accept `gin_helper` types. `NativeImage` calls `gin::ObjectTemplateBuilder` directly and does not use this variant.

Sources: [shell/common/gin_helper/object_template_builder.h:12-27](repo://shell/common/gin_helper/object_template_builder.h#L12-L27)

## Exporting factory functions

`Initialize` wraps the binding's exports object in a `gin_helper::Dictionary`, creates an empty dictionary, and sets it on the exports as `nativeImage`. It then adds each factory to that dictionary with `SetMethod`. `createThumbnailFromPath` is left out on Linux. `NODE_LINKED_BINDING_CONTEXT_AWARE` registers the binding under the name `electron_common_native_image`, and the JavaScript side reads `nativeImage` from that binding.

Sources: [shell/common/api/electron_api_native_image.cc:621-644](repo://shell/common/api/electron_api_native_image.cc#L621-L644), [shell/common/api/electron_api_native_image.cc:645](repo://shell/common/api/electron_api_native_image.cc#L645), [lib/common/api/native-image.ts:1-3](repo://lib/common/api/native-image.ts#L1-L3)

## Reading option objects

`gin_helper::Dictionary` derives from `gin::Dictionary`. `Get` converts the key with `gin::ConvertToV8`, reads the property from the option object, and writes the value into the output. `ValueOrDefault` wraps `Get` and returns the default when the key is missing.

Sources: [shell/common/gin_helper/dictionary.h:24](repo://shell/common/gin_helper/dictionary.h#L24), [shell/common/gin_helper/dictionary.h:40-48](repo://shell/common/gin_helper/dictionary.h#L40-L48), [shell/common/gin_helper/dictionary.h:70-76](repo://shell/common/gin_helper/dictionary.h#L70-L76), [shell/common/gin_helper/dictionary.h:203-208](repo://shell/common/gin_helper/dictionary.h#L203-L208)

`AddRepresentation` shows the pattern: it takes `width`, `height` and `scaleFactor` with `ValueOrDefault`, then reads either a `buffer` or a `dataURL` with `Get`, and only one of them is used.

Sources: [shell/common/api/electron_api_native_image.cc:384-398](repo://shell/common/api/electron_api_native_image.cc#L384-L398)

Not every method reads a `Dictionary`. `Resize` takes a `base::Value::Dict` and the `gin::Arguments` pointer, so a method can choose the option type that fits its signature.

Sources: [shell/common/api/electron_api_native_image.cc:341-350](repo://shell/common/api/electron_api_native_image.cc#L341-L350)

## Returning results

`gin_helper::PromiseBase` wraps a `v8::Promise::Resolver`. It is move-only and, by its comment, must be destroyed on the thread that created it. Its `Reject` and `RejectWithErrorMessage` methods fail the promise with a value or with a message.

Sources: [shell/common/gin_helper/promise.h:20-50](repo://shell/common/gin_helper/promise.h#L20-L50)

A new binding also needs an entry in one of the module lists before JavaScript can reach it, as [[Module Registration]] describes. Those lists name each module's loader, and `nativeImage` is one of them, loaded from the binding above.

Sources: [lib/browser/api/module-list.ts:3-8](repo://lib/browser/api/module-list.ts#L3-L8), [lib/common/api/module-list.ts:2-5](repo://lib/common/api/module-list.ts#L2-L5)
