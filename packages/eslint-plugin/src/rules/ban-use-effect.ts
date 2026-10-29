import type { TSESTree } from "@typescript-eslint/utils"
import { ASTUtils, ESLintUtils } from "@typescript-eslint/utils"

const GUIDE_URL = `https://atom.io.fyi/docs/against-use-effect`
const LOCAL_GUIDE = `node_modules/atom.io/docs/agent/packages/against-use-effect.md`
const createRule = ESLintUtils.RuleCreator(() => GUIDE_URL)

function isTypeOnly(node: TSESTree.Node): boolean {
	let current: TSESTree.Node | undefined = node
	while (current) {
		if (
			(`importKind` in current && current.importKind === `type`) ||
			(`exportKind` in current && current.exportKind === `type`)
		) {
			return true
		}
		current = current.parent
	}
	return false
}

export const banUseEffect: ESLintUtils.RuleModule<
	`bannedUseEffect`,
	[],
	unknown,
	ESLintUtils.RuleListener
> = createRule({
	name: `ban-use-effect`,
	meta: {
		type: `problem`,
		docs: {
			description: `Ban React useEffect in atom.io application code`,
		},
		messages: {
			bannedUseEffect: `React.useEffect is banned in atom.io application code. Choose a selector, event handler, transaction, atom effect, or Loadable state for the work. useLayoutEffect remains allowed for layout work. Guide: ${GUIDE_URL} Local: ${LOCAL_GUIDE}`,
		},
		schema: [],
	},
	defaultOptions: [],
	create(context) {
		return {
			"Program:exit"(program) {
				const tracker = new ASTUtils.ReferenceTracker(
					context.sourceCode.getScope(program),
					{ mode: `legacy` },
				)
				const trace = {
					react: { useEffect: { [ASTUtils.ReferenceTracker.READ]: true } },
				}
				for (const { node } of [
					...tracker.iterateEsmReferences(trace),
					...tracker.iterateCjsReferences(trace),
				]) {
					if (!isTypeOnly(node)) {
						context.report({ node, messageId: `bannedUseEffect` })
					}
				}
			},
		}
	},
})
