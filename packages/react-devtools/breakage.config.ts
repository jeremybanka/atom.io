import type { NpmConfig } from "breakage"

import { certifyBreaking, releaseIntent } from "../../scripts/breakage-peers.ts"

const suite = {
	files: [`contracts/*`],
	command: `node --test contracts/runtime.test.ts && node ../node_modules/typescript/bin/tsc -p contracts/tsconfig.json`,
}
const config: { npm: NpmConfig } = {
	npm: {
		artifact: `.breakage/package.tgz`,
		representatives: `peer-environments/*`,
		lockfile: `pnpm-lock.yaml`,
		prepareCommand: `pnpm install --frozen-lockfile --ignore-scripts`,
		suites: {
			"atom.io": suite,
			"@atom.io/react": suite,
			react: suite,
			"react-dom": suite,
		},
		localPeers: {
			"atom.io": {
				directory: `../atom.io`,
				artifact: `../atom.io/.breakage/package.tgz`,
			},
			"@atom.io/react": {
				directory: `../react`,
				artifact: `../react/.breakage/package.tgz`,
			},
		},
		// No version of this package has been published. Replace after publication.
		baseline: { firstRelease: true },
		releaseIntent,
		certifyBreaking,
	} satisfies NpmConfig,
}

export default config
