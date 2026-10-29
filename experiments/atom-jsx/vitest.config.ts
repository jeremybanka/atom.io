import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"

const config = defineOurVitestConfig({
	name: `atom-jsx-experiment`,
	target: `src`,
	test: { include: [`*.test.tsx`] },
})
config.root = import.meta.dirname
config.resolve!.alias = [
	{
		find: /^@atom\.io\/jsx-experiment\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `jsx-runtime.ts`),
	},
	...(config.resolve!.alias as { find: RegExp; replacement: string }[]),
]
export default config
