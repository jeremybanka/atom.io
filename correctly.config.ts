import { schemars } from "@correctlyjs/schemars/ajv"
import { defineConfig, GITIGNORE, json, jsonc, toml, yaml } from "correctly"
import { renovate } from "correctly/extensions/renovate"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	exclude: [GITIGNORE, `pnpm-lock.yaml`],
	associations: [
		{
			name: `Changesets`,
			files: [`.changeset/config.json`],
			parse: json(),
			validate: ajv({ schema: `node_modules/@changesets/config/schema.json` }),
		},
		{
			name: `Break Check`,
			files: [`**/break-check.config.json`],
			parse: json(),
			validate: ajv({
				schema: `packages/atom.io/node_modules/break-check/dist/break-check.main.schema.json`,
			}),
		},
		{
			name: `Dprint`,
			files: [`**/dprint.json`],
			parse: json(),
			// Dprint's installed npm packages do not ship a JSON Schema.
			validate: ajv({ schema: `https://dprint.dev/schemas/v0.json` }),
		},
		{
			name: `Turbo`,
			files: [`turbo.json`],
			parse: json(),
			validate: ajv({
				schema: `node_modules/turbo/schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `Renovate`,
			files: [`renovate.json`],
			parse: json(),
			validate: ajv({
				// Renovate runs in CI; it is not an installed workspace dependency.
				schema: `https://docs.renovatebot.com/renovate-schema.json`,
				extensions: [renovate()],
			}),
		},
		{
			name: `Oxlint`,
			files: [`**/oxlint.json`, `**/.oxlintrc.json`],
			parse: json(),
			validate: ajv({
				schema: `node_modules/oxlint/configuration_schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `Wrangler`,
			files: [`apps/atom.io.fyi/wrangler.jsonc`],
			parse: jsonc(),
			validate: ajv({
				schema: `apps/atom.io.fyi/node_modules/wrangler/config-schema.json`,
			}),
		},
		{
			name: `TypeScript and editor settings`,
			files: [`**/tsconfig*.json`, `**/.vscode/*.json`, `**/.zed/*.json`],
			parse: jsonc(),
			validate: null,
		},
		{
			name: `GitHub workflows`,
			files: [`.github/workflows/*.{yml,yaml}`],
			parse: yaml(),
			validate: ajv({
				schema: `https://www.schemastore.org/github-workflow.json`,
			}),
		},
		{
			name: `GitHub actions`,
			files: [`.github/actions/**/action.{yml,yaml}`],
			parse: yaml(),
			validate: ajv({
				schema: `https://www.schemastore.org/github-action.json`,
			}),
		},
		{
			name: `pnpm workspace`,
			files: [`pnpm-workspace.yaml`],
			parse: yaml(),
			validate: ajv({
				schema: `https://www.schemastore.org/pnpm-workspace.json`,
			}),
		},
		{
			name: `Mise`,
			files: [`**/mise.toml`],
			parse: toml(),
			validate: ajv({ schema: `https://mise.jdx.dev/schema/mise.json` }),
		},
	],
})
