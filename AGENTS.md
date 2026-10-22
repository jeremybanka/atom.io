# atom.io repo

Repo notes:

- Package READMEs are generated from `README.mdx`. Edit the MDX or its imported
  exhibits and shared components in `scripts/readme`, then run `pnpm readme:write`.
  Use `pnpm readme:check` to check for drift.
- Always use exhibits when including inline code examples in docs.
- Do not add manual line breaks to patch notes; they render awkwardly for consumers.
- Docs changes deserve a changeset because the published `atom.io` package ships
  the docs.
- Changes limited to the `atom.io.fyi` website do not need patch notes or changesets.
- For workspace packages below version 1.0.0, only breaking changes receive a
  minor release.
