# @atom.io/react

## 0.2.0

### Minor Changes

- a51693d: **Breaking:** `useAtomicRef` now publishes `null` to its previous atom when the component unmounts or its target state or store changes. Consumers must handle detachment rather than rely on a retained DOM node; atom effects can use this transition to release attached resources. Host changes are published after commit, while unchanged hosts are not republished. Cleanup skips members that have already been disposed. The hook does not automatically dispose atoms.

### Patch Changes

- a51693d: Add the standalone “against useEffect” guide with twenty paired React and atom.io exhibits, React judgments, and state ownership guidance, explicitly preserving `useLayoutEffect` for layout work. Link the guide from the React package docs and include it in the agent documentation corpus.

## 0.1.0

### Minor Changes

- bb1d8de: Release the standalone React bindings at 0.1.0. Replace imports from `atom.io/react` with `@atom.io/react`; the exports and behavior are unchanged. Install alongside React 18 or 19 and `atom.io` matching `^0.53.3 || ^0.54.0`.

  Generate the package README from MDX with shared branding, package badges, source-backed installation and usage examples, and JavaScript bundle reports.

  Own the integration's behavior tests and consumer fixtures in this package, with a 100% public coverage threshold and an independent Recoverage history. Check packed bindings against frozen React 18 and 19 environments using both the released and coordinated SDK.
