export type Fn = (...parameters: any[]) => any

export type Ctor<T> = new (...args: any[]) => T

export type Count<N extends number, A extends any[] = []> = [
	...A,
	any,
][`length`] extends N
	? A[`length`]
	: A[`length`] | Count<N, [...A, any]>

export type Each<E extends any[]> = {
	[P in Count<E[`length`]>]: E[P]
}

export type Refinement<A, B extends A> = (a: A) => a is B
