import type { NpmConfig } from "breakage"

import { certifyBreaking, releaseIntent } from "../../scripts/breakage-peers.ts"

const suite = {
	files: [`contracts/*`],
	command: `node contracts/consumer.ts && node ../node_modules/typescript/bin/tsc -p contracts/tsconfig.json`,
}
const config: { npm: NpmConfig } = {
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
		releaseIntent,
		certifyBreaking,
	} satisfies NpmConfig,
}

export default config
