---
title: "Motion"
---
## Overview

`svelte/motion` animates values rather than elements: a number, date, array or object moves towards a target over successive animation frames, and anything that reads it updates each frame. It offers two models, `Spring` (physics: stiffness and damping) and `Tween` (fixed duration with an easing curve), each in two forms: the Svelte 5 classes, whose `current` and `target` are signals, and the older `spring()` and `tweened()` functions, which return stores. All four run on the shared `requestAnimationFrame` loop in `internal/client/loop.js` ([[Transitions and Animations]]). The module also exports `prefersReducedMotion`.

Sources: [packages/svelte/src/motion/index.js:1-32](repo://packages/svelte/src/motion/index.js#L1-L32), [packages/svelte/src/internal/client/loop.js:26-48](repo://packages/svelte/src/internal/client/loop.js#L26-L48)

`prefersReducedMotion` is a `MediaQuery` for `(prefers-reduced-motion: reduce)` whose `current` updates when the user changes the setting ([[Reactive Built-ins]]); code can check it to skip or shorten motion.

Sources: [packages/svelte/src/motion/index.js:6-32](repo://packages/svelte/src/motion/index.js#L6-L32)

## Spring

### State and options

`new Spring(value, { stiffness, damping, precision })` holds five states: `current`, `target`, and the three options (stiffness and damping clamped to `[0, 1]`, defaults `0.15`, `0.8`, `0.01`). Reading `spring.current` in a template or effect subscribes to it; `spring.target = v` or `spring.set(v)` starts motion. `Spring.of(() => value)` creates a spring that follows a reactive expression by calling `set` from a render effect.

Sources: [packages/svelte/src/motion/spring.js:155-238](repo://packages/svelte/src/motion/spring.js#L155-L238), [packages/svelte/src/motion/spring.js:325-369](repo://packages/svelte/src/motion/spring.js#L325-L369)

### Each frame

`#update(value)` sets the target and, if no task is running, starts a `loop` task. On every frame the task:

Sources: [packages/svelte/src/motion/spring.js:240-285](repo://packages/svelte/src/motion/spring.js#L240-L285)

1. Clamps the elapsed time to 1/30 s so a blocked thread or background tab does not make the spring jump.
2. Builds a context with the current options, the inverse mass and `dt` (elapsed time in frames at 60 fps).
3. Calls `tick_spring(ctx, last_value, current, target)` and writes the result to `current`.
4. Stops when every component has settled.

Sources: [packages/svelte/src/motion/spring.js:240-285](repo://packages/svelte/src/motion/spring.js#L240-L285)

`tick_spring` is a damped spring integrator applied recursively. For a number or `Date` it computes velocity from the last two values, acceleration as `(stiffness * delta - damping * velocity) * inv_mass`, and the next value; when both the step and the remaining distance are below `precision` it snaps to the target. Arrays and objects are stepped element by element, and any other type throws.

Sources: [packages/svelte/src/motion/spring.js:14-57](repo://packages/svelte/src/motion/spring.js#L14-L57)

### Setting values

`set(value, options)` rejects the promise of any previous `set` with an `Aborted` error, then:

Sources: [packages/svelte/src/motion/spring.js:287-323](repo://packages/svelte/src/motion/spring.js#L287-L323)

- With `{ instant: true }`, or when the spring has no value yet, it stops the task and sets `current` and `target` at once.
- With `{ preserveMomentum: ms }`, it sets the inverse mass to `0`, so the spring briefly keeps its current velocity, and recovers to normal mass over that many milliseconds; this gives a natural feel when the target changes while dragging.
- Otherwise it starts or retargets the motion and returns a promise that resolves when the spring settles, unless another `set` replaced it first.

Sources: [packages/svelte/src/motion/spring.js:287-323](repo://packages/svelte/src/motion/spring.js#L287-L323)

## Tween

`new Tween(value, { delay, duration, easing, interpolate })` holds `current` and `target` states. `set(value, options)` merges the options with the defaults (duration `400`, `linear` easing) and, for a duration of `0`, sets `current` immediately. Otherwise it starts a `loop` task that waits for the delay, then on its first frame creates the interpolator from the current value to the new target (and calls `duration` if it is a function of the two values) and aborts the previous tween, so a retargeted tween starts from wherever the previous one had reached. Each frame sets `current` to `interpolate(easing(elapsed / duration))` until the duration has passed. The returned promise resolves when the task ends. `Tween.of(fn)` follows a reactive expression like `Spring.of`.

Sources: [packages/svelte/src/motion/tweened.js:179-237](repo://packages/svelte/src/motion/tweened.js#L179-L237), [packages/svelte/src/motion/tweened.js:239-306](repo://packages/svelte/src/motion/tweened.js#L239-L306)

`get_interpolator(a, b)` is the default `interpolate`. Equal values (and `NaN`) give a constant function; numbers interpolate linearly; dates interpolate their timestamps; arrays and objects interpolate each element or key recursively, taking keys from the target; values of different types throw; anything else snaps to the target. A custom `interpolate` can replace it, for colours for instance.

Sources: [packages/svelte/src/motion/tweened.js:14-79](repo://packages/svelte/src/motion/tweened.js#L14-L79)

## The store versions

`spring(value, opts)` and `tweened(value, defaults)` predate the classes and return objects implementing the store contract on top of a `writable` ([[Stores]]), so components read them with `$store`. Their `set` methods use the same `tick_spring`, `get_interpolator` and `loop`. `spring()` exposes `stiffness`, `damping` and `precision` as plain mutable properties and supports `{ hard: true }` (jump to the value) and `{ soft: true | seconds }` (start with zero inverse mass and recover gradually), the predecessors of `instant` and `preserveMomentum`. `tweened()` adds `update(fn, opts)`.

Sources: [packages/svelte/src/motion/spring.js:59-153](repo://packages/svelte/src/motion/spring.js#L59-L153), [packages/svelte/src/motion/tweened.js:81-160](repo://packages/svelte/src/motion/tweened.js#L81-L160)

| | `Spring` / `Tween` | `spring()` / `tweened()` |
| --- | --- | --- |
| Read in templates | `x.current` | `$x` |
| State storage | Signals (`state`) | A `writable` store |
| Follow a reactive value | `Spring.of(fn)`, `Tween.of(fn)` | Manual `x.set(...)` |
| Spring jump / momentum | `instant`, `preserveMomentum` | `hard`, `soft` |

Sources: [packages/svelte/src/motion/spring.js:68-153](repo://packages/svelte/src/motion/spring.js#L68-L153), [packages/svelte/src/motion/spring.js:172-238](repo://packages/svelte/src/motion/spring.js#L172-L238), [packages/svelte/src/motion/tweened.js:90-160](repo://packages/svelte/src/motion/tweened.js#L90-L160), [packages/svelte/src/motion/tweened.js:179-229](repo://packages/svelte/src/motion/tweened.js#L179-L229)
