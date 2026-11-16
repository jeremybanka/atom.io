# atom.io repo

Repo notes:

- Keep repository-wide tools in the root package. Declare package-specific
  development dependencies in the package that uses them.
- Use TypeScript for all checked-in code, including scripts, tests, configuration,
  and CLI entrypoints. Do not check in `.js`, `.jsx`, `.mjs`, or `.cjs` files.
  Node runs TypeScript directly; generated JavaScript belongs in ignored build
  output directories.
- Keep CI declarative and concise: invoke short commands defined in
  `package.json`, and declare build/test prerequisites in Turbo. Do not inline
  application or test code in workflow YAML, or manually sequence build steps
  outside the orchestrator. Put reporting and runtime setup in the appropriate
  tool configuration or typed script. Prefer removing redundant machinery over
  adding wrappers.
- Package READMEs are generated from `README.mdx`. Edit the MDX or its imported
  exhibits and shared components in `scripts/readme`, then run `pnpm readme:write`.
  Use `pnpm readme:check` to check for drift.
- Always use exhibits when including inline code examples in docs.
- Do not add manual line breaks to patch notes; they render awkwardly for consumers.
- Docs changes deserve a changeset because the published `atom.io` package ships
  the docs.
- Changes limited to the `atom.io.fyi` website need a changeset targeting
  `atom.io.fyi`; its releases deploy to Cloudflare.
- For workspace packages below version 1.0.0, only breaking changes receive a
  minor release.
