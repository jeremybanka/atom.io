/** @jsxImportSource preact */

const WIDTH = 256
const HEIGHT = 296

// @exhibit-region start stage-fill
const stageFill = <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#aaa3" />
// @exhibit-region end stage-fill

// @exhibit-region start grid-fill
const gridFill = (
	<rect
		x={-185}
		y={-10}
		width={WIDTH + 370}
		height={HEIGHT + 20}
		fill="url(#grid)"
	/>
)
// @exhibit-region end grid-fill

void stageFill
void gridFill
