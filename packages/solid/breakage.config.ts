import type { NpmConfig } from "breakage"

import { certifyBreaking, releaseIntent } from "../../scripts/breakage-peers.ts"

const suite = {
	files: [`__tests__/fixtures/consumer/*`],
	command: `node __tests__/fixtures/consumer/check.ts`,
}
const config: { npm: NpmConfig } = {
	npm: {
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
		// No version of this package has been published. Replace after publication.
		baseline: { firstRelease: true },
		releaseIntent,
		certifyBreaking,
	} satisfies NpmConfig,
}

export default config
