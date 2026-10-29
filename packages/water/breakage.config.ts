import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const suite = {
	files: [`__tests__/fixtures/consumer/*`],
	command: `node __tests__/fixtures/consumer/check.ts`,
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
		suites: { "atom.io": suite, vite: suite, astro: suite },
		localPeers: {
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/water@` },
	},
})
export default config
