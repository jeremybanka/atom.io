# Atom native JSX experiment archive

The original JSX prototype has been retired from this checkout. Its runtime, tests, exhibits, and final proposal revision are preserved in the [archived prototype](https://github.com/jeremybanka/atom.io/tree/9341eedfa676d967d6966a4d6576194e283b9ba2/experiments/atom-jsx) on the remote branch `jeremybanka/archive-water-jsx-prototype`.

That prototype explored direct readable-token bindings and explicit projections. Hydrogen supersedes it with tracked accessors in compiled JSX expressions while retaining components that run once per mount and atom.io-owned application state. The archived API sketches describe earlier ideas, not the current API.

Use the [hydrogen package documentation](../packages/hydrogen/README.md) and [hydrogen architecture](hydrogen-design.md) for the current implementation and validation commands. The executable [PointEditor exhibit](../packages/hydrogen/exhibits/point.tsx) shows object-valued state projected into individual DOM bindings, and the [Counter exhibit](../packages/hydrogen/exhibits/Counter.hydrogen.tsx) demonstrates the Astro boundary.
