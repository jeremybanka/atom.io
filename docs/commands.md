# Contributor commands

## Unused code

Run `pnpm run lint:unused` to check workspace files, exports, types, and dependencies. Run `pnpm run lint:unused:production` to check production entrypoints without tests, examples, or contributor scripts keeping source code reachable. Both commands participate in `lint` and run sequentially in a dedicated Knip CI job alongside the other static checks. Findings fail the check; neither command deletes code.

`knip.ts` preserves published entrypoint exports and accounts for executable configuration, workers, examples, and fixture projects. Review findings against public API and dynamically loaded inputs before removing code; source reachability does not measure final bundle size.
