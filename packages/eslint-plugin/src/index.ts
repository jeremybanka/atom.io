import type { ESLint } from "eslint"

import * as Rules from "./rules/index.ts"

export { Rules }

const plugin: ESLint.Plugin = {
	rules: {
		"ban-use-effect": Rules.banUseEffect as any,
		"naming-convention": Rules.namingConvention,
		"exact-catch-types": Rules.exactCatchTypes as any,
		"explicit-state-types": Rules.explicitStateTypes as any,
		"explicit-transaction-types": Rules.explicitTransactionTypes as any,
	},
}

export default plugin
