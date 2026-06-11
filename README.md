<div align="center">
  <img alt="atom.io logo" src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.svg" width="144" height="144">
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

## Start Here

- Install the library with `npm i atom.io`.
- Read the package README at [packages/atom.io](./packages/atom.io/README.md).
- Browse the docs at [atom.io.fyi](https://atom.io.fyi).
- Generate a starter with `npm create atom.io`.

## What's Here

| Path                                                                   | Purpose                                                                                                                       |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| [packages/atom.io](./packages/atom.io)                                 | Core state engine, framework adapters, realtime packages, devtools, testing utilities, docs source, and package-level README. |
| [packages/create-atom.io](./packages/create-atom.io)                   | CLI for creating new `atom.io` projects from this repo's templates.                                                           |
| [apps/atom.io.fyi](./apps/atom.io.fyi)                                 | Astro documentation site for guides, concepts, API docs, and examples.                                                        |
| [templates/preact-svg-editor](./templates/preact-svg-editor)           | Preact/Vite starter showing interactive SVG state.                                                                            |
| [templates/react-node-backend](./templates/react-node-backend)         | React starter paired with Node services for backend-oriented examples.                                                        |
| [templates/solid-lossless-numbers](./templates/solid-lossless-numbers) | Solid/Vite starter focused on precise numeric state.                                                                          |

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

## Provenance

This repository was forked from `jeremybanka/wayforge` as a dedicated home for `atom.io` and related projects. Its Git history now begins with the commit that introduced `atom.io` on April 11, 2023; earlier Wayforge history remains part of the original repository.
