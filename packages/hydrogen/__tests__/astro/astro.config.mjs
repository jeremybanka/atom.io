import { defineConfig } from "astro/config"
import hydrogen from "@atom.io/hydrogen/astro"
export default defineConfig({
	integrations: [hydrogen()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false }, build: { minify: "oxc" } },
})
