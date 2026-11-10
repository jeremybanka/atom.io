import { defineConfig } from "astro/config"
import spa from "@atom.io/spa/astro"
export default defineConfig({
	integrations: [spa()],
	vite: { resolve: { tsconfigPaths: false } },
})
