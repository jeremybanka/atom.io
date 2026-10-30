import type { Child } from "./core.ts"

/** Native events retain their target; only currentTarget is the attached element. */
export type TargetedEvent<E extends Element, T extends Event = Event> = Omit<
	T,
	`currentTarget`
> & { readonly currentTarget: E }
export type EventHandler<E extends Element, T extends Event = Event> = (
	event: TargetedEvent<E, T>,
) => void
export type Ref<E extends Element> = (element: E | null) => void

type Attributes<T> = { [K in keyof T]?: T[K] | null | undefined }

// DOM event names are lowercase; JSX convention capitalizes each word.
interface EventNames {
	afterprint: `AfterPrint`
	beforeprint: `BeforePrint`
	beforeunload: `BeforeUnload`
	hashchange: `HashChange`
	languagechange: `LanguageChange`
	messageerror: `MessageError`
	pagehide: `PageHide`
	pagereveal: `PageReveal`
	pageshow: `PageShow`
	pageswap: `PageSwap`
	popstate: `PopState`
	rejectionhandled: `RejectionHandled`
	unhandledrejection: `UnhandledRejection`
	animationcancel: `AnimationCancel`
	animationend: `AnimationEnd`
	animationiteration: `AnimationIteration`
	animationstart: `AnimationStart`
	auxclick: `AuxClick`
	beforeinput: `BeforeInput`
	beforematch: `BeforeMatch`
	beforetoggle: `BeforeToggle`
	canplay: `CanPlay`
	canplaythrough: `CanPlayThrough`
	compositionend: `CompositionEnd`
	compositionstart: `CompositionStart`
	compositionupdate: `CompositionUpdate`
	cuechange: `CueChange`
	formdata: `FormData`
	waitingforkey: `WaitingForKey`
	enterpictureinpicture: `EnterPictureInPicture`
	leavepictureinpicture: `LeavePictureInPicture`
	contextlost: `ContextLost`
	contextmenu: `ContextMenu`
	contextrestored: `ContextRestored`
	dblclick: `DoubleClick` | `DblClick`
	dragend: `DragEnd`
	dragenter: `DragEnter`
	dragexit: `DragExit`
	dragleave: `DragLeave`
	dragover: `DragOver`
	dragstart: `DragStart`
	durationchange: `DurationChange`
	focusin: `FocusIn`
	focusout: `FocusOut`
	fullscreenchange: `FullscreenChange`
	fullscreenerror: `FullscreenError`
	gotpointercapture: `GotPointerCapture`
	keydown: `KeyDown`
	keypress: `KeyPress`
	keyup: `KeyUp`
	loadeddata: `LoadedData`
	loadedmetadata: `LoadedMetadata`
	loadstart: `LoadStart`
	lostpointercapture: `LostPointerCapture`
	mousedown: `MouseDown`
	mouseenter: `MouseEnter`
	mouseleave: `MouseLeave`
	mousemove: `MouseMove`
	mouseout: `MouseOut`
	mouseover: `MouseOver`
	mouseup: `MouseUp`
	pointercancel: `PointerCancel`
	pointerdown: `PointerDown`
	pointerenter: `PointerEnter`
	pointerleave: `PointerLeave`
	pointermove: `PointerMove`
	pointerout: `PointerOut`
	pointerover: `PointerOver`
	pointerrawupdate: `PointerRawUpdate`
	pointerup: `PointerUp`
	ratechange: `RateChange`
	scrollend: `ScrollEnd`
	securitypolicyviolation: `SecurityPolicyViolation`
	selectionchange: `SelectionChange`
	selectstart: `SelectStart`
	slotchange: `SlotChange`
	timeupdate: `TimeUpdate`
	touchcancel: `TouchCancel`
	touchend: `TouchEnd`
	touchmove: `TouchMove`
	touchstart: `TouchStart`
	transitioncancel: `TransitionCancel`
	transitionend: `TransitionEnd`
	transitionrun: `TransitionRun`
	transitionstart: `TransitionStart`
	volumechange: `VolumeChange`
	webkitanimationend: `WebkitAnimationEnd`
	webkitanimationiteration: `WebkitAnimationIteration`
	webkitanimationstart: `WebkitAnimationStart`
	webkittransitionend: `WebkitTransitionEnd`
}
type EventName<K extends string> =
	| K
	| Capitalize<K>
	| (K extends keyof EventNames ? EventNames[K] : never)
