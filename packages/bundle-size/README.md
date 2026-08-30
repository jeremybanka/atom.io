# @atom.io/bundle-size

Keep exact bundle-size tables in a package README and fail CI when the checked-in
numbers drift.

The tool bundles real public package imports with esbuild, retains every runtime
export, minifies the result, and reports raw and level-9 gzip bytes. Peer
dependencies stay external. Multi-import recipes are bundled as one graph, so
shared modules are counted once.

## Configure

Add the generated-section comments to the target README, then create a config
beside the package manifest. The complete configuration exhibit is in
[examples/bundle-size.config.ts](./examples/bundle-size.config.ts).

The default generated-section marker is `default`; the example uses `my-package`.
The opening and closing comments use the forms
`bundle-size:my-package:start` and `bundle-size:my-package:end`.

## Run

Run `bundle-size write` during development to update the README. Run
`bundle-size check` in CI to recompute the same report without writing and exit
nonzero when the README is stale. The aliases `make` and `test` are also
available for manifest-style scripts.

By default the tool reads `package.json`, writes `README.md`, and measures every
public export except `./package.json`. Paths are resolved relative to the config
file. Use `exports.include` or `exports.exclude` to select subpaths, `recipes` to
describe realistic combinations, and `external` for non-peer imports that the
package intentionally leaves to its consumers.
