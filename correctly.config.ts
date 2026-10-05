import { schemars } from "@correctlyjs/schemars/ajv"
import { defineConfig, json, jsonc } from "correctly"
import { renovate } from "correctly/extensions/renovate"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: [`**/*.json`, `**/*.jsonc`],
	exclude: [
		`**/.astro/**`,
		`**/.cache/**`,
		`**/.pnpm-store/**`,
		`**/.turbo/**`,
		`**/.wrangler/**`,
		`**/coverage/**`,
		`**/coverage-public/**`,
		`**/storybook-static/**`,
		`**/package-lock.json`,
		`**/metafile-*.json`,
		`**/heap.json`,
		`**/*.tsdoc.json`,
		`projects/**`,
		`pkg/**`,
		`packages/atom.io/__reports__/**`,
		`packages/atom.io/docs/agent/**`,
		`apps/atom.io.fyi/agent-docs/**`,
	],
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
			files: [`packages/atom.io/oxlint.json`],
			parse: json(),
			validate: ajv({
				schema: `node_modules/oxlint/configuration_schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `Preact SVG Editor Oxlint`,
			files: [`templates/preact-svg-editor/.oxlintrc.json`],
			parse: json(),
			validate: ajv({
				schema: `templates/preact-svg-editor/node_modules/oxlint/configuration_schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `React Node Backend Oxlint`,
			files: [`templates/react-node-backend/.oxlintrc.json`],
			parse: json(),
			validate: ajv({
				schema: `templates/react-node-backend/node_modules/oxlint/configuration_schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `React Realtime Text Editor Oxlint`,
			files: [`templates/react-realtime-text-editor/.oxlintrc.json`],
			parse: json(),
			validate: ajv({
				schema: `templates/react-realtime-text-editor/node_modules/oxlint/configuration_schema.json`,
				extensions: [schemars({ version: `0.8.22` })],
			}),
		},
		{
			name: `Solid Lossless Numbers Oxlint`,
			files: [`templates/solid-lossless-numbers/.oxlintrc.json`],
			parse: json(),
			validate: ajv({
				schema: `templates/solid-lossless-numbers/node_modules/oxlint/configuration_schema.json`,
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
	],
})
