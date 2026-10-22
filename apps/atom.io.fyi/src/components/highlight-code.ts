import {
	codeToTokens,
	type Lang,
	type Theme,
	type ThemedToken,
	type TokensResult,
} from "@pierre/highlights"

import { getSyntaxTreatments, type SyntaxTreatment } from "./highlight-syntax.ts"

// Keep lexer scopes until the syntax pass has run. The returned tokens
// use the site's existing CSS variables, so both themes share the same rules.
const theme: Theme = {
	name: `atom.io`,
	appearance: `dark`,
	cssVariables: true,
	style: {},
}
const scopeColors: Record<string, string> = {
	comment: `comment`,
	keyword: `keyword`,
	operator: `operator`,
	punctuation: `punctuation`,
	type: `type`,
	constructor: `function`,
	function: `function`,
	tag: `function`,
	"tag-component-jsx": `function`,
	boolean: `boolean`,
	number: `number`,
	string: `string`,
	"text-jsx": `string`,
}

function getLanguage(filepath?: string): Lang {
	switch (filepath?.split(`.`).pop()) {
		case `sh`:
			return `bash`
		case `ts`:
			return `ts`
		case `js`:
			return `javascript`
		case `jsx`:
			return `jsx`
		case undefined:
		default:
			return `tsx`
	}
}

function getColor(scope: string): string {
	for (
		let parent = scope;
		parent;
		parent = parent.slice(0, parent.lastIndexOf(`-`))
	) {
		const color = scopeColors[parent]
		if (color) return `var(--code-${color}-color)`
		if (!parent.includes(`-`)) break
	}
	return `var(--code-color)`
}

function styleToken(
	token: ThemedToken,
	treatments: SyntaxTreatment[],
): ThemedToken {
	const scope = token.color?.slice(`var(--hls-`.length, -1) ?? ``
	const word = token.content.trim()
	let color = getColor(scope)
	const isCode =
		!token.type && !scope.includes(`jsx`) && !scope.endsWith(`jsdoc`)
	const isWord = isCode && /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(word)
	if (token.type === 1 || scope.endsWith(`jsdoc`))
		color = `var(--code-comment-color)`
	if (scope === `constant-builtin`) color = `var(--code-null-color)`
	const isLiteral =
		token.type === 2 ||
		scope === `number` ||
		scope === `boolean` ||
		scope === `constant-builtin`

	// Apply exact syntax ranges to tokens, including literal types. Never treat
	// comments or JSX text as code, and keep string metadata for import links.
	if (isWord || isLiteral) {
		const start = token.offset + token.content.indexOf(word)
		const range = treatments.find(
			(candidate) =>
				candidate.start <= start &&
				candidate.end >= start + word.length &&
				(!candidate.literalOnly || isLiteral),
		)
		color = range?.color ?? color
	}
	return { ...token, color }
}

export function highlightCode(code: string, filepath?: string): TokensResult {
	const lang = getLanguage(filepath)
	const result = codeToTokens(code, { lang, theme })
	const treatments = getSyntaxTreatments(code, lang)
	return {
		...result,
		fg: `var(--code-color)`,
		bg: undefined,
		tokens: result.tokens.map((line) =>
			line.map((token) => styleToken(token, treatments)),
		),
	}
}
