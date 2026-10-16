import type { parse, parseForESLint } from "@typescript-eslint/parser"

// Preserve the parser's scope classes, whose private members carry type identity.
export declare namespace Scope {
	type ScopeManager = ReturnType<typeof parseForESLint>[`scopeManager`]
	type Scope = ScopeManager[`scopes`][number]
	type ParserVariable = Scope[`variables`][number]
	// ESLint may also inject globals without the parser's type/value flags.
	interface ESLintScopeVariable extends Omit<
		ParserVariable,
		`isTypeVariable` | `isValueVariable`
	> {
		writeable?: boolean
		eslintExplicitGlobal?: boolean
		eslintImplicitGlobalSetting?: `readonly` | `writable`
		eslintExplicitGlobalComments?: ReturnType<typeof parse>[`comments`]
	}
	type Variable = ParserVariable | ESLintScopeVariable
}
