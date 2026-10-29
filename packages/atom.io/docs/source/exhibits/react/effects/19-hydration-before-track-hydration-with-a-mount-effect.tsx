import { useEffect, useState } from "react"

export function Greeting() {
	const [didMount, setDidMount] = useState(false)
	useEffect(() => {
		setDidMount(true)
	}, [])
	if (!didMount) return <output>Welcome</output>
	return (
		<output>Welcome, {localStorage.getItem(`displayName`) ?? `guest`}</output>
	)
}
