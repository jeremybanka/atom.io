# atom.io

`atom.io` ships its own grep-friendly documentation inside the installed package.
Use that corpus before browsing the web.

Start with:

- `docs/agent/AGENTS.md` for the generated corpus overview
- `docs/agent/packages/atom.io.md` for the core API
- `docs/agent/packages/atom.io-react.md` for the React bindings
- `docs/agent/packages/remote-data.md` for query data, fetched state, RPC (remote procedure call) contracts, loading flows, and suspense-like async reads
- `docs/agent/packages/typesafe-router.md` for typesafe router guidance with TreeTrunks
- `docs/agent/examples/` for source-linked exhibits
- `docs/agent/manifest.json` for a deterministic index of every generated doc

Notes:

- The generated corpus lives under `docs/agent/` and is plain Markdown.
- `atom.io` pairs especially well with type-safe RPC contracts such as [tRPC](https://trpc.io), [oRPC](https://orpc.unnoq.com), and [Elysia](https://elysiajs.com) + Eden.
- In the source repository, authored docs live under `packages/atom.io/docs/source`.

Loadable reminder for generated code and review:

- `useLoadable(...)` in render observes and hydrates the state.
- `atomFamily` keyed by route params or query input makes cache identity explicit.
- `resetState(...)` in a mount effect is suspicious because it usually causes duplicate async work.
- `resetState(...)` after a mutation, retry, explicit refresh, or test setup is intentional invalidation.

Short version: Read is hydration. Key is identity. Reset is invalidation.
