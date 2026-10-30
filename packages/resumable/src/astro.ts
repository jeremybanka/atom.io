import type { AstroIntegration, AstroUserConfig } from "astro"

import { compile } from "./compiler.ts"

// Resolve plugin types through our Astro peer, without another consumer dependency.
type Plugin = Extract<
	NonNullable<NonNullable<AstroUserConfig[`vite`]>[`plugins`]>[number],
	{ transform?: unknown }
>

export function resumablePlugin(): Plugin {
	return {
		name: `@atom.io/resumable`,
		enforce: `pre`,
		transform(code, id, options) {
			if (
				options?.ssr ||
				!code.includes(`@atom.io/resumable`) ||
				!(/\.[cm]?[jt]sx?(?:\?|$)/.test(id) || id.includes(`?astro&type=script`))
			)
				return null
			const result = compile(code, id.split(`?`)[0])
			return { code: result.code, map: result.map as any }
		},
	}
}
export default function resumableIntegration(): AstroIntegration {
	return {
		name: `@atom.io/resumable`,
		hooks: {
			"astro:config:setup"({ updateConfig }) {
				updateConfig({
					vite: {
						plugins: [resumablePlugin()],
						optimizeDeps: {
							exclude: [`@atom.io/resumable`, `@atom.io/resumable/client`],
						},
						ssr: { noExternal: [`@atom.io/resumable`] },
					},
				})
			},
		},
	}
}
