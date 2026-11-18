import solid from "@solidjs/vite-plugin"
import type { UserConfig } from "vite"
import { defineConfig } from "vite"

const config: UserConfig = defineConfig({
	plugins: [solid()],
})

export default config
