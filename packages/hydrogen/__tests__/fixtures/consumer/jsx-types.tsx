import type { RegularAtomToken } from "atom.io"
import { useRef } from "hydrogen"
import type { JSX, TargetedEvent } from "hydrogen/jsx-runtime"

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false
type Expect<T extends true> = T
type Props<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag]
type RefElement<Tag extends keyof JSX.IntrinsicElements> =
	Props<Tag> extends { ref?: ((element: infer E) => void) | null | undefined }
		? E
		: never
type ClickTarget<Tag extends keyof JSX.IntrinsicElements> =
	Props<Tag> extends { onClick?: ((event: infer E) => void) | null | undefined }
		? E extends { currentTarget: infer T }
			? T
			: never
		: never

// Check every known HTML/SVG tag, including elements with no special attributes.
export type AllHTMLRefs = Expect<
	Equal<
		{
			[Tag in keyof HTMLElementTagNameMap]: RefElement<Tag>
		},
		{ [Tag in keyof HTMLElementTagNameMap]: HTMLElementTagNameMap[Tag] | null }
	>
>
export type AllHTMLTargets = Expect<
	Equal<
		{
			[Tag in keyof HTMLElementTagNameMap]: ClickTarget<Tag>
		},
		HTMLElementTagNameMap
	>
>
type SVGTags = Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>
export type AllSVGRefs = Expect<
	Equal<
		{
			[Tag in SVGTags]: RefElement<Tag>
		},
		{ [Tag in SVGTags]: SVGElementTagNameMap[Tag] | null }
	>
>
export type AllSVGTargets = Expect<
	Equal<
		{
			[Tag in SVGTags]: ClickTarget<Tag>
		},
		Pick<SVGElementTagNameMap, SVGTags>
	>
>
export type CustomRef = Expect<
	Equal<RefElement<`atom-panel`>, HTMLElement | null>
>
export type CustomTarget = Expect<Equal<ClickTarget<`atom-panel`>, HTMLElement>>
export type Keyboard = Expect<
	Equal<
		Parameters<NonNullable<Props<`input`>[`onKeyDownCapture`]>>[0],
		TargetedEvent<HTMLInputElement, KeyboardEvent>
	>
>
export type DoubleClick = Expect<
	Equal<
		Parameters<NonNullable<Props<`button`>[`onDoubleClick`]>>[0],
		TargetedEvent<HTMLButtonElement, MouseEvent>
	>
>
export type NativeTarget = Expect<
	Equal<
		Parameters<NonNullable<Props<`button`>[`onClick`]>>[0][`target`],
		EventTarget | null
	>
>

