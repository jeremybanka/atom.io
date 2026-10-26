import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const suite = {
	files: [`__tests__/fixtures/consumer/*`],
	command: `node --test __tests__/fixtures/consumer/runtime.ts && node ../node_modules/typescript/bin/tsc -p __tests__/fixtures/consumer/tsconfig.json`,
}
const config: BreakageConfig = defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
	npm: {
		artifact: `.breakage/package.tgz`,
		representatives: `peer-environments/*`,
		lockfile: `pnpm-lock.yaml`,
		prepareCommand: `pnpm install --frozen-lockfile --ignore-scripts`,
		suites: { "atom.io": suite, react: suite },
		localPeers: {
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/react@` },
	},
})

export default config
