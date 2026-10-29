import plugin, { Rules } from "@atom.io/eslint-plugin"
import { RuleTester } from "@typescript-eslint/rule-tester"
import { Linter } from "eslint"

const ruleTester = new RuleTester()
Object.assign(ruleTester, { describe, it })
const rule = Rules.banUseEffect
const errors = [{ messageId: `bannedUseEffect` as const }]

ruleTester.run(`ban-use-effect`, rule, {
	valid: [
		`import { useLayoutEffect } from "react"; useLayoutEffect(() => {}, [])`,
		`import { useLayoutEffect as useEffect } from "react"; useEffect(() => {}, [])`,
		`import React from "react"; React.useLayoutEffect(() => {}, [])`,
		`import * as React from "react"; React.useInsertionEffect(() => {}, [])`,
		`import { useEffect } from "other-library"; useEffect(() => {})`,
		`function useEffect() {} useEffect()`,
		`const React = { useEffect() {} }; React.useEffect()`,
		`import React from "react"; function example(React) { React.useEffect() }`,
		`import * as R from "react"; function example(R) { const { useEffect } = R; useEffect() }`,
		`import type { useEffect } from "react"; type Effect = typeof useEffect`,
		`import { type useEffect } from "react"; type Effect = typeof useEffect`,
		`import type React from "react"; type Effect = typeof React.useEffect`,
		`export type { useEffect } from "react"`,
		`export { type useEffect } from "react"`,
		`export type * from "react"`,
		{
			code: `const { useLayoutEffect } = require("react"); useLayoutEffect(() => {})`,
			languageOptions: { globals: { require: `readonly` } },
		},
		{
			code: `function example(require) { const { useEffect } = require("react"); useEffect() }`,
			languageOptions: { globals: { require: `readonly` } },
		},
	],
	invalid: [
		{
			name: `named import is reported once, regardless of call count`,
			code: `import { useEffect } from "react"; useEffect(() => {}); useEffect(() => {})`,
			errors,
		},
		{
			name: `aliased named import`,
			code: `import { useEffect as effect } from "react"; effect(() => {})`,
			errors,
		},
		{
			name: `unused import still acquires the banned hook`,
			code: `import { useEffect } from "react"`,
			errors,
		},
		{
			name: `renaming useEffect to useLayoutEffect does not change its identity`,
			code: `import { useEffect as useLayoutEffect } from "react"; useLayoutEffect(() => {})`,
			errors,
		},
		{
			name: `default import`,
			code: `import React from "react"; React.useEffect(() => {}, [])`,
			errors,
		},
		{
			name: `aliased namespace import`,
			code: `import * as R from "react"; R.useEffect(() => {}, [])`,
			errors,
		},
		{
			name: `computed property`,
			code: `import React from "react"; React["useEffect"](() => {})`,
			errors,
		},
		{
			name: `optional member access`,
			code: `import React from "react"; React?.useEffect?.(() => {})`,
			errors,
		},
		{
			name: `destructuring`,
			code: `import React from "react"; const { useEffect: effect } = React; effect(() => {})`,
			errors,
		},
		{
			name: `namespace alias`,
			code: `import React from "react"; const R = React; R.useEffect(() => {})`,
			errors,
		},
		{
			name: `passing the hook instead of calling it`,
			code: `import React from "react"; wrap(React.useEffect)`,
			errors,
		},
		{
			name: `named re-export`,
			code: `export { useEffect as effect } from "react"`,
			errors,
		},
		{
			name: `export star includes useEffect`,
			code: `export * from "react"`,
			errors,
		},
		{
			name: `CommonJS destructuring`,
			code: `const { useEffect: effect } = require("react"); effect(() => {})`,
			languageOptions: { globals: { require: `readonly` } },
			errors,
		},
		{
			name: `CommonJS namespace`,
			code: `const React = require("react"); React.useEffect(() => {})`,
			languageOptions: { globals: { require: `readonly` } },
			errors,
		},
		{
			name: `direct CommonJS access`,
			code: `require("react").useEffect(() => {})`,
			languageOptions: { globals: { require: `readonly` } },
			errors,
		},
	],
})

it(`the public plugin reports both guides without offering an automatic rewrite`, () => {
	const linter = new Linter()
	const messages = linter.verify(`import { useEffect } from "react"`, {
		plugins: { "atom.io": plugin },
		rules: { "atom.io/ban-use-effect": `error` },
	})
	expect(messages).toHaveLength(1)
	expect(messages[0]?.message).toContain(
		`https://atom.io.fyi/docs/against-use-effect`,
	)
	expect(messages[0]?.message).toContain(
		`node_modules/atom.io/docs/agent/packages/against-use-effect.md`,
	)
	expect(messages[0]?.fix).toBeUndefined()
	expect(messages[0]?.suggestions).toBeUndefined()
	expect(rule.meta.docs?.url).toBe(`https://atom.io.fyi/docs/against-use-effect`)
})
