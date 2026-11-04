import { fileURLToPath } from "node:url"

import spa from "@atom.io/spa/vite"
import { defineConfig } from "vite"

export default defineConfig({
	root: fileURLToPath(new URL(`.`, import.meta.url)),
	plugins: [spa({ include: /\.[jt]sx$/ })],
	resolve: { dedupe: [`atom.io`, `@atom.io/spa`, `motion`] },
})
