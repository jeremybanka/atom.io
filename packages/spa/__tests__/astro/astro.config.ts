import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"

export default defineConfig({
	integrations: [spa()],
	outDir: `./dist`,
	vite: { resolve: { tsconfigPaths: false }, build: { minify: `oxc` } },
})
