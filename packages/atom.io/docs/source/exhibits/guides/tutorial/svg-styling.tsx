/** @jsxImportSource preact */

const WIDTH = 256
const HEIGHT = 296

const stageFill = (
	// @exhibit-region start stage-fill
	<rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#aaa3" />
	// @exhibit-region end stage-fill
)

const gridFill = (
	// @exhibit-region start grid-fill
	<rect
		x={-185}
		y={-10}
		width={WIDTH + 370}
		height={HEIGHT + 20}
		fill="url(#grid)"
	/>
	// @exhibit-region end grid-fill
)

void stageFill
void gridFill
