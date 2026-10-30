import type { AstroIntegration } from "astro"

import type { SpaPluginOptions } from "./vite.ts"
import spa from "./vite.ts"

export type {
	AstroStoreContext,
	AstroStoreFactory,
	Island,
} from "./astro-shared.ts"

export default function integration(
	options: SpaPluginOptions = {},
): AstroIntegration {
	return {
		name: `spa`,
		hooks: {
			"astro:config:setup"({ addRenderer, updateConfig }) {
				addRenderer({
					name: `spa`,
					clientEntrypoint: `@atom.io/spa/astro-client`,
					serverEntrypoint: `@atom.io/spa/astro-server`,
				})
				updateConfig({
					vite: {
						plugins: [spa({ include: /\.spa\.[jt]sx$/, ...options })],
					},
				})
			},
		},
	}
}
