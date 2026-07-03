---
slug: loadable
title: Loadable
summary: A reactive value that may still be waiting on asynchronous work.
packages:
  - atom.io
  - atom.io/react
related:
  - selector
  - catch
  - effect
---

A loadable value represents state that may be available now, still loading, or
recovering from asynchronous work.

<!-- DOCS REVIEW: "Recovering from asynchronous work" is fuzzy. Should this name the actual observable states: pending Promise, resolved value, caught error, and refresh/loading state? -->

Async selectors can produce loadable behavior when they return promises. React
code can use `useLoadable` to observe the loaded value, loading state, and typed
error information.

Use loadable state when data comes from an asynchronous source but still needs
to participate in atom.io's reactive graph.

For query data, fetched data, RPC (remote procedure call) contracts, loading
flows, and suspense-like async state, see the
[remote data guide](/docs/remote-data).
