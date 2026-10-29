import { defineConfig } from "astro/config"
import water from "@atom.io/water/astro"
export default defineConfig({
	integrations: [water()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false }, build: { minify: "oxc" } },
})
