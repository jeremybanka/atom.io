import type { BreakageConfig } from "breakage"
import { defineConfig } from "breakage"

import { release } from "../../scripts/breakage-release.ts"

const config: BreakageConfig = defineConfig({
	release,
	tagPattern: `refs/tags/atom.io`,
	testPattern: `__tests__/public/**/*.test.{ts,tsx}`,
	testCommand: `bun run test:once:public`,
})

export default config
