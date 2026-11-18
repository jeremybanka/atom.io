import type { JSX } from "@solidjs/web"

// eslint-disable-next-line quotes -- TypeScript module names require string literals.
declare module "@solidjs/web" {
	namespace JSX {
		interface IntrinsicElements {
			[tagname: `${string}-${string}`]:
				| JSX.HTMLAttributes<HTMLElement>
				| JSX.MathMLAttributes<MathMLElement>
				| JSX.SvgSVGAttributes<SVGElement>
		}
	}
}
