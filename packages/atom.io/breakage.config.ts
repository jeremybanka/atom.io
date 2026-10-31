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
		// Only package builds belong in the archive preparation graph. The site
		// build regenerates core docs and can remove files while they are packed.
		prepare: `pnpm exec turbo run pack:breakage --filter=./packages/*`,
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
