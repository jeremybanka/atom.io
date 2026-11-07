import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const suite = {
	files: [`__tests__/fixtures/consumer/*`],
	command: `node __tests__/fixtures/consumer/check.ts`,
}
const graphicsSuite = {
	files: [`__tests__/fixtures/graphics-consumer/*`],
	command: `node __tests__/fixtures/graphics-consumer/check.ts`,
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
			vite: suite,
			astro: suite,
			resumability: suite,
			motion: graphicsSuite,
			three: graphicsSuite,
			konva: graphicsSuite,
			"@types/three": graphicsSuite,
		},
		localPeers: {
			resumability: {
				directory: `../resumability`,
				artifact: `../resumability/.breakage/package.tgz`,
			},
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/spa@` },
	},
})
export default config
