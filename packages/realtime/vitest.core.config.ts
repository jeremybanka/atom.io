import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
// eslint-disable-next-line import/extensions, quotes -- Native JSON imports require the extension and a string-literal attribute.
import shards from "./test-shards.json" with { type: "json" }

const config: ViteUserConfig = defineOurVitestConfig({
	name: `realtime-core`,
	target: `dist`,
	test: { include: shards.core, passWithNoTests: false },
})

export default config
