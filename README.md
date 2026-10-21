<div align="center">
	<img
		alt="atom.io logo"
		src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png"
		width="96"
		height="96"
	>
</div>

<h1 align="center">
	<code>atom.io</code>
</h1>

`atom.io` is a zero-dependency TypeScript state engine with atoms, selectors,
transactions, timelines, and families. This monorepo contains the SDK, React and
Solid bindings, realtime integrations, devtools, testing utilities, an ESLint
plugin, a project scaffolder, starter templates, and the documentation site.

For library usage, see the [package README](./packages/atom.io/README.md) and
[atom.io.fyi](https://atom.io.fyi).

## Working Locally

Clone this repository and open its root. With Mise installed and activated in
your shell:

1. Run `mise trust`, then `mise install` to install the versions pinned in
   [mise.toml](./mise.toml), including Node, pnpm, Bun, and PostgreSQL.
2. Run `pnpm install --frozen-lockfile` to install workspace dependencies.
3. Run `pnpm hooks:install` to enable formatting hooks.
4. Run `pnpm build` to build the workspace packages and documentation site.

Realtime tests start and stop their own local PostgreSQL instances using the
installed binaries.

Run these commands from the repository root:

| Command                              | Purpose                                           |
| ------------------------------------ | ------------------------------------------------- |
| `pnpm build`                         | Build the workspace through Turbo.                |
| `pnpm test`                          | Build prerequisites and run the test suites once. |
| `pnpm lint`                          | Run workspace linters and type checks.            |
| `pnpm fmt:check`                     | Check repository formatting.                      |
| `pnpm fmt`                           | Format the repository.                            |
| `pnpm --filter atom.io.fyi dev`      | Start the documentation site at localhost:4321.   |
| `pnpm --filter atom.io test`         | Watch the SDK tests while editing.                |
| `pnpm --filter create-atom.io build` | Build the project scaffolder.                     |
| `pnpm test:stress:realtime-ipc`      | Run the realtime IPC stress tests.                |

Turbo manages build prerequisites for the root build and test commands. Package
commands use pnpm's workspace filters to focus on one project.

## Workspace Layout

| Path                                                                   | Purpose                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| [packages/atom.io](./packages/atom.io)                                 | Core SDK, testing utilities, and documentation source.      |
| [packages/realtime](./packages/realtime)                               | Realtime collaboration, adapters, tests, and documentation. |
| [packages/react](./packages/react), [packages/solid](./packages/solid) | Framework bindings.                                         |
| [packages/react-devtools](./packages/react-devtools)                   | React devtools and their styles.                            |
| [packages/eslint-plugin](./packages/eslint-plugin)                     | ESLint plugin.                                              |
| [packages/create-atom.io](./packages/create-atom.io)                   | Project scaffolder.                                         |
| [packages/exhibits](./packages/exhibits)                               | Shared documentation exhibit utilities.                     |
| [apps/atom.io.fyi](./apps/atom.io.fyi)                                 | Documentation site.                                         |
| [templates](./templates)                                               | React, Preact, and Solid starter projects.                  |
| [scripts](./scripts)                                                   | Repository maintenance scripts.                             |

Repository conventions are in [AGENTS.md](./AGENTS.md). The SDK's
[agent documentation guide](./packages/atom.io/AGENTS.md) points to the generated
API documentation and source-linked examples shipped with the package.

## Language Servers and Editors

After installing workspace dependencies, these language servers are available
locally and communicate over stdio:

| Server    | Project executable                | Purpose                                                                                        |
| --------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Lasertag  | `node_modules/.bin/lasertag-lsp`  | CSS Module diagnostics, completions, and cleanup actions for CSS, TSX, and Astro.              |
| Correctly | `node_modules/.bin/correctly-lsp` | Configuration diagnostics for JSON/JSONC, YAML, and TOML; completion and hover for JSON/JSONC. |

Correctly uses [correctly.config.ts](./correctly.config.ts) and the project's
installed validators, including repository and nested Git ignore rules. It checks
GitHub workflows and actions, pnpm workspace settings, Mise configuration, and
our JSON/JSONC tooling files. Dprint handles formatting.

### VS Code

Install the bundled VSIX clients, which launch the same language servers. Use
VS Code 1.105 or later, open the repository root, and trust the workspace so
Correctly can load its TypeScript configuration. The extensions are distributed
outside the VS Code Marketplace.

Build and install Lasertag's extension with `pnpm exec lasertag vsix`.

For Correctly, use a separate
[Correctly checkout](https://github.com/jeremybanka/correctly) matching the version
pinned in [package.json](./package.json). Install that checkout's dependencies,
run `pnpm --filter correctly build:vsix`, and install the generated VSIX through
your editor.

Rebuild and reinstall the corresponding VSIX after upgrading either tool.

## License

`atom.io`, `create-atom.io`, and repository content without a nearer license
are available under the [Mozilla Public License 2.0](./LICENSE). The
[documentation site](./apps/atom.io.fyi/LICENSE) and each project template are
available under the Apache License 2.0, as stated by the license file in each
package. Generated projects therefore receive the Apache-licensed template
code, not the MPL license of the scaffolding CLI.

## Provenance

This repository was forked from `jeremybanka/wayforge` as a dedicated home for `atom.io` and related projects. Its Git history now begins with the commit that introduced `atom.io` on April 11, 2023; earlier Wayforge history remains part of the original repository.
