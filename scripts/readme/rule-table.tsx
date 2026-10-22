/** @jsxImportSource galley.md */
import plugin from "@atom.io/eslint-plugin"
import type { Component } from "galley.md"

import { InlineCode } from "./inline-code.ts"

export const RuleTable: Component = () => (
	<table>
		<thead>
			<tr>
				<th>Rule</th>
				<th>Description</th>
			</tr>
		</thead>
		<tbody>
			{Object.entries(plugin.rules ?? {}).map(([name, rule]) => (
				<tr key={name}>
					<td>
						<InlineCode value={`atom.io/${name}`} />
					</td>
					<td>
						{typeof rule === `object`
							? (rule.meta?.docs?.description ?? ``)
							: ``}
					</td>
				</tr>
			))}
		</tbody>
	</table>
)
