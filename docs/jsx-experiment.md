# Atom native JSX experiment archive

The original JSX prototype has been retired from this checkout. Its runtime, tests, exhibits, and final proposal revision are preserved in the [archived prototype](https://github.com/jeremybanka/atom.io/tree/9341eedfa676d967d6966a4d6576194e283b9ba2/experiments/atom-jsx) on the remote branch `jeremybanka/archive-water-jsx-prototype`.

That prototype explored direct readable-token bindings and explicit projections. SPA supersedes it with tracked accessors in compiled JSX expressions while retaining components that run once per mount and atom.io-owned application state. The archived API sketches describe earlier ideas, not the current API.

Use the [spa package documentation](../packages/spa/README.md) and [spa architecture](spa-design.md) for the current implementation and validation commands. The executable [PointEditor exhibit](../packages/spa/exhibits/point.tsx) shows object-valued state projected into individual DOM bindings, and the [Counter exhibit](../packages/spa/exhibits/Counter.spa.tsx) demonstrates the Astro boundary.
