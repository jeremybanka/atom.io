import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const suite = {
	files: [`__tests__/fixtures/consumer/*`],
	command: `node __tests__/fixtures/consumer/check.ts`,
}
const reactSuite = {
	files: [`__tests__/fixtures/react-consumer/*`],
	command: `node __tests__/fixtures/react-consumer/check.ts`,
}
const config: BreakageConfig = defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor`, beforeV0_1: `patch` }),
	},
	npm: {
		artifact: `.breakage/package.tgz`,
		representatives: `peer-environments/*`,
		lockfile: `pnpm-lock.yaml`,
		prepareCommand: `pnpm install --frozen-lockfile --ignore-scripts`,
		suites: {
			"atom.io": suite,
			"@atom.io/spa": suite,
			"@atom.io/react": reactSuite,
			react: reactSuite,
		},
		localPeers: {
			"@atom.io/react": {
				directory: `../react`,
				artifact: `../react/.breakage/package.tgz`,
			},
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
			"@atom.io/spa": {
				directory: `../spa`,
				artifact: `../spa/.breakage/package.tgz`,
			},
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/spa-devtools@` },
	},
})
export default config
