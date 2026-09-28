import type { Rule } from "eslint"

import * as implementation from "./rules/index.ts"

// Consumers configure ESLint rules; the authoring utility types stay internal.
export const exactCatchTypes: Rule.RuleModule =
	implementation.exactCatchTypes as unknown as Rule.RuleModule
export const explicitStateTypes: Rule.RuleModule =
	implementation.explicitStateTypes as unknown as Rule.RuleModule
export const explicitTransactionTypes: Rule.RuleModule =
	implementation.explicitTransactionTypes as unknown as Rule.RuleModule
export const namingConvention: Rule.RuleModule = implementation.namingConvention
