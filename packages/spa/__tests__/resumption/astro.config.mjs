import { defineConfig } from "astro/config"
import spa from "@atom.io/spa/astro"
import resumability from "resumability/astro"
export default defineConfig({
	integrations: [resumability(), spa()],
	outDir: `./dist`,
})
