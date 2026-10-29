import type { AstroIntegration } from "astro"

import type { WaterPluginOptions } from "./vite.ts"
import water from "./vite.ts"

export default function integration(
	options: WaterPluginOptions = {},
): AstroIntegration {
	return {
		name: `@atom.io/water`,
		hooks: {
			"astro:config:setup"({ addRenderer, updateConfig }) {
				addRenderer({
					name: `@atom.io/water`,
					clientEntrypoint: `@atom.io/water/astro-client`,
					serverEntrypoint: `@atom.io/water/astro-server`,
				})
				updateConfig({
					vite: {
						plugins: [water({ include: /\.water\.[jt]sx$/, ...options })],
					},
				})
			},
		},
	}
}
