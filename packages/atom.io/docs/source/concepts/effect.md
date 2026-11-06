---
slug: effect
title: Effect
summary: Setup logic that can hydrate an atom or react to atom changes.
packages:
  - atom.io
related:
  - atom
  - catch
  - store
---

An atom effect is setup logic attached to an atom declaration.

Effects can hydrate an atom with `setSelf`, observe changes with `onSet`, or
connect atom state to an external system such as storage, URLs, or a service
boundary.

For remote-data loaders, let the atom's default return the full response, then
normalize accepted records in a synchronous `onSet` callback. Skip pending
promises and caught errors. This keeps hydration writes behind the loadable's
stale-result protection; writes inside an async default or selector getter can
still run after that load is superseded. See the
[remote data guide](/docs/remote-data).

An effect may return a cleanup function. atom.io calls that cleanup when the atom
instance is disposed, which is where browser listeners, intervals, subscriptions,
or external handles should be released.

Use effects when state needs lifecycle-aware integration behavior that belongs
with the atom declaration.
