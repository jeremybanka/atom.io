import type {
	AtomIODevtoolsHandle,
	AtomIODevtoolsProps,
} from "@atom.io/spa-devtools"

export async function mountDevelopmentDevtools(
	host: Element,
	options?: AtomIODevtoolsProps,
): Promise<AtomIODevtoolsHandle | undefined> {
	if (import.meta.env.DEV) {
		const [{ mountAtomIODevtools }] = await Promise.all([
			import(`@atom.io/spa-devtools`),
			import(`@atom.io/spa-devtools/css`),
		])
		return mountAtomIODevtools(host, options)
	}
}
