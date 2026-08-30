import type { UserConfig } from "vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const config: UserConfig = defineConfig({
	plugins: [solid()],
})

export default config