type ElementEvents<E extends Element> = E extends HTMLVideoElement
	? HTMLVideoElementEventMap
	: E extends HTMLMediaElement
		? HTMLMediaElementEventMap
		: E extends HTMLBodyElement
			? HTMLBodyElementEventMap
			: E extends HTMLFrameSetElement
				? HTMLFrameSetElementEventMap
				: E extends SVGSVGElement
					? SVGSVGElementEventMap
					: E extends SVGElement
						? SVGElementEventMap
						: HTMLElementEventMap
export type EventAttributes<E extends Element> = {
	[
		K in keyof ElementEvents<E> & string as `on${EventName<K>}${`` | `Capture`}`
	]?: EventHandler<E, Extract<ElementEvents<E>[K], Event>> | null | undefined
}

type Booleanish = boolean | `true` | `false`
export type AriaAttributes = Attributes<{
	[`aria-activedescendant`]: string
	[`aria-atomic`]: Booleanish
	[`aria-autocomplete`]: `none` | `inline` | `list` | `both`
	[`aria-braillelabel`]: string
	[`aria-brailleroledescription`]: string
	[`aria-busy`]: Booleanish
	[`aria-checked`]: Booleanish | `mixed`
	[`aria-colcount`]: number
	[`aria-colindex`]: number
	[`aria-colindextext`]: string
	[`aria-colspan`]: number
	[`aria-controls`]: string
	[`aria-current`]: Booleanish | `page` | `step` | `location` | `date` | `time`
	[`aria-describedby`]: string
	[`aria-description`]: string
	[`aria-details`]: string
	[`aria-disabled`]: Booleanish
	[`aria-dropeffect`]: `none` | `copy` | `execute` | `link` | `move` | `popup`
	[`aria-errormessage`]: string
	[`aria-expanded`]: Booleanish
	[`aria-flowto`]: string
	[`aria-grabbed`]: Booleanish
	[`aria-haspopup`]: Booleanish | `menu` | `listbox` | `tree` | `grid` | `dialog`
	[`aria-hidden`]: Booleanish
	[`aria-invalid`]: Booleanish | `grammar` | `spelling`
	[`aria-keyshortcuts`]: string
	[`aria-label`]: string
	[`aria-labelledby`]: string
	[`aria-level`]: number
	[`aria-live`]: `off` | `assertive` | `polite`
	[`aria-modal`]: Booleanish
	[`aria-multiline`]: Booleanish
	[`aria-multiselectable`]: Booleanish
	[`aria-orientation`]: `horizontal` | `vertical`
	[`aria-owns`]: string
	[`aria-placeholder`]: string
	[`aria-posinset`]: number
	[`aria-pressed`]: Booleanish | `mixed`
	[`aria-readonly`]: Booleanish
	[`aria-relevant`]:
		| `additions`
		| `additions removals`
		| `additions text`
		| `all`
		| `removals`
		| `removals additions`
		| `removals text`
		| `text`
		| `text additions`
		| `text removals`
	[`aria-required`]: Booleanish
	[`aria-roledescription`]: string
	[`aria-rowcount`]: number
	[`aria-rowindex`]: number
	[`aria-rowindextext`]: string
	[`aria-rowspan`]: number
	[`aria-selected`]: Booleanish
	[`aria-setsize`]: number
	[`aria-sort`]: `none` | `ascending` | `descending` | `other`
	[`aria-valuemax`]: number
	[`aria-valuemin`]: number
	[`aria-valuenow`]: number
	[`aria-valuetext`]: string
}>

