import { StatefulSubject } from "atom.io/foundations/subject"

const count = new StatefulSubject(0)

const unsubscribe = count.subscribe(`logger`, (value) => {
	console.log(value)
})

count.next(1)
count.state // 1

unsubscribe()
