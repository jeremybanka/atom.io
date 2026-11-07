import type { AstroIntegration } from "astro"

import type { SpaPluginOptions } from "./vite.ts"
import spa from "./vite.ts"

export type {
	AstroApplicationContext,
	AstroStoreContext,
	AstroStoreFactory,
	AstroStorePreparation,
	Island,
} from "./astro-shared.ts"

export default function integration(
	options: SpaPluginOptions = {},
): AstroIntegration {
	return {
		name: `spa`,
		hooks: {
			"astro:config:setup"({
				config,
				addRenderer,
				addMiddleware,
				injectScript,
				updateConfig,
			}) {
				addMiddleware({
					entrypoint: `@atom.io/spa/astro-middleware`,
					order: `pre`,
				})
				injectScript(
					`page`,
					`import { browserApplication } from '@atom.io/spa/astro-application'; browserApplication(document);`,
				)
				const resumable = config.integrations.some(
					({ name }) => name === `resumability`,
				)
				addRenderer({
					name: `spa`,
					clientEntrypoint: resumable
						? `@atom.io/spa/astro-resumability-client`
						: `@atom.io/spa/astro-client`,
					serverEntrypoint: resumable
						? `@atom.io/spa/astro-resumability-server`
						: `@atom.io/spa/astro-server`,
				})
				updateConfig({
					vite: {
						plugins: [spa(options)],
					},
				})
			},
		},
	}
}
