import base from "../spa/vitest.config.ts"

export default {
	...base,
	root: import.meta.dirname,
	test: {
		...base.test,
		name: `spa-konva`,
		include: [`__tests__/**/*.test.tsx`],
	},
}