export type DOMAttributes<E extends Element> = EventAttributes<E> &
	AriaAttributes &
	Attributes<{
		children: Child
		key: string | number
		ref: Ref<E>
		id: string
		class: string
		className: string
		style: string
		role: string
		slot: string
		tabIndex: number
		tabindex: number
	}> & { [K in `data-${string}`]?: string | number | boolean | null | undefined }

// HTML attribute names are case-insensitive. Support reflected property names
// as well as their lowercase markup spellings, without exposing DOM methods.
type HTMLAliases<T> = Attributes<T> & {
	[K in keyof T as K extends string ? Lowercase<K> : never]?:
		| T[K]
		| null
		| undefined
}
export type HTMLAttributes<E extends HTMLElement = HTMLElement> =
	DOMAttributes<E> &
		HTMLAliases<{
			accessKey: string
			autoCapitalize:
				| `off`
				| `none`
				| `on`
				| `sentences`
				| `words`
				| `characters`
			autoCorrect: `on` | `off`
			autoFocus: boolean
			contentEditable: `true` | `false` | `plaintext-only` | `inherit`
			dir: `auto` | `ltr` | `rtl`
			draggable: boolean
			enterKeyHint:
				| `enter`
				| `done`
				| `go`
				| `next`
				| `previous`
				| `search`
				| `send`
			exportparts: string
			hidden: boolean | `hidden` | `until-found`
			inert: boolean
			inputMode:
				| `none`
				| `text`
				| `tel`
				| `url`
				| `email`
				| `numeric`
				| `decimal`
				| `search`
			is: string
			itemID: string
			itemProp: string
			itemRef: string
			itemScope: boolean
			itemType: string
			lang: string
			nonce: string
			part: string
			popover: `auto` | `hint` | `manual`
			spellcheck: boolean
			title: string
			translate: `yes` | `no`
			virtualKeyboardPolicy: `auto` | `manual`
			writingSuggestions: `true` | `false`
			// RDFa
			about: string
			datatype: string
			inlist: string
			prefix: string
			property: string
			resource: string
			typeof: string
			vocab: string
		}>

type NumberOrString = number | string
type ReferrerPolicy =
	| ``
	| `no-referrer`
	| `no-referrer-when-downgrade`
	| `origin`
	| `origin-when-cross-origin`
	| `same-origin`
	| `strict-origin`
	| `strict-origin-when-cross-origin`
	| `unsafe-url`
type CrossOrigin = `` | `anonymous` | `use-credentials`
type FormOverrides = {
	form: string
	formAction: string
	formEncType: string
	formMethod: string
	formNoValidate: boolean
	formTarget: string
}
type MediaAttributes = {
	autoPlay: boolean
	controls: boolean
	controlsList: string
	crossOrigin: CrossOrigin
	disableRemotePlayback: boolean
	loop: boolean
	muted: boolean
	preload: `` | `none` | `metadata` | `auto`
	src: string
}
type LinkAttributes = {
	download: string | boolean
	href: string
	hrefLang: string
	ping: string
	referrerPolicy: ReferrerPolicy
	rel: string
	target: string
	type: string
}
type CellAttributes = {
	abbr: string
	colSpan: number
	headers: string
	rowSpan: number
	scope: `row` | `col` | `rowgroup` | `colgroup`
}

