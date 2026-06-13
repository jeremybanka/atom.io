import { StatefulSubject, Subject } from "atom.io/foundations/subject"

describe(`Subject`, () => {
	it(`notifies subscribers with each next value`, () => {
		const subject = new Subject<string>()
		const first: string[] = []
		const second: string[] = []

		subject.subscribe(`first`, (value) => {
			first.push(value)
		})
		subject.subscribe(`second`, (value) => {
			second.push(value)
		})

		subject.next(`alpha`)
		subject.next(`beta`)

		expect(first).toEqual([`alpha`, `beta`])
		expect(second).toEqual([`alpha`, `beta`])
	})

	it(`stops notifying unsubscribed subscribers`, () => {
		const subject = new Subject<number>()
		const values: number[] = []

		const unsubscribe = subject.subscribe(`values`, (value) => {
			values.push(value)
		})

		subject.next(1)
		unsubscribe()
		subject.next(2)

		expect(values).toEqual([1])
	})
})

describe(`StatefulSubject`, () => {
	it(`stores the latest value before notifying subscribers`, () => {
		const subject = new StatefulSubject({ count: 0 })
		const observed: number[] = []

		subject.subscribe(`observer`, () => {
			observed.push(subject.state.count)
		})

		subject.next({ count: 1 })
		subject.next({ count: 2 })

		expect(subject.state).toEqual({ count: 2 })
		expect(observed).toEqual([1, 2])
	})
})
