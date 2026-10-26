import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const suite = {
	files: [`__tests__/fixtures/consumer.ts`, `__tests__/fixtures/tsconfig.json`],
	command: `node __tests__/fixtures/consumer.ts && node ../node_modules/typescript/bin/tsc -p __tests__/fixtures/tsconfig.json`,
}
const config: BreakageConfig = defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
	tagPattern: `refs/tags/@atom\\.io/eslint-plugin@`,
	testPattern: `__tests__/rules/**/*.test.ts`,
	testCommand: `bun run test:once:public`,
	npm: {
		artifact: `.breakage/package.tgz`,
		representatives: `peer-environments/*`,
		lockfile: `pnpm-lock.yaml`,
		prepareCommand: `pnpm install --frozen-lockfile --ignore-scripts`,
		suites: {
			"@typescript-eslint/parser": suite,
			eslint: suite,
			typescript: suite,
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/eslint-plugin@` },
	},
})

export default config
