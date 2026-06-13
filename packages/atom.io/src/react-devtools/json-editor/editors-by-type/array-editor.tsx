import type { RegularAtomToken } from "atom.io"
import type { Json, JsonTypes } from "atom.io/foundations/json"
import { JSON_DEFAULTS } from "atom.io/foundations/json"
import { findInStore } from "atom.io/internal"
import { useI, useO } from "atom.io/react"
import { type ReactElement, useContext } from "react"

import { DevtoolsContext } from "../../store.ts"
import type { JsonEditorComponents, SetterOrUpdater } from ".."
import type { JsonEditorProps_INTERNAL } from "../json-editor-internal.tsx"
import { JsonEditor_INTERNAL } from "../json-editor-internal.tsx"
import { makeElementSetters } from "./utilities/array-elements.ts"
import {
	makePropertyRecasters,
	makePropertyRemovers,
} from "./utilities/object-properties.ts"

type ArrayElementProps = {
	path: ReadonlyArray<number | string>
	isReadonly: (path: ReadonlyArray<number | string>) => boolean
	isHidden: (path: ReadonlyArray<number | string>) => boolean
	data: unknown
	set: SetterOrUpdater<Json.Tree.Array>
	remove: (() => void) | undefined
	recast: (newType: keyof JsonTypes) => void
	Components: JsonEditorComponents
	testid?: string | undefined
	viewIsOpenAtom: RegularAtomToken<boolean, readonly (number | string)[]>
}
const ArrayElement = ({
	path,
	isReadonly,
	isHidden,
	data,
	set,
	remove,
	recast,
	Components,
	testid,
	viewIsOpenAtom,
}: ArrayElementProps): ReactElement => {
	const index = path[path.length - 1]
	const viewIsOpen = useO(viewIsOpenAtom)
	const setViewIsOpen = useI(viewIsOpenAtom)

	return (
		<JsonEditor_INTERNAL
			path={path}
			name={`${index}`}
			isReadonly={isReadonly}
			isHidden={isHidden}
			data={data}
			set={set}
			remove={remove}
			recast={recast}
			className="json_editor_element"
			Components={Components}
			isOpen={viewIsOpen}
			setIsOpen={setViewIsOpen}
			testid={`${testid}-element-${index}`}
		/>
	)
}

export const ArrayEditor = ({
	path = [],
	isReadonly = () => false,
	isHidden = () => false,
	data,
	set,
	Components,
	testid,
}: JsonEditorProps_INTERNAL<Json.Tree.Array>): ReactElement => {
	const { viewIsOpenAtoms, store } = useContext(DevtoolsContext)
	const disabled = isReadonly(path)

	const setElement = makeElementSetters(data, set)
	const removeElement = makePropertyRemovers(data, set)
	const recastElement = makePropertyRecasters(data, set)

	return (
		<Components.ArrayWrapper>
			<main className={`json_editor_elements${disabled ? ` readonly` : ``}`}>
				{data.map((element, index) => {
					const elementPath = [...path, index]
					const pathKey = elementPath.join(`,`)
					const viewIsOpenAtom = findInStore(store, viewIsOpenAtoms, [
						...path,
						index,
					])
					return (
						<ArrayElement
							key={pathKey}
							path={elementPath}
							isReadonly={isReadonly}
							isHidden={isHidden}
							data={element}
							set={setElement[index]}
							remove={removeElement[index]}
							recast={recastElement[index]}
							Components={Components}
							testid={testid}
							viewIsOpenAtom={viewIsOpenAtom}
						/>
					)
				})}
			</main>
			{!disabled ? (
				<footer>
					<Components.Button
						testid={`${testid}-add-element`}
						disabled={disabled}
						onClick={() => {
							set((current) => {
								const newData = [...current, JSON_DEFAULTS.string]
								return newData
							})
						}}
					>
						<Components.AddIcon />
					</Components.Button>
				</footer>
			) : null}
		</Components.ArrayWrapper>
	)
}
