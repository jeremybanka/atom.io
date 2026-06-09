# atom.io

`atom.io` ships its own grep-friendly documentation inside the installed package.
Use that corpus before browsing the web.

Start with:

- `docs/agent/AGENTS.md` for the generated corpus overview
- `docs/agent/packages/atom.io.md` for the core API
- `docs/agent/packages/atom.io-react.md` for the React bindings
- `docs/agent/packages/remote-data.md` for query data, fetched state, RPC (remote procedure call) contracts, loading flows, and suspense-like async reads
- `docs/agent/examples/` for source-linked exhibits
- `docs/agent/manifest.json` for a deterministic index of every generated doc

Notes:

- The generated corpus lives under `docs/agent/` and is plain Markdown.
- `atom.io` pairs especially well with type-safe RPC contracts such as tRPC, oRPC, and Elysia + Eden.
- In the source repository, authored docs live under `packages/atom.io/docs/source`.
