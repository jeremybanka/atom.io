import { defineConfig } from "astro/config"
import spa from "@atom.io/spa/astro"
export default defineConfig({
	integrations: [spa()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false }, build: { minify: "oxc" } },
})
