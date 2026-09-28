import type { ESLint, Rule } from "eslint"

import * as Rules from "./rules/index.ts"

export { Rules }

// ESLint's configuration types use ESTree; named rules retain TypeScript AST types.
const plugin: ESLint.Plugin = {
	rules: {
		"naming-convention": Rules.namingConvention,
		"exact-catch-types": Rules.exactCatchTypes as unknown as Rule.RuleModule,
		"explicit-state-types":
			Rules.explicitStateTypes as unknown as Rule.RuleModule,
		"explicit-transaction-types":
			Rules.explicitTransactionTypes as unknown as Rule.RuleModule,
	},
}

export default plugin