export function Examples(props: {
	input: RegularAtomToken<HTMLInputElement | null>
}): JSX.Element {
	const inputRef = useRef(props.input)
	return (
		<>
			<input
				ref={inputRef}
				type="number"
				value={2}
				checked={false}
				required
				min={0}
				max="10"
				step="any"
				autoComplete="off"
				onInput={(event) => {
					event.currentTarget.value = event.data ?? ``
				}}
				onChange={(event) => {
					event.currentTarget.checked = true
				}}
				onKeyDown={(event) => {
					event.currentTarget.value = event.key
				}}
				onKeyUpCapture={(event) => {
					event.currentTarget.value = event.code
				}}
				onBeforeInput={(event) => {
					event.currentTarget.value = event.inputType
				}}
				onCompositionEnd={(event) => {
					event.currentTarget.value = event.data
				}}
				onFocus={(event) => {
					event.currentTarget.select()
					event.relatedTarget
				}}
				onPaste={(event) => {
					event.currentTarget.value = event.clipboardData?.getData(`text`) ?? ``
				}}
			/>
			<button
				disabled={false}
				type="submit"
				form="form"
				onDoubleClick={(event) => {
					event.currentTarget.disabled = event.detail > 1
				}}
				onMouseDownCapture={(event) => {
					event.currentTarget.value = String(event.button)
				}}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId)
				}}
				onGotPointerCapture={(event) => {
					event.currentTarget.releasePointerCapture(event.pointerId)
				}}
				onLostPointerCaptureCapture={(event) => {
					event.currentTarget.value = String(event.pointerId)
				}}
			/>
			<a
				href="/docs"
				target="_blank"
				download="guide"
				ref={(element) => {
					if (element) element.href = `/docs`
				}}
			/>
			<textarea
				rows={4}
				cols={20}
				value="text"
				onInput={(event) => {
					event.currentTarget.setSelectionRange(0, 1)
				}}
			/>
			<select
				value="a"
				onChange={(event) => {
					event.currentTarget.selectedIndex = 0
				}}
			>
				<option value="a" selected>
					A
				</option>
			</select>
			<form
				method="post"
				onSubmit={(event) => {
					event.preventDefault()
					event.currentTarget.checkValidity()
					event.submitter
				}}
			/>
			<label htmlFor="name" />
			<img src="/image.png" alt="" width={40} loading="lazy" />
			<video
				controls
				preload="metadata"
				playsInline
				onEncrypted={(event) => {
					void event.currentTarget.play()
					event.initData
				}}
			/>
			<audio
				onWaitingForKey={(event) => {
					event.currentTarget.pause()
				}}
			/>
			<body
				onBeforeUnload={(event) => {
					event.returnValue = ``
					event.currentTarget.focus()
				}}
			/>
			<div
				onFullscreenChange={(event) => {
					event.currentTarget.requestFullscreen().catch(() => {})
				}}
			/>
			<details open>
				<summary>Details</summary>
			</details>
			<td colSpan={2} headers="name" />
			<svg viewBox="0 0 10 10" width="100%" xmlns="http://www.w3.org/2000/svg">
				<circle
					cx={5}
					cy="5"
					r={2}
					stroke="red"
					stroke-width={1}
					fill="none"
					ref={(element) => {
						if (element) element.r.baseVal.value = 3
					}}
					onClick={(event) => {
						event.currentTarget.cx.baseVal.value = event.clientX
					}}
				/>
				<path d="M0 0L10 10" pathLength={1} />
				<rect width={5} height={5} rx={1} />
				<linearGradient id="gradient" x1={0} x2="100%">
					<stop offset="50%" stop-color="red" />
				</linearGradient>
				<filter>
					<feGaussianBlur stdDeviation="2 3" in="SourceGraphic" />
				</filter>
				<use href="#shape" x={2} />
				<foreignObject width={5} height={5}>
					<input type="text" />
				</foreignObject>
			</svg>
			<atom-panel
				class="panel"
				tabIndex={0}
				role="region"
				aria-label="Panel"
				aria-expanded={false}
				data-count={2}
				ref={(element) => {
					if (!element) return
					element.focus()
					// @ts-expect-error Custom tags are HTMLElement, not HTMLDivElement.
					element.align
				}}
				onKeyDown={(event) => {
					event.currentTarget.dataset[`key`] = event.key
					// @ts-expect-error A generic HTMLElement has no form-control value.
					event.currentTarget.value
				}}
			/>
			<input value={undefined} disabled={null} onClick={undefined} ref={null} />
		</>
	)
}

