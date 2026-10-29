import type { AstroIntegration } from "astro"

import type { HydrogenPluginOptions } from "./vite.ts"
import hydrogen from "./vite.ts"

export default function integration(
	options: HydrogenPluginOptions = {},
): AstroIntegration {
	return {
		name: `hydrogen`,
		hooks: {
			"astro:config:setup"({ addRenderer, updateConfig }) {
				addRenderer({
					name: `hydrogen`,
					clientEntrypoint: `hydrogen/astro-client`,
					serverEntrypoint: `hydrogen/astro-server`,
				})
				updateConfig({
					vite: {
						plugins: [hydrogen({ include: /\.hydrogen\.[jt]sx$/, ...options })],
					},
				})
			},
		},
	}
}
