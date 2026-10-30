import { defineConfig } from "astro/config"
import resumable from "@atom.io/resumable/astro"

export default defineConfig({
	integrations: [resumable()],
	outDir: "./dist",
	vite: { resolve: { tsconfigPaths: false } },
})
