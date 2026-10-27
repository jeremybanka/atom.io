/** @jsxImportSource galley.md */
import { type Component, Markdown } from "galley.md"

import {
	CREATE_ATOM_OPTIONS,
	OPTION_VALUES,
	TEMPLATES,
} from "../../packages/create-atom.io/src/create-atom-options.ts"
import { InlineCode } from "./inline-code.ts"

export const TemplateTable: Component = () => (
	<Markdown.Table>
		<thead>
			<tr>
				<th>Template</th>
				<th>What you get</th>
			</tr>
		</thead>
		<tbody>
			{Object.entries(TEMPLATES).map(([name, template]) => (
				<tr key={name}>
					<td>
						<InlineCode value={name} />
					</td>
					<td>{template.description}</td>
				</tr>
			))}
		</tbody>
	</Markdown.Table>
)

export const OptionsTable: Component = () => (
	<Markdown.Table>
		<thead>
			<tr>
				<th>Option</th>
				<th>Aliases</th>
				<th>Values</th>
			</tr>
		</thead>
		<tbody>
			{Object.entries(OPTION_VALUES).map(([name, values]) => {
				const config =
					CREATE_ATOM_OPTIONS.optionConfigs[name as keyof typeof OPTION_VALUES]
				const aliases = (config.aliases ?? []).map((alias) => `--${alias}`)
				if (config.flag) aliases.push(`-${config.flag}`)
				return (
					<tr key={name}>
						<td>
							<InlineCode value={`--${name}`} />
						</td>
						<td>
							{aliases.map((alias, index) => (
								<>
									{index > 0 ? `, ` : ``}
									<InlineCode value={alias} />
								</>
							))}
						</td>
						<td>
							{values.map((value, index) => (
								<>
									{index > 0 ? `, ` : ``}
									<InlineCode value={String(value)} />
								</>
							))}
						</td>
					</tr>
				)
			})}
		</tbody>
	</Markdown.Table>
)
