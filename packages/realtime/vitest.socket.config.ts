import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
// eslint-disable-next-line import/extensions, quotes -- Native JSON imports require the extension and a string-literal attribute.
import shards from "./test-shards.json" with { type: "json" }

const config: ViteUserConfig = defineOurVitestConfig({
	name: `realtime-socket`,
	target: `dist`,
	test: {
		include: shards.socket,
		passWithNoTests: false,
		maxWorkers: 1,
		fileParallelism: false,
	},
})

export default config
