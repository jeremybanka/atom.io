/* oxlint-disable typescript/switch-exhaustiveness-check */
import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils"

const createRule = ESLintUtils.RuleCreator(
	(name) => `https://atom.io.fyi/docs/eslint-plugin#${name}`,
)

type Options = [
	{
		permitAnnotation?: boolean
	},
]

export const explicitTransactionTypes: ESLintUtils.RuleModule<
	`noTypeArgument` | `noTypeArgumentOrAnnotation`,
	Options,
	unknown,
	ESLintUtils.RuleListener
> = createRule({
	name: `explicit-transaction-types`,
	meta: {
		type: `problem`,
		docs: {
			description: `Transaction declarations must have generic type arguments directly passed to them`,
		},
		messages: {
			noTypeArgument: `Transaction declarations must have generic type arguments directly passed to them.`,
			noTypeArgumentOrAnnotation: `Transaction declarations must have generic type arguments directly passed to them, or a top-level type annotation.`,
		},
		schema: [
			{
				type: `object`,
				properties: {
					permitAnnotation: {
						type: `boolean`,
						default: false,
					},
				},
				additionalProperties: false,
			},
		],
	},
	defaultOptions: [
		{
			permitAnnotation: false,
		},
	],
	create(context) {
		const options = context.options[0]
		const permitAnnotation = options?.permitAnnotation ?? false

		return {
			CallExpression(node) {
				const callee = node.callee

				switch (callee.type) {
					case `Identifier`:
						if (callee.name !== `transaction`) {
							return
						}
						break
					case `MemberExpression`:
						if (
							callee.property.type === AST_NODE_TYPES.Identifier
								? callee.property.name !== `transaction`
								: callee.property.type !== AST_NODE_TYPES.Literal ||
									callee.property.value !== `transaction`
						) {
							return
						}
						break
					default:
						return
				}

				const transactionOptions = node.arguments[0]
				if (transactionOptions?.type !== AST_NODE_TYPES.ObjectExpression) {
					return
				}

				const optionKeys = new Set(
					transactionOptions.properties.flatMap((property) => {
						if (property.type !== AST_NODE_TYPES.Property) {
							return []
						}
						if (property.key.type === AST_NODE_TYPES.Identifier) {
							return [property.key.name]
						}
						if (
							property.key.type === AST_NODE_TYPES.Literal &&
							typeof property.key.value === `string`
						) {
							return [property.key.value]
						}
						return []
					}),
				)
				if (!optionKeys.has(`key`) || !optionKeys.has(`do`)) {
					return
				}

				// Check for the *required* generic type argument first
				if (node.typeArguments) {
					return // Generic type argument is present, no error
				}

				// If generic arguments are missing, check if the top-level annotation exception is enabled AND present
				if (permitAnnotation) {
					let hasAnnotation = false
					// Check if the CallExpression is the initializer of a variable declarator
					const parent = node.parent
					if (
						parent?.type === AST_NODE_TYPES.VariableDeclarator &&
						parent.init === node
					) {
						// Check if the VariableDeclarator has an id with a TypeAnnotation
						const declaratorId = parent.id
						if (declaratorId.type === AST_NODE_TYPES.Identifier) {
							// Check for 'const myTransaction: TransactionToken<() => void> = ...'
							hasAnnotation = Boolean(declaratorId.typeAnnotation)
						}
					}
					if (hasAnnotation) {
						return // Exception met: type annotation is on the variable declaration
					}
					context.report({
						node,
						messageId: `noTypeArgumentOrAnnotation`,
					})
					return
				}

				context.report({
					node,
					messageId: `noTypeArgument`,
				})
			},
		}
	},
})
