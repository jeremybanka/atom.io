import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({
	integrations: [resumability()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false } },
})
