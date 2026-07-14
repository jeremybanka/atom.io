import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"

const SUFFIX_DICTIONARY = {
	atom: `Atom`,
	atomFamily: `Atoms`,
	mutableAtom: `Atom`,
	mutableAtomFamily: `Atoms`,
	selector: `Selector`,
	selectorFamily: `Selectors`,
	timeline: `Timeline`,
	timelineFamily: `Timelines`,
	transaction: `Transaction`,
} as const

const PLURAL_DICTIONARY = {
	atom: `atoms`,
	atomFamily: `atom families`,
	mutableAtom: `atoms`,
	mutableAtomFamily: `atom families`,
	selector: `selectors`,
	selectorFamily: `selector families`,
	timeline: `timelines`,
	timelineFamily: `timeline families`,
	transaction: `transactions`,
}

type ResourceFactoryName = keyof typeof SUFFIX_DICTIONARY

export const namingConvention: {
	meta: {
		type: RuleType
		docs: {
			description: string
			recommended: boolean
			url: string
		}
		fixable: `code`
		schema: never[]
	}
	create(context: Rule.RuleContext): Rule.NodeListener
} = {
	meta: {
		type: `problem`,
		docs: {
			description: `The variable names given to atom.io resources should match their key properties and follow a consistent format`,
			recommended: false,
			url: ``,
		},
		fixable: `code`,
		schema: [],
	},

	create(context) {
		return {
			CallExpression(node) {
				// atom(...)
				if (
					node.callee.type !== `Identifier` &&
					node.callee.type !== `MemberExpression`
				) {
					return
				}
				// Must be assigned: const x = atom(...)
				if (node.parent?.type !== `VariableDeclarator`) return
				if (node.parent.init !== node) return
				if (node.parent.id.type !== `Identifier`) return

				let calleeName: ResourceFactoryName

				switch (node.callee.type) {
					case `Identifier`:
						calleeName = node.callee.name as ResourceFactoryName
						break
					case `MemberExpression`:
						if (node.callee.property.type !== `Identifier`) return
						calleeName = node.callee.property.name as ResourceFactoryName
						break
					default:
						return
				}

				switch (calleeName) {
					case `atom`:
					case `atomFamily`:
					case `mutableAtom`:
					case `mutableAtomFamily`:
					case `selector`:
					case `selectorFamily`:
					case `timeline`:
					case `timelineFamily`:
					case `transaction`:
						break // ^ targets of this rule
					default:
						return
				}

				const suffix = SUFFIX_DICTIONARY[calleeName]
				const plural = PLURAL_DICTIONARY[calleeName]

				const variableName = node.parent.id.name

				// Enforce the resource-specific suffix
				if (!variableName.endsWith(suffix)) {
					context.report({
						node: node.parent.id,
						message: `Names of ${plural} should end with '${suffix}'.`,
					})
					return
				}

				const expectedKey = variableName.slice(0, -suffix.length)

				// Must have first argument object
				const arg = node.arguments[0]
				if (arg?.type !== `ObjectExpression`) return

				// Find key property
				const keyProp = arg.properties.find(
					(prop): prop is ESTree.Property =>
						prop.type === `Property` &&
						((prop.key.type === `Identifier` && prop.key.name === `key`) ||
							(prop.key.type === `Literal` && prop.key.value === `key`)),
				)

				if (!keyProp) return

				const actualKey =
					keyProp.value.type === `Literal` &&
					typeof keyProp.value.value === `string`
						? keyProp.value.value
						: keyProp.value.type === `TemplateLiteral` &&
							  keyProp.value.expressions.length === 0
							? keyProp.value.quasis[0].value.cooked
							: undefined

				if (actualKey !== expectedKey) {
					context.report({
						node: keyProp.value,
						message: `Keys of ${plural} should be consistent with the names of their variables.`,
						fix(fixer) {
							return fixer.replaceText(
								keyProp.value,
								JSON.stringify(expectedKey),
							)
						},
					})
				}
			},
		}
	},
} satisfies Rule.RuleModule
