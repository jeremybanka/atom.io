// Vite's built-in flag, for type-checking the browser build exhibit.
interface ImportMetaEnv {
	readonly DEV: boolean
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
