# create-atom.io

Scaffold a fresh `atom.io` app without starting from a blank Vite project.

```sh
npm create atom.io@latest my-app
```

`create-atom.io` asks which template you want, copies it into a new directory,
optionally adds a `mise.toml`, installs dependencies with your package manager,
and leaves you ready to run the app.

## Templates

| Template                     | What you get                                                                                |
| :--------------------------- | :------------------------------------------------------------------------------------------ |
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

| Option             | Aliases                               | Values                                                                                            |
| :----------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------ |
| `--templateName`   | `--template`, `--template-name`, `-t` | `preact-svg-editor`, `react-node-backend`, `react-realtime-text-editor`, `solid-lossless-numbers` |
| `--packageManager` | `--package-manager`, `-m`             | `bun`, `npm`, `pnpm`, `yarn`                                                                      |
| `--useMise`        | `--use-mise`                          | `true`, `false`                                                                                   |
| `--skipHints`      | `--skip-hints`, `-k`                  | `true`, `false`                                                                                   |

Unknown or malformed options produce warnings on stderr before the initializer
starts. They remain ignored; invalid values for recognized options fail validation.
An argument delimiter delivered to the initializer ends option parsing, so all
following arguments are treated as literal project directory names.

The CLI does not discover or load configuration files. Supply options through
command-line arguments or answer the interactive prompts.

## Shell Completion

The globally installed command supports optional completion for Bash, Zsh, Fish,
Nushell, and Carapace. Follow the [shell completion exhibit](./exhibits/completion.sh)
to install the command and the integration for your shell, then open a new shell.
These integrations complete the direct command on your PATH; they do not add
completion to package-manager create wrappers.

Completion suggests option names, aliases, template names, package managers, and
boolean values from the same definitions used to parse commands. Completion
requests and integration generation do not start prompts or scaffold a project.
Installation is explicit and writes a completion file without editing shell profiles.

Completion management and its hidden protocols reserve the initial command names
`completion`, `__complete`, `__completeNoDesc`, `_comline`, and `_carapace`.
To use a reserved name as a project directory, put the argument delimiter before
it; the exhibit includes an example.

Bash requires Bash 4+ with bash-completion 2.18+ enabled. Zsh requires compinit,
Fish requires version 4+, Nushell requires external completions enabled, and
Carapace requires its existing shell integration. Nushell users already using
Carapace need only the Carapace integration.

## Next Steps

```sh
cd my-app
mise install # if you kept mise enabled
npm run dev
```

Swap in `pnpm dev`, `bun run dev`, or `yarn dev` if you chose a different
package manager.
