import type { ESLint } from "eslint"

import * as Rules from "./public-rules.ts"

export { Rules }

const plugin: ESLint.Plugin = {
	rules: {
		"naming-convention": Rules.namingConvention,
		"exact-catch-types": Rules.exactCatchTypes,
		"explicit-state-types": Rules.explicitStateTypes,
		"explicit-transaction-types": Rules.explicitTransactionTypes,
	},
}

export default plugin