/** Attributes specific to each HTML tag, in addition to global attributes. */
interface HTMLTagAttributes {
	a: LinkAttributes
	area: LinkAttributes & {
		alt: string
		coords: string
		shape: `default` | `rect` | `circle` | `poly`
	}
	audio: MediaAttributes
	base: { href: string; target: string }
	blockquote: { cite: string }
	button: FormOverrides & {
		disabled: boolean
		name: string
		type: `button` | `submit` | `reset`
		value: NumberOrString
		popoverTarget: string
		popoverTargetAction: `hide` | `show` | `toggle`
		command: string
		commandFor: string
	}
	canvas: { height: NumberOrString; width: NumberOrString }
	col: { span: number }
	colgroup: { span: number }
	data: { value: NumberOrString }
	del: { cite: string; dateTime: string }
	details: { name: string; open: boolean }
	dialog: { open: boolean; closedBy: `any` | `closerequest` | `none` }
	embed: {
		height: NumberOrString
		src: string
		type: string
		width: NumberOrString
	}
	fieldset: { disabled: boolean; form: string; name: string }
	form: {
		acceptCharset: string
		[`accept-charset`]: string
		action: string
		autoComplete: `on` | `off`
		encType: string
		method: string
		name: string
		noValidate: boolean
		rel: string
		target: string
	}
	html: { xmlns: string }
	iframe: {
		allow: string
		allowFullScreen: boolean
		credentialless: boolean
		height: NumberOrString
		loading: `eager` | `lazy`
		name: string
		referrerPolicy: ReferrerPolicy
		sandbox: string
		src: string
		srcDoc: string
		width: NumberOrString
	}
	img: {
		alt: string
		crossOrigin: CrossOrigin
		decoding: `async` | `sync` | `auto`
		fetchPriority: `high` | `low` | `auto`
		height: NumberOrString
		isMap: boolean
		loading: `eager` | `lazy`
		referrerPolicy: ReferrerPolicy
		sizes: string
		src: string
		srcSet: string
		useMap: string
		width: NumberOrString
	}
	input: FormOverrides & {
		accept: string
		alt: string
		autoComplete: string
		capture: boolean | `user` | `environment`
		checked: boolean
		defaultChecked: boolean
		defaultValue: NumberOrString
		dirName: string
		disabled: boolean
		height: NumberOrString
		list: string
		max: NumberOrString
		maxLength: number
		min: NumberOrString
		minLength: number
		multiple: boolean
		name: string
		pattern: string
		placeholder: string
		popoverTarget: string
		popoverTargetAction: `hide` | `show` | `toggle`
		readOnly: boolean
		required: boolean
		size: number
		src: string
		step: NumberOrString
		type: string
		value: NumberOrString
		width: NumberOrString
	}
	ins: { cite: string; dateTime: string }
	label: { for: string; htmlFor: string; form: string }
	li: { value: number }
	link: {
		as: string
		blocking: string
		crossOrigin: CrossOrigin
		disabled: boolean
		fetchPriority: `high` | `low` | `auto`
		href: string
		hrefLang: string
		imageSizes: string
		imageSrcSet: string
		integrity: string
		media: string
		referrerPolicy: ReferrerPolicy
		rel: string
		sizes: string
		type: string
	}
	map: { name: string }
	meta: {
		charSet: string
		content: string
		httpEquiv: string
		[`http-equiv`]: string
		media: string
		name: string
	}
	meter: {
		high: number
		low: number
		max: number
		min: number
		optimum: number
		value: number
	}
	object: {
		data: string
		form: string
		height: NumberOrString
		name: string
		type: string
		useMap: string
		width: NumberOrString
	}
	ol: { reversed: boolean; start: number; type: `1` | `a` | `A` | `i` | `I` }
	optgroup: { disabled: boolean; label: string }
	option: {
		disabled: boolean
		label: string
		selected: boolean
		value: NumberOrString
	}
	output: { for: string; htmlFor: string; form: string; name: string }
	progress: { max: number; value: number }
	q: { cite: string }
	script: {
		async: boolean
		blocking: string
		charSet: string
		crossOrigin: CrossOrigin
		defer: boolean
		fetchPriority: `high` | `low` | `auto`
		integrity: string
		noModule: boolean
		referrerPolicy: ReferrerPolicy
		src: string
		type: string
	}
	select: {
		autoComplete: string
		disabled: boolean
		form: string
		multiple: boolean
		name: string
		required: boolean
		size: number
		value: NumberOrString
	}
	slot: { name: string }
	source: {
		height: NumberOrString
		media: string
		sizes: string
		src: string
		srcSet: string
		type: string
		width: NumberOrString
	}
	style: { blocking: string; media: string; title: string; type: string }
	table: { cellPadding: NumberOrString; cellSpacing: NumberOrString }
	td: CellAttributes
	template: {
		shadowRootClonable: boolean
		shadowRootDelegatesFocus: boolean
		shadowRootMode: `open` | `closed`
		shadowRootSerializable: boolean
	}
	textarea: {
		autoComplete: string
		cols: number
		defaultValue: string
		dirName: string
		disabled: boolean
		form: string
		maxLength: number
		minLength: number
		name: string
		placeholder: string
		readOnly: boolean
		required: boolean
		rows: number
		value: string
		wrap: `hard` | `soft` | `off`
	}
	th: CellAttributes
	time: { dateTime: string }
	track: {
		default: boolean
		kind: `subtitles` | `captions` | `descriptions` | `chapters` | `metadata`
		label: string
		src: string
		srcLang: string
	}
	video: MediaAttributes & {
		disablePictureInPicture: boolean
		height: NumberOrString
		playsInline: boolean
		poster: string
		width: NumberOrString
	}
}

