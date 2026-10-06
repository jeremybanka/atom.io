# atom.io repo

Repo notes:

- Always use exhibits when including inline code examples in docs.
- Do not add manual line breaks to patch notes; they render awkwardly for consumers.
- Docs changes deserve a changeset because the published `atom.io` package ships
  the docs.
- For workspace packages below version 1.0.0, only breaking changes receive a
  minor release.

## Release compatibility

- Run released public contracts against source with break-check; do not build the package or run the current suite as a compatibility preflight.
- Run current tests, builds, and type checks independently in parallel CI jobs. Public-test commands run tests only.
- Disable compatibility-task caching and preserve the repository's intentional-break certification policy.