// Compile-only rejection tests run with strict functions and null checking,
// against the package exports, including in the packed Breakage consumers.
export function Rejections(): JSX.Element[] {
	const textareaRef = (element: HTMLTextAreaElement | null): void => {
		void element?.rows
	}
	const inputRef = (element: HTMLInputElement | null): void => {
		element?.select()
	}
	const htmlRef = (element: HTMLElement | null): void => {
		element?.focus()
	}
	const requiredRef = (element: HTMLInputElement): void => {
		element.focus()
	}
	// @ts-expect-error Input values must be strings or numbers.
	const badValue = <input value={{ count: 1 }} />
	// @ts-expect-error Checked is boolean.
	const badChecked = <input checked="yes" />
	// @ts-expect-error href belongs to anchors, not buttons.
	const badButton = <button href="/docs" />
	// @ts-expect-error Inputs do not accept anchor attributes.
	const badInput = <input href="/docs" />
	// @ts-expect-error Global tags do not inherit input attributes.
	const badDiv = <div value="text" />
	// @ts-expect-error Custom tags have generic HTML attributes.
	const badCustom = <atom-panel checked />
	// @ts-expect-error Custom HTML tags do not inherit SVG attributes.
	const svgCustom = <atom-panel cx={2} />
	// @ts-expect-error A circle does not have a path's d attribute.
	const badCircle = <circle d="M0 0" />
	// @ts-expect-error A rect does not have a circle's radius.
	const badRect = <rect r={2} />
	// @ts-expect-error SVG attributes reject objects.
	const badSVG = <svg viewBox={{ x: 1 }} />
	// @ts-expect-error SVG uses literal presentation attribute names.
	const badStroke = <path strokeWidth={2} />
	// @ts-expect-error Numeric attributes reject booleans.
	const badSpan = <td colSpan={false} />
	// @ts-expect-error Button type is constrained.
	const badType = <button type="link" />
	// @ts-expect-error A misspelled attribute is not an escape hatch.
	const typo = <input palceholder="name" />
	// @ts-expect-error Style objects are unsupported by Hydrogen's runtime.
	const badStyle = <div style={{ color: `red` }} />
	// @ts-expect-error Owned content cannot be overwritten.
	const badHTML = <div innerHTML="<b>unsafe</b>" />
	// @ts-expect-error DOM methods are not JSX attributes.
	const badMethod = <input focus={() => {}} />
	// @ts-expect-error Event handlers must be functions.
	const badHandler = <input onInput="handler()" />
	// @ts-expect-error A mouse-only callback cannot handle keyboard events.
	const badEvent = <input onKeyDown={(event: MouseEvent) => event.button} />
	// @ts-expect-error Media-only events do not belong on an input.
	const badMediaEvent = <input onEncrypted={() => {}} />
	// @ts-expect-error Window/body-only events do not belong on generic custom tags.
	const badWindowEvent = <atom-panel onBeforeUnload={() => {}} />
	// @ts-expect-error Ref receives an input, not a textarea.
	const badRef = <input ref={textareaRef} />
	// @ts-expect-error Refs are called with null on cleanup.
	const nonNullableRef = <input ref={requiredRef} />
	// @ts-expect-error A generic custom tag cannot promise input-specific refs.
	const badCustomRef = <atom-panel ref={inputRef} />
	// @ts-expect-error An SVG circle cannot promise an HTML element ref.
	const badSVGRef = <circle ref={htmlRef} />
	const bubbling = (
		<button
			onClick={(event) => {
				// @ts-expect-error A bubbled event's target is not necessarily the button.
				event.target.disabled
			}}
		/>
	)
	const ref = (
		<input
			ref={(element) => {
				// @ts-expect-error Cleanup delivers null; callers must narrow first.
				element.value
			}}
		/>
	)
	return [
		badValue,
		badChecked,
		badButton,
		badInput,
		badDiv,
		badCustom,
		svgCustom,
		badCircle,
		badRect,
		badSVG,
		badStroke,
		badSpan,
		badType,
		typo,
		badStyle,
		badHTML,
		badMethod,
		badHandler,
		badEvent,
		badMediaEvent,
		badWindowEvent,
		badRef,
		nonNullableRef,
		badCustomRef,
		badSVGRef,
		bubbling,
		ref,
	]
}

// JSX deliberately allows unknown hyphenated attributes; object checks verify
// our own data/ARIA declarations without relying on that TypeScript escape.
export const aria: Props<`button`> = {
	// @ts-expect-error aria-expanded is booleanish.
	"aria-expanded": `sometimes`,
}
export const data: Props<`atom-panel`> = {
	// @ts-expect-error Data values must be serializable scalars.
	"data-state": { open: true },
}
export const unknown: Props<`input`> = {
	// @ts-expect-error No unrestricted string index signature.
	unknownAttribute: 1,
}
