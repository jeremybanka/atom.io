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
		// This RC-only support replacement is intentionally a patch. Keep the
		// exception limited to this release; other releases retain the policy above.
		release: {
			resolveDelta: changesetsReleaseDelta(),
			policy: (delta) =>
				(delta.previousVersion === `0.1.3` &&
					delta.version === `0.1.4` &&
					delta.delta === `patch`) ||
				semverPolicy({ beforeV1: `minor` })(delta),
		},
		artifact: `.breakage/package.tgz`,
		representatives: `peer-environments/*`,
		lockfile: `pnpm-lock.yaml`,
		prepareCommand: `pnpm install --frozen-lockfile --ignore-scripts`,
		suites: { "atom.io": suite, "solid-js": suite },
		localPeers: {
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
		},
		baseline: { tagPattern: `refs/tags/@atom\\.io/solid@` },
	},
})

export default config
