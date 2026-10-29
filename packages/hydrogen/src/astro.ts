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
					clientEntrypoint: `@atom.io/hydrogen/astro-client`,
					serverEntrypoint: `@atom.io/hydrogen/astro-server`,
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