export type HTMLIntrinsicElements = {
	[Tag in keyof HTMLElementTagNameMap]: HTMLAttributes<
		HTMLElementTagNameMap[Tag]
	> &
		(Tag extends keyof HTMLTagAttributes
			? HTMLAliases<HTMLTagAttributes[Tag]>
			: {})
}

/** SVG uses literal attribute names: e.g. stroke-width, not strokeWidth. */
export type SVGAttributes<E extends SVGElement = SVGElement> = DOMAttributes<E> &
	Attributes<{
		lang: string
		[`xml:lang`]: string
		[`xml:space`]: `default` | `preserve`
		xmlns: string
		[`xmlns:xlink`]: string
		[`alignment-baseline`]: string
		[`baseline-shift`]: NumberOrString
		clip: string
		[`clip-path`]: string
		[`clip-rule`]: `nonzero` | `evenodd` | `inherit`
		color: string
		[`color-interpolation`]: string
		[`color-interpolation-filters`]: string
		[`color-rendering`]: string
		cursor: string
		direction: `ltr` | `rtl` | `inherit`
		display: string
		[`dominant-baseline`]: string
		fill: string
		[`fill-opacity`]: NumberOrString
		[`fill-rule`]: `nonzero` | `evenodd` | `inherit`
		filter: string
		[`flood-color`]: string
		[`flood-opacity`]: NumberOrString
		[`font-family`]: string
		[`font-size`]: NumberOrString
		[`font-size-adjust`]: NumberOrString
		[`font-stretch`]: string
		[`font-style`]: string
		[`font-variant`]: string
		[`font-weight`]: NumberOrString
		[`image-rendering`]: string
		[`letter-spacing`]: NumberOrString
		[`lighting-color`]: string
		[`marker-end`]: string
		[`marker-mid`]: string
		[`marker-start`]: string
		mask: string
		opacity: NumberOrString
		overflow: string
		[`paint-order`]: string
		[`pointer-events`]: string
		[`shape-rendering`]: string
		[`stop-color`]: string
		[`stop-opacity`]: NumberOrString
		stroke: string
		[`stroke-dasharray`]: NumberOrString
		[`stroke-dashoffset`]: NumberOrString
		[`stroke-linecap`]: `butt` | `round` | `square` | `inherit`
		[`stroke-linejoin`]: `miter` | `round` | `bevel` | `inherit`
		[`stroke-miterlimit`]: NumberOrString
		[`stroke-opacity`]: NumberOrString
		[`stroke-width`]: NumberOrString
		[`text-anchor`]: `start` | `middle` | `end` | `inherit`
		[`text-decoration`]: string
		[`text-rendering`]: string
		transform: string
		[`transform-origin`]: string
		[`unicode-bidi`]: string
		[`vector-effect`]: string
		visibility: string
		[`word-spacing`]: NumberOrString
		[`writing-mode`]: string
	}>

