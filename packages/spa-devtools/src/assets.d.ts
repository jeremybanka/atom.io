// eslint-disable-next-line quotes -- TypeScript requires a string literal for an ambient module name.
declare module "*.png" {
	const url: string
	export default url
}
