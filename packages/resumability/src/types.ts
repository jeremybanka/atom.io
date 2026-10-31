export type Key = string | number | boolean | null | readonly Key[]
export type Json =
	| string
	| number
	| boolean
	| null
	| readonly Json[]
	| { readonly [key: string]: Json }
export type Encoded = [0] | [1, Json]
export interface Payload {
	version: 1
	values: [Key, Encoded][]
}
export interface Context {
	signal: AbortSignal
}
export interface Codec<T, Wire extends Json> {
	encode(value: T): Wire
	decode(value: Wire): T
}
export interface ResumableOptions<T, Wire extends Json = Json> {
	key: Key
	server(context: Context): T | Promise<T>
	client?: (context: Context) => NoInfer<T> | Promise<NoInfer<T>>
	codec?: Codec<T, Wire>
}
/** A value scope, independent of any renderer or state library. */
export interface Resumption {
	read<T, Wire extends Json>(options: ResumableOptions<T, Wire>): T | Promise<T>
}