type SVGBox = {
	x: NumberOrString
	y: NumberOrString
	width: NumberOrString
	height: NumberOrString
}
type SVGViewBox = { viewBox: string; preserveAspectRatio: string }
type SVGLink = { href: string; [`xlink:href`]: string }
type SVGFilterPrimitive = SVGBox & { result: string }
type SVGAnimation = SVGLink & {
	attributeName: string
	attributeType: string
	begin: NumberOrString
	dur: NumberOrString
	end: NumberOrString
	min: NumberOrString
	max: NumberOrString
	restart: string
	repeatCount: NumberOrString
	repeatDur: NumberOrString
	calcMode: string
	values: string
	keyTimes: string
	keySplines: string
	from: NumberOrString
	to: NumberOrString
	by: NumberOrString
	additive: string
	accumulate: string
}
type SVGText = {
	x: NumberOrString
	y: NumberOrString
	dx: NumberOrString
	dy: NumberOrString
	rotate: NumberOrString
	textLength: NumberOrString
	lengthAdjust: `spacing` | `spacingAndGlyphs`
}
interface SVGTagAttributes {
	a: SVGLink & {
		target: string
		download: string
		rel: string
		hreflang: string
		type: string
	}
	animate: SVGAnimation
	animateMotion: SVGAnimation & {
		path: string
		keyPoints: string
		rotate: NumberOrString
		origin: string
	}
	animateTransform: SVGAnimation & {
		type: `translate` | `scale` | `rotate` | `skewX` | `skewY`
	}
	circle: {
		cx: NumberOrString
		cy: NumberOrString
		r: NumberOrString
		pathLength: number
	}
	clipPath: { clipPathUnits: `userSpaceOnUse` | `objectBoundingBox` }
	ellipse: {
		cx: NumberOrString
		cy: NumberOrString
		rx: NumberOrString
		ry: NumberOrString
		pathLength: number
	}
	feBlend: SVGFilterPrimitive & { in: string; in2: string; mode: string }
	feColorMatrix: SVGFilterPrimitive & {
		in: string
		type: string
		values: string
	}
	feComponentTransfer: SVGFilterPrimitive & { in: string }
	feComposite: SVGFilterPrimitive & {
		in: string
		in2: string
		operator: string
		k1: number
		k2: number
		k3: number
		k4: number
	}
	feConvolveMatrix: SVGFilterPrimitive & {
		in: string
		order: NumberOrString
		kernelMatrix: string
		divisor: number
		bias: number
		targetX: number
		targetY: number
		edgeMode: string
		preserveAlpha: Booleanish
	}
	feDiffuseLighting: SVGFilterPrimitive & {
		in: string
		surfaceScale: number
		diffuseConstant: number
		kernelUnitLength: NumberOrString
	}
	feDisplacementMap: SVGFilterPrimitive & {
		in: string
		in2: string
		scale: number
		xChannelSelector: string
		yChannelSelector: string
	}
	feDistantLight: { azimuth: number; elevation: number }
	feDropShadow: SVGFilterPrimitive & {
		dx: NumberOrString
		dy: NumberOrString
		stdDeviation: NumberOrString
	}
	feFlood: SVGFilterPrimitive
	feFuncA: {
		type: string
		tableValues: string
		slope: number
		intercept: number
		amplitude: number
		exponent: number
		offset: number
	}
	feFuncB: SVGTagAttributes[`feFuncA`]
	feFuncG: SVGTagAttributes[`feFuncA`]
	feFuncR: SVGTagAttributes[`feFuncA`]
	feGaussianBlur: SVGFilterPrimitive & {
		in: string
		stdDeviation: NumberOrString
		edgeMode: string
	}
	feImage: SVGFilterPrimitive &
		SVGLink & { preserveAspectRatio: string; crossOrigin: CrossOrigin }
	feMerge: SVGFilterPrimitive
	feMergeNode: { in: string }
	feMorphology: SVGFilterPrimitive & {
		in: string
		operator: `erode` | `dilate`
		radius: NumberOrString
	}
	feOffset: SVGFilterPrimitive & {
		in: string
		dx: NumberOrString
		dy: NumberOrString
	}
	fePointLight: { x: number; y: number; z: number }
	feSpecularLighting: SVGFilterPrimitive & {
		in: string
		surfaceScale: number
		specularConstant: number
		specularExponent: number
		kernelUnitLength: NumberOrString
	}
	feSpotLight: {
		x: number
		y: number
		z: number
		pointsAtX: number
		pointsAtY: number
		pointsAtZ: number
		specularExponent: number
		limitingConeAngle: number
	}
	feTile: SVGFilterPrimitive & { in: string }
	feTurbulence: SVGFilterPrimitive & {
		baseFrequency: NumberOrString
		numOctaves: number
		seed: number
		stitchTiles: string
		type: string
	}
	filter: SVGBox & { filterUnits: string; primitiveUnits: string }
	foreignObject: SVGBox
	image: SVGBox &
		SVGLink & {
			preserveAspectRatio: string
			crossOrigin: CrossOrigin
			decoding: `async` | `sync` | `auto`
		}
	line: {
		x1: NumberOrString
		y1: NumberOrString
		x2: NumberOrString
		y2: NumberOrString
		pathLength: number
	}
	linearGradient: SVGLink & {
		x1: NumberOrString
		y1: NumberOrString
		x2: NumberOrString
		y2: NumberOrString
		gradientUnits: string
		gradientTransform: string
		spreadMethod: string
	}
	marker: SVGViewBox & {
		refX: NumberOrString
		refY: NumberOrString
		markerWidth: NumberOrString
		markerHeight: NumberOrString
		markerUnits: string
		orient: NumberOrString
	}
	mask: SVGBox & { maskUnits: string; maskContentUnits: string }
	mpath: SVGLink
	path: { d: string; pathLength: number }
	pattern: SVGBox &
		SVGViewBox &
		SVGLink & {
			patternUnits: string
			patternContentUnits: string
			patternTransform: string
		}
	polygon: { points: string; pathLength: number }
	polyline: SVGTagAttributes[`polygon`]
	radialGradient: SVGLink & {
		cx: NumberOrString
		cy: NumberOrString
		r: NumberOrString
		fx: NumberOrString
		fy: NumberOrString
		fr: NumberOrString
		gradientUnits: string
		gradientTransform: string
		spreadMethod: string
	}
	rect: SVGBox & { rx: NumberOrString; ry: NumberOrString; pathLength: number }
	script: SVGLink & { type: string; crossOrigin: CrossOrigin }
	set: SVGAnimation
	stop: { offset: NumberOrString }
	style: { type: string; media: string; title: string }
	svg: SVGBox & SVGViewBox & { version: string }
	symbol: SVGBox & SVGViewBox & { refX: NumberOrString; refY: NumberOrString }
	text: SVGText
	textPath: SVGLink & {
		startOffset: NumberOrString
		method: string
		spacing: string
		side: string
		textLength: NumberOrString
		lengthAdjust: string
	}
	tspan: SVGText
	use: SVGBox & SVGLink
	view: SVGViewBox & { viewTarget: string }
}
export type SVGIntrinsicElements = {
	[Tag in keyof SVGElementTagNameMap]: SVGAttributes<SVGElementTagNameMap[Tag]> &
		(Tag extends keyof SVGTagAttributes ? Attributes<SVGTagAttributes[Tag]> : {})
}

// JSX cannot infer namespace from parents. Shared names (a, script, style,
// title) use HTML types; unambiguous SVG tags retain their concrete SVG type.
export type NativeElements = HTMLIntrinsicElements &
	Omit<SVGIntrinsicElements, keyof HTMLIntrinsicElements>
