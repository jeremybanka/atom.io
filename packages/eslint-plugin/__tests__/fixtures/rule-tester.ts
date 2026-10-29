import { Rules } from "@atom.io/eslint-plugin"
import { RuleTester } from "@typescript-eslint/rule-tester"

// Compile against the packed public exports without assertions or source imports.
const tester = new RuleTester()
tester.run(`ban-use-effect`, Rules.banUseEffect, {
	valid: [`import { useLayoutEffect } from "react"`],
	invalid: [
		{
			code: `import { useEffect as effect } from "react"`,
			errors: [{ messageId: `bannedUseEffect` }],
		},
	],
})
tester.run(`explicit-state-types`, Rules.explicitStateTypes, {
	valid: [],
	invalid: [
		{
			code: `const countAtom = atom({ key: 'count', default: 0 })`,
			errors: [{ messageId: `noTypeArgument` }],
		},
	],
})
tester.run(`explicit-transaction-types`, Rules.explicitTransactionTypes, {
	valid: [],
	invalid: [
		{
			code: `const saveTransaction = transaction({ key: 'save', do: () => {} })`,
			errors: [{ messageId: `noTypeArgument` }],
		},
	],
})
tester.run(`exact-catch-types`, Rules.exactCatchTypes, {
	valid: [],
	invalid: [
		{
			code: `atom<number, Error>({ key: 'count', default: 0 })`,
			errors: [{ messageId: `missingCatchProperty` }],
		},
	],
})
