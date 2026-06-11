# Preact SVG Editor

A Preact + Vite starter that uses `atom.io` to model an editable SVG path.

## What It Shows

- atom families for keyed path nodes, edges, and subpaths
- selector families for deriving SVG path data from small pieces of state
- transactions for resetting and rebuilding the drawing in one user action
- `useAtomicRef` for keeping a DOM ref available to atom.io logic

## Run It

```sh
npm run dev
```

Build and preview the production app:

```sh
npm run build
npm run preview
```

## Where To Look

- `src/index.tsx`: Preact entry point and resource links.
- `src/BezierPlayground.tsx`: the atom.io state model and SVG editor UI.
- `src/style.css`: layout and editor styling.

## Next Ideas

- Add undo and redo with an atom.io timeline.
- Persist the SVG path to local storage.
- Export the current drawing as an `.svg` file.
