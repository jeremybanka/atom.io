---
slug: silo
title: Silo
summary: An isolated atom.io store with bound state utilities.
packages:
  - atom.io
  - atom.io/react
  - atom.io/testing
related:
  - store
  - atom
  - transaction
---

A `Silo` is an isolated store with atom.io utilities bound to it.

Use the implicit store for a single application-wide state graph. Use a Silo when
the same graph must be instantiated independently more than once—for example, one
store per document, editor tab, request, tenant, preview, test, worker, or sandbox.

## One Silo per application instance

Each Silo owns its token registrations, values, subscriptions, transactions,
selectors, and timelines. Multiple Silos can therefore use the same local token
keys without sharing values. This makes a Silo an application-level isolation
boundary for cases such as multiple open documents, per-request server state, and
side-by-side previews or runtime simulations.

Tests and examples follow the same pattern: each one gets an independent instance
of a state graph. Testing is a common Silo use case, but not a special mode or the
only reason to use one.

A token identifies a state by its type and key; it does not contain the live value.
The store in which that token is resolved determines which registration, value, and
subscriptions are used. Create each graph's tokens with that Silo's bound utilities,
then address them with the same Silo or supply `silo.store` to React's
[`StoreProvider`](/docs/react#storeprovider).

## Lifecycle

Keep a Silo and its provider stable for as long as the application instance exists.
Do not construct a Silo during every component render. Replacing the store on an
already-mounted React provider is not currently supported; remount a keyed provider
subtree when switching instances.

Unmounting a provider releases the subscriptions owned by its React hooks, but Silo
does not currently provide a whole-store disposal method. Unsubscribe imperative
subscriptions and run any application-specific resource cleanup before releasing
the Silo. Dispose short-lived states individually when their effects require
cleanup.
