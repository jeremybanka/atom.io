/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import type { ReadableToken } from "atom.io"
import type { FamilyNode } from "atom.io/introspection"

import css from "./StateIndex.module.css"
import { StateLeaf } from "./StateLeaf.tsx"
import { type Tools, useExpanded } from "./store.ts"

type Token = ReadableToken<unknown, any, any>
export function StateIndex(props: {
	tools: Tools
	type: `atoms` | `selectors`
}): SpaElement {
	const getStateIndex = useGetter<Map<string, Token | FamilyNode<Token>>>(
		props.type === `atoms` ? props.tools.atomIndex : props.tools.selectorIndex,
	)

	return (
		<state-index class={css.class}>
			<article data-index data-testid="state-index">
				{getStateIndex().size === 0 ? (
					<p>(no {props.type})</p>
				) : (
					[...getStateIndex().values()].map((node) => (
						<StateNode key={node.key} tools={props.tools} node={node} />
					))
				)}
			</article>
		</state-index>
	)
}
function StateNode(props: {
	tools: Tools
	node: Token | FamilyNode<Token>
}): SpaElement {
	const [getOpen, toggle] = useExpanded(props.tools, [props.node.key])
	return (
		<state-node
			data-state-key={props.node.key}
			data-testid={`state-${props.node.key}`}
		>
			{`familyMembers` in props.node ? (
				<>
					<node-heading>
						<button
							type="button"
							aria-expanded={getOpen()}
							data-testid={`open-close-state-family-${props.node.key}`}
							onClick={toggle}
						>
							{getOpen() ? `▾` : `▸`}
						</button>
						<h2 title={props.node.key}>{props.node.key}</h2>
						<small>family</small>
					</node-heading>
					{getOpen()
						? [...props.node.familyMembers.values()].map((token, index) => (
								<StateLeaf
									grouped
									separated={index > 0}
									key={token.key}
									tools={props.tools}
									token={token}
								/>
							))
						: null}
				</>
			) : (
				<StateLeaf tools={props.tools} token={props.node} />
			)}
		</state-node>
	)
}
