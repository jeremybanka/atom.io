import { RuleTester } from "@typescript-eslint/rule-tester"
import { Rules } from "atom.io/eslint-plugin"

const ruleTester = new RuleTester()
Object.assign(ruleTester, { describe, it })
const rule = Rules.explicitTransactionTypes

ruleTester.run(`explicit-transaction-types`, rule, {
	valid: [
		{
			name: `transaction`,
			code: `
      const incrementTransaction = transaction<(amount: number) => void>({
        key: "increment",
        do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
      })
    `,
		},
		{
			name: `transaction - top-level`,
			options: [{ permitAnnotation: true }],
			code: `
      const incrementTransaction: TransactionToken<(amount: number) => void> = transaction({
        key: "increment",
        do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
      })
    `,
		},
		{
			name: `Silo`,
			code: `
        const silo = new Silo("SILO", IMPLICIT.STORE)
        const incrementTransaction = silo.transaction<(amount: number) => void>({
          key: "increment",
          do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
        })
      `,
		},
		{
			name: `Other`,
			code: `
        someEntity.someMethod()
        super()
      `,
		},
	],
	invalid: [
		{
			name: `transaction`,
			options: [{ permitAnnotation: false }],
			code: `
        const incrementTransaction = transaction({
          key: "increment",
          do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
        })
      `,
			errors: [{ messageId: `noTypeArgument` }],
		},
		{
			name: `transaction - top-level option enabled, but no annotation or type argument`,
			options: [{ permitAnnotation: true }],
			code: `
        const incrementTransaction = transaction({
          key: "increment",
          do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
        })
      `,
			errors: [{ messageId: `noTypeArgumentOrAnnotation` }],
		},
		{
			name: `transaction - top-level option disabled, with annotation`,
			options: [{ permitAnnotation: false }],
			code: `
        const incrementTransaction: TransactionToken<(amount: number) => void> = transaction({
          key: "increment",
          do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
        })
      `,
			errors: [{ messageId: `noTypeArgument` }],
		},
		{
			name: `Silo`,
			code: `
        const silo = new Silo("SILO", IMPLICIT.STORE)
        const incrementTransaction = silo.transaction({
          key: "increment",
          do: ({ get, set }, amount) => set(countAtom, get(countAtom) + amount),
        })
      `,
			errors: [{ messageId: `noTypeArgument` }],
		},
	],
})
