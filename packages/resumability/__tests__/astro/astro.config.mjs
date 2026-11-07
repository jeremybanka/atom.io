import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({
	devToolbar: { enabled: false },
	integrations: [resumability()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false } },
})
