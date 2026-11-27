import plugin, { Rules } from "@atom.io/eslint-plugin"
import parser from "@typescript-eslint/parser"
import { Linter } from "eslint"

// Both export forms must stay typed without any authoring utilities installed.
type IsAny<T> = 0 extends 1 & T ? true : false
export const typed: [
	IsAny<typeof plugin>,
	IsAny<typeof Rules.exactCatchTypes>,
	IsAny<typeof Rules.exactCatchTypes.create>,
] = [false, false, false]
export const defaultOptions: [{ permitAnnotation?: boolean }] | undefined =
	Rules.explicitStateTypes.defaultOptions
export const message: string =
	Rules.explicitStateTypes.meta.messages.noTypeArgument
export const docsUrl: string = Rules.namingConvention.meta.docs.url
export const effectMessage: string =
	Rules.banUseEffect.meta.messages.bannedUseEffect
// @ts-expect-error Named rules retain their specific message IDs.
Rules.explicitStateTypes.meta.messages.nonexistentMessage
type StateOptions = NonNullable<typeof Rules.explicitStateTypes.defaultOptions>
// @ts-expect-error Rule options retain their value types.
export const invalidOptions: StateOptions = [{ permitAnnotation: `yes` }]
// @ts-expect-error A missing declaration must not turn the plugin into any.
plugin.nonexistentProperty
const plugins: Linter.Config[`plugins`] = {
	"atom.io": plugin,
}

const source = `
declare function atom<T, E>(options: { key: string; default: T }): void
const countAtom = atom<number, Error>({ key: "count", default: 0 })
`
const syntaxSource = `const countAtom = atom({ key: "wrong", default: 0 }); const saveTransaction = transaction({ key: "save", do: () => {} })`
for (const name of Object.keys(plugins)) {
	const linter = new Linter()
	const config: Linter.Config = {
		files: [`**/*.ts`],
		plugins,
		languageOptions: {
			parser,
			parserOptions: {
				projectService: { allowDefaultProject: [`typed.ts`] },
				tsconfigRootDir: new URL(`.`, import.meta.url).pathname,
			},
		},
		rules: { [`${name}/exact-catch-types`]: `error` },
	}
	const typedMessages = linter.verify(source, config, { filename: `typed.ts` })
	if (
		typedMessages.length !== 1 ||
		typedMessages[0]?.messageId !== `missingCatchProperty`
	) {
		throw new Error(JSON.stringify(typedMessages))
	}
	const messages = linter.verify(
		syntaxSource,
		{
			files: [`**/*.ts`],
			plugins,
			languageOptions: { parser },
			rules: {
				[`${name}/explicit-state-types`]: `error`,
				[`${name}/explicit-transaction-types`]: `error`,
				[`${name}/naming-convention`]: `error`,
			},
		},
		{ filename: `syntax.ts` },
	)
	if (
		messages.length !== 3 ||
		!messages.some((reported) => reported.fix?.text === `"count"`)
	) {
		throw new Error(JSON.stringify(messages))
	}
	const effectMessages = linter.verify(
		`import React from "react"; React.useEffect(() => {}); React.useLayoutEffect(() => {})`,
		{
			plugins,
			rules: { [`${name}/ban-use-effect`]: `error` },
		},
	)
	if (
		effectMessages.length !== 1 ||
		effectMessages[0]?.messageId !== `bannedUseEffect` ||
		!effectMessages[0].message.includes(
			`https://atom.io.fyi/docs/against-use-effect`,
		) ||
		!effectMessages[0].message.includes(
			`node_modules/atom.io/docs/agent/packages/against-use-effect.md`,
		)
	) {
		throw new Error(JSON.stringify(effectMessages))
	}
}
