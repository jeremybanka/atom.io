import node from "@astrojs/node"
import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"
import resumability from "resumability/astro"
import reylo from "reylo/vite"

export default defineConfig({
	output: `server`,
	adapter: node({ mode: `standalone` }),
	integrations: [resumability(), spa()],
	vite: { plugins: [reylo()] },
})
