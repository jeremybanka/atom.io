import node from "@astrojs/node"
import spa from "@atom.io/spa/astro"
import { defineConfig, memoryCache } from "astro/config"
import resumability from "resumability/astro"
import reylo from "reylo/vite"

export default defineConfig({
	output: `server`,
	adapter: node({ mode: `standalone` }),
	cache: { provider: memoryCache() },
	routeRules: {
		// Cache the public HTML and its resumption sidecar as one snapshot.
		[`/`]: { maxAge: 60 },
	},
	integrations: [resumability(), spa()],
	vite: { plugins: [reylo()] },
})
