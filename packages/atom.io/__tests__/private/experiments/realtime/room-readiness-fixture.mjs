process.stdout.write(`AL`)
setTimeout(() => {
	process.stdout.write(`IVE`)
}, 5)

let pending = ``
setInterval(Date.now, 1_000)
process.stdin.setEncoding(`utf8`)
process.stdin.on(`data`, (chunk) => {
	pending += chunk
	if (pending.includes(`["exit"]`)) process.exit(0)
})
