<div align="center">
  <img alt="atom.io logo" src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png" width="144" height="144">
</div>

<h1 align="center">
  <code>atom.io</code>
</h1>

`atom.io` is a TypeScript state engine for modern ECMAScript apps. It centers on
small, explicit primitives: atoms for source state, selectors for derived state,
transactions for coordinated writes, timelines for history, families for keyed
state, and adapters for React, Solid, realtime sync, browser storage, JSON,
devtools, and testing.

This monorepo is the workshop around that engine: the published package, the
documentation site, the project scaffolder, and a set of templates that exercise
`atom.io` in real app shapes.

## A Tiny Taste

State stays small, derived data stays lazy, and React reads exactly what it needs.

```tsx
import { atom, selector, setState } from "atom.io"
import { useO } from "atom.io/react"

const todosAtom = atom<string[]>({
	key: `todos`,
	default: [],
})
const openTodos = selector<number>({
	key: `openTodos`,
	get: ({ get }) => get(todosAtom).length,
})
function addTodo() {
	setState(todosAtom, (todos) => [`ship it`, ...todos])
}

export function InboxButton() {
	const open = useO(openTodos)
	return <button onClick={addTodo}>{open} items open</button>
}
```

## Start Here

- Install the library with `npm i atom.io`.
- Read the package README at [packages/atom.io](./packages/atom.io/README.md).
- Browse the docs at [atom.io.fyi](https://atom.io.fyi).
- Generate a starter with `npm create atom.io`.

## What's Here

| Path                                                                                 | Purpose                                                                                                                       |
| :----------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| [packages/atom.io](./packages/atom.io)                                               | Core state engine, framework adapters, realtime packages, devtools, testing utilities, docs source, and package-level README. |
| [packages/create-atom.io](./packages/create-atom.io)                                 | CLI for creating new `atom.io` projects from this repo's templates.                                                           |
| [apps/atom.io.fyi](./apps/atom.io.fyi)                                               | Astro documentation site for guides, concepts, API docs, and examples.                                                        |
| [templates/preact-realtime-vector-editor](./templates/preact-realtime-vector-editor) | Preact vector editor showing Mosaic Domain batching, presence, recovery, and actor-safe history.                              |
| [templates/preact-svg-editor](./templates/preact-svg-editor)                         | Preact/Vite starter showing interactive SVG state.                                                                            |
| [templates/react-node-backend](./templates/react-node-backend)                       | React starter paired with Node services for backend-oriented examples.                                                        |
| [templates/react-realtime-text-editor](./templates/react-realtime-text-editor)       | React markdown editor showing collaborative text, presence, and selective per-user undo.                                      |
| [templates/solid-lossless-numbers](./templates/solid-lossless-numbers)               | Solid/Vite starter focused on precise numeric state.                                                                          |

## Working Locally

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Useful focused commands:

```sh
pnpm --filter atom.io test
pnpm --filter atom.io.fyi dev
pnpm --filter create-atom.io build
```

## AI Agent Docs

The published `atom.io` package includes agent-friendly documentation. After
installing, start with `node_modules/atom.io/AGENTS.md`; it points to concise
concept notes, package guides, and source-linked examples in
`node_modules/atom.io/docs/agent/`.

## License

`atom.io`, `create-atom.io`, and repository content without a nearer license
are available under the [Mozilla Public License 2.0](./LICENSE). The
[documentation site](./apps/atom.io.fyi/LICENSE) and each project template are
available under the Apache License 2.0, as stated by the license file in each
package. Generated projects therefore receive the Apache-licensed template
code, not the MPL license of the scaffolding CLI.

### What MPL 2.0 Means for Users

Mozilla describes MPL 2.0 as a simple, **file-level copyleft** license: it keeps
improvements to MPL-covered files open while allowing those files to be combined
with open or proprietary code with minimal restrictions. It is not classified as
a permissive license in the strict MIT/Apache sense, but it is deliberately
permissive about use and integration. In practical terms:

- You may use `atom.io` for any purpose, including commercial and proprietary
  applications.
- Importing, bundling, or even statically linking `atom.io` does **not** require
  you to publish the source of your application's separate files.
- If you distribute changes to MPL-covered files, those files remain under MPL
  and their source must stay available. When distributing `atom.io` in compiled
  or bundled form, recipients must be told where its corresponding source is
  available.
- Private and internal use creates no distribution obligations.

In short: if you modify `atom.io`, share the changes to `atom.io`; merely using
it does not change your application's license. See
[Mozilla's official MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) and
the [complete license text](https://www.mozilla.org/en-US/MPL/2.0/) for details.

## Provenance

This repository was forked from `jeremybanka/wayforge` as a dedicated home for `atom.io` and related projects. Its Git history now begins with the commit that introduced `atom.io` on April 11, 2023; earlier Wayforge history remains part of the original repository.
