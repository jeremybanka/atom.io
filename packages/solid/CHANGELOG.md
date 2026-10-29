# @atom.io/solid

## 0.1.3

### Patch Changes

- 6a2f2e9: Add support for Solid 2.0.0-rc.19 while retaining compatibility with rc.17 and rc.18.

## 0.1.2

### Patch Changes

- 172a85d: Add compatibility with Solid 2.0.0-rc.18 while retaining Solid 1.9 and 2.0.0-rc.17 support. Validate both release candidates against the released and coordinated SDKs using the existing hooks.

## 0.1.1

### Patch Changes

- 5f8d7ae: Support Solid 2.0.0-rc.17 alongside Solid 1.9 with compatible context providers, renderer-neutral declarations, and subscription lifecycle handling. Add peer environments and runtime contracts for both SDK eras, including development builds and external-source integration experiments.

## 0.1.0

### Minor Changes

- bb1d8de: Release the standalone Solid bindings at 0.1.0. Replace imports from `atom.io/solid` with `@atom.io/solid`; the exports and behavior are unchanged. Install alongside `solid-js` 1.9 and `atom.io` matching `^0.53.3 || ^0.54.0`.

  Generate the package README from MDX with shared branding, package badges, source-backed installation and usage examples, and JavaScript bundle reports.

  Own the integration's behavior tests and consumer fixtures in this package, with a 100% public coverage threshold and an independent Recoverage history. Check packed bindings against frozen Solid environments using both the released and coordinated SDK.
