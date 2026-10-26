import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const config: BreakageConfig = defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
	npmMatrix: {
		configs: [`packages/*/breakage.config.ts`],
		prepare: `pnpm exec turbo run pack:breakage`,
		label: ({ packageName, description, representative, peers }) => {
			const label = description ?? `${packageName}: ${representative}`
			const sdk = peers[`atom.io`]
			return sdk ? label.replace(`SDK next`, `SDK ${sdk.version}`) : label
		},
	},
	tagPattern: `refs/tags/atom.io`,
	testPattern: `__tests__/public/**/*.test.{ts,tsx}`,
	testCommand: `bun run test:once:public`,
})

export default config
