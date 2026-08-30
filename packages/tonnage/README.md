# tonnage

Keep exact bundle size tables in a package README and fail CI when the checked-in
numbers drift.

The tool bundles real public package imports with esbuild, minifies the result,
and reports JavaScript bytes before and after level-9 gzip. Public-module rows
retain every runtime export; recipe entry files can select named exports and
tree-shake the rest. Declarations, source maps, CSS, and other assets are not
counted. Peer dependencies stay external, and shared modules are counted once
per bundle.

## Configure

Add the generated-section comments to the target README, then create a config
beside the package manifest. The complete configuration exhibit is in
[examples/tonnage.config.ts](./examples/tonnage.config.ts).
Each recipe points to a reviewable entry file such as
[examples/recipes/react-app.ts](./examples/recipes/react-app.ts). Use named
imports in these files to represent the runtime surface a real application uses;
unused package exports are tree-shaken.

The default generated-section marker is `default`; the example uses `my-package`.
The opening and closing comments use the forms
`tonnage:my-package:start` and `tonnage:my-package:end`.

## Run

Run `tonnage write` during development to update the README. Run
`tonnage check` in CI to recompute the same report without writing and exit
nonzero when the README is stale. The aliases `make` and `test` are also
available for manifest-style scripts.

By default the tool reads `package.json`, writes `README.md`, and measures every
public export except `./package.json`. Paths are resolved relative to the config
file. Use `exports.include` or `exports.exclude` to select subpaths, recipe entry
files to describe realistic runtime boundaries, and `external` for non-peer
imports that the package intentionally leaves to its consumers.
