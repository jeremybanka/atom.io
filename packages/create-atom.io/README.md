# create-atom.io

Scaffold a fresh `atom.io` app without starting from a blank Vite project.

```sh
npm create atom.io@latest my-app
```

`create-atom.io` asks which template you want, copies it into a new directory,
optionally adds a `mise.toml`, installs dependencies with your package manager,
and leaves you ready to run the app.

This package provides a CLI for creating projects. It does not expose a
programmatic project-creation API.

## Templates

| Template                     | What you get                                                                                |
| :--------------------------- | :------------------------------------------------------------------------------------------ |
| `jquery-admin-dashboard`     | A jQuery 4 + Vite customer dashboard with filters, bulk updates, and atom.io undo/redo.     |
| `preact-svg-editor`          | A Preact + Vite SVG editor that leans on atoms, atom families, selectors, and transactions. |
| `react-node-backend`         | A React app paired with Node services for backend-shaped examples.                          |
| `react-realtime-text-editor` | A realtime React text editor with presence and selective per-user undo.                     |
| `solid-lossless-numbers`     | A Solid + Vite playground for exact rational arithmetic with `atom.io/solid`.               |

## Usage

```sh
npm create atom.io@latest my-app
pnpm create atom.io my-app
bun create atom.io my-app
yarn create atom.io my-app
```

Pass options when you already know what you want:

```sh
npm create atom.io@latest my-app -- --templateName=preact-svg-editor --packageManager=pnpm --useMise=true
```

| Option             | Aliases                               | Values                                                                                                                      |
| :----------------- | :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `--templateName`   | `--template`, `--template-name`, `-t` | `jquery-admin-dashboard`, `preact-svg-editor`, `react-node-backend`, `react-realtime-text-editor`, `solid-lossless-numbers` |
| `--packageManager` | `--package-manager`, `-m`             | `bun`, `npm`, `pnpm`, `yarn`                                                                                                |
| `--useMise`        | `--use-mise`                          | `true`, `false`                                                                                                             |
| `--skipHints`      | `--skip-hints`, `-k`                  | `true`, `false`                                                                                                             |

Unknown or malformed options produce warnings on stderr before the initializer
starts. They remain ignored; invalid values for recognized options fail validation.
An argument delimiter delivered to the initializer ends option parsing, so all
following arguments are treated as literal project directory names.

The CLI does not discover or load configuration files. Supply options through
command-line arguments or answer the interactive prompts.

## Next Steps

```sh
cd my-app
mise install # if you kept mise enabled
npm run dev
```

Swap in `pnpm dev`, `bun run dev`, or `yarn dev` if you chose a different
package manager.

## Development

The package test script builds the executable, then tests one-shot invocations
and interactive sessions in a real terminal. The terminal driver uses the Bun
version pinned in the repository's mise configuration. Tests use isolated template
packages and substitute package-manager commands that record installation requests,
so they do not download dependencies.
