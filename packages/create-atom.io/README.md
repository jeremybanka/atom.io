# create-atom.io

Scaffold a fresh `atom.io` app without starting from a blank Vite project.

```sh
npm create atom.io@latest my-app
```

`create-atom.io` asks which template you want, copies it into a new directory,
optionally adds a `mise.toml`, installs dependencies with your package manager,
and leaves you ready to run the app.

## Templates

| Template                 | What you get                                                                                |
| :----------------------- | :------------------------------------------------------------------------------------------ |
| `preact-svg-editor`      | A Preact + Vite SVG editor that leans on atoms, atom families, selectors, and transactions. |
| `react-node-backend`     | A React app paired with Node services for backend-shaped examples.                          |
| `solid-lossless-numbers` | A Solid + Vite playground for exact rational arithmetic with `atom.io/solid`.               |

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

| Option             | Alias | Values                                                              |
| :----------------- | :---- | :------------------------------------------------------------------ |
| `--templateName`   | `-t`  | `preact-svg-editor`, `react-node-backend`, `solid-lossless-numbers` |
| `--packageManager` | `-m`  | `bun`, `npm`, `pnpm`, `yarn`                                        |
| `--useMise`        |       | `true`, `false`                                                     |
| `--skipHints`      | `-k`  | `true`, `false`                                                     |

## Next Steps

```sh
cd my-app
mise install # if you kept mise enabled
npm run dev
```

Swap in `pnpm dev`, `bun run dev`, or `yarn dev` if you chose a different
package manager.
