import type { AstroIntegration, AstroUserConfig } from "astro"

import { compile } from "./compiler.ts"

// Resolve plugin types through our Astro peer, without another consumer dependency.
type Plugin = Extract<
	NonNullable<NonNullable<AstroUserConfig[`vite`]>[`plugins`]>[number],
	{ transform?: unknown }
>

export function resumablePlugin(): Plugin {
	return {
		name: `resumability`,
		enforce: `pre`,
		transform(code, id, options) {
			if (
				options?.ssr ||
				!code.includes(`resumability`) ||
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
		name: `resumability`,
		hooks: {
			"astro:config:setup"({ updateConfig }) {
				updateConfig({
					vite: {
						plugins: [resumablePlugin()],
						optimizeDeps: {
							exclude: [`resumability`, `resumability/client`],
						},
						ssr: { noExternal: [`resumability`] },
					},
				})
			},
		},
	}
}
