---
slug: loadable
title: Loadable
summary: A reactive value that may still be waiting on asynchronous work.
packages:
  - atom.io
  - "@atom.io/react"
related:
  - selector
  - catch
  - effect
---

A loadable value represents state that may currently be a pending `Promise`, a
resolved value, or a handled error stored through `catch`.

Async selectors can produce loadable behavior when they return promises. React
code can use `useLoadable` to observe the loaded value, a `loading` flag while a
newer promise is pending, and typed error information when a caught load fails.

Use loadable state when data comes from an asynchronous source but still needs
to participate in atom.io's reactive graph.

Superseded promises cannot publish obsolete results into their loadable, but
their async functions can still continue and explicitly write other state. Put
remote-record normalization in a synchronous atom `onSet` effect that handles
accepted resolved values and skips pending promises and caught errors.

For query data, fetched data, RPC (remote procedure call) contracts, loading
flows, and suspense-like async state, see the
[remote data guide](/docs/remote-data).
