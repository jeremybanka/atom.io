import type { primitive } from "atom.io/foundations/json"
import type { ArrayUpdate } from "atom.io/transceivers/o-list"
import { OList } from "atom.io/transceivers/o-list"
import type { SetUpdate } from "atom.io/transceivers/u-list"
import { UList } from "atom.io/transceivers/u-list"

import * as U from "../../__util__/index.ts"

function bytesOf(update: string): number[] {
	return [...U.toBytes(update)]
}

describe(`transceiver wire encodings`, () => {
	it(`pins representative UList update bytes`, () => {
		const cases: [SetUpdate<primitive>, number[]][] = [
			[
				{ type: `add`, value: `z` },
				[
					48, // "0" means add
					31, // "US" separates the method from the data
					3, // "ETX" is the canonical string marker
					122, // "z"
				],
			],
			[
				{ type: `add`, value: null },
				[
					48, // "0" means add
					31, // "US" separates the method from the data
					2, // "STX" is the whole canonical null value
				],
			],
			[
				{ type: `delete`, value: false },
				[
					49, // "1" means delete
					31, // "US" separates the method from the data
					1, // "SOH" is the canonical boolean marker
					48, // "0" means false
				],
			],
			[
				{ type: `delete`, value: 13563 },
				[
					49, // "1" means delete
					31, // "US" separates the method from the data
					4, // "EOT" is the canonical number marker
					49, // "1"
					51, // "3"
					53, // "5"
					54, // "6"
					51, // "3"
				],
			],
			[
				{ type: `clear`, values: [1, 2, 3] },
				[
					50, // "2" means clear
					31, // "US" separates the method from the data
					4, // "EOT" originally meant end of transmission; here it means number
					49, // "1", the first value
					30, // "RS" separates data records
					4, // number
					50, // "2"
					30, // record separator
					4, // number
					51, // "3"
				],
			],
		]

		for (const [update, bytes] of cases) {
			expect(bytesOf(UList.packUpdate(update))).toEqual(bytes)
		}
	})

	it(`pins representative OList update bytes`, () => {
		const cases: [ArrayUpdate<primitive>, number[]][] = [
			[
				{ type: `set`, index: 0, next: `b` },
				[
					48, // "0" means set
					31, // "US" separates the method from the data
					48, // "0", the array index
					30, // "RS" separates data records
					3, // "ETX" is the canonical string marker
					98, // "b"
				],
			],
			[
				{ type: `set`, index: 0, next: `b`, prev: `a` },
				[
					48, // "0" means set
					31, // "US" separates the method from the data
					48, // "0", the array index
					30, // "RS" separates data records
					3, // "ETX" is the canonical string marker for next
					98, // "b"
					30, // record separator before prev
					3, // string marker for prev
					97, // "a"
				],
			],
			[
				{ type: `truncate`, length: 2, items: [null, true] },
				[
					49, // "1" means truncate
					31, // "US" separates the method from the data
					50, // "2", the new length
					30, // "RS" separates data records
					2, // "STX" is the whole canonical null value
					30, // record separator before the next removed item
					1, // "SOH" is the canonical boolean marker
					49, // "1" means true
				],
			],
			[
				{ type: `extend`, next: 4, prev: 2 },
				[
					50, // "2" means extend
					31, // "US" separates the method from the data
					52, // "4", the new length
					30, // "RS" separates data records
					50, // "2", the previous length
				],
			],
			[
				{ type: `pop`, value: 9 },
				[
					51, // "3" means pop
					31, // "US" separates the method from the data
					4, // "EOT" is the canonical number marker
					57, // "9"
				],
			],
			[
				{ type: `push`, items: [`x`, false, null] },
				[
					52, // "4" means push
					31, // "US" separates the method from the data
					3, // "ETX" is the canonical string marker
					120, // "x"
					30, // "RS" separates pushed items
					1, // "SOH" is the canonical boolean marker
					48, // "0" means false
					30, // record separator before the next pushed item
					2, // null
				],
			],
			[
				{ type: `shift`, value: true },
				[
					53, // "5" means shift
					31, // "US" separates the method from the data
					1, // "SOH" is the canonical boolean marker
					49, // "1" means true
				],
			],
			[
				{ type: `unshift`, items: [7, `q`] },
				[
					54, // "6" means unshift
					31, // "US" separates the method from the data
					4, // "EOT" is the canonical number marker
					55, // "7"
					30, // "RS" separates unshifted items
					3, // "ETX" is the canonical string marker
					113, // "q"
				],
			],
			[
				{ type: `copyWithin`, target: 2, start: 0, end: 4, prev: [`c`, null] },
				[
					55, // "7" means copyWithin
					31, // "US" separates the method from the data
					50, // "2", the target
					30, // "RS" separates target from start
					48, // "0", the start
					30, // record separator before end
					52, // "4", the end
					30, // first "RS" closes the numeric arguments
					30, // second "RS" opens the previous-items block
					3, // "ETX" is the canonical string marker
					99, // "c"
					30, // record separator before the next previous item
					2, // null
				],
			],
			[
				{ type: `fill`, value: false, start: 1, end: 3, prev: [1, `b`] },
				[
					56, // "8" means fill
					31, // "US" separates the method from the data
					1, // "SOH" is the canonical boolean marker
					48, // "0" means false
					30, // "RS" separates value from start
					49, // "1", the start
					30, // record separator before end
					51, // "3", the end
					30, // first "RS" closes the fill arguments
					30, // second "RS" opens the previous-items block
					4, // "EOT" is the canonical number marker
					49, // "1"
					30, // record separator before the next previous item
					3, // "ETX" is the canonical string marker
					98, // "b"
				],
			],
			[
				{
					type: `splice`,
					start: 1,
					deleteCount: 2,
					items: [`n`, false],
					deleted: [null, 8],
				},
				[
					57, // "9" means splice
					31, // "US" separates the method from the data
					49, // "1", the start
					30, // first "RS" closes the start section
					30, // second "RS" opens the delete-count section
					50, // "2", the delete count
					30, // first "RS" closes the delete-count section
					30, // second "RS" opens the inserted-items block
					3, // "ETX" is the canonical string marker
					110, // "n"
					30, // record separator before the next inserted item
					1, // "SOH" is the canonical boolean marker
					48, // "0" means false
					30, // first "RS" closes the inserted-items block
					30, // second "RS" opens the deleted-items block
					2, // null
					30, // record separator before the next deleted item
					4, // "EOT" is the canonical number marker
					56, // "8"
				],
			],
			[
				{ type: `reverse` },
				[
					49, // first digit of "10"
					48, // second digit of "10"; "10" means reverse
					31, // "US" remains even though reverse has no data
				],
			],
			[
				{ type: `sort`, next: [1, `a`, false], prev: [false, `a`, 1] },
				[
					49, // first digit of "11"
					49, // second digit of "11"; "11" means sort
					31, // "US" separates the method from the data
					4, // "EOT" is the canonical number marker
					49, // "1"
					30, // "RS" separates next-state items
					3, // "ETX" is the canonical string marker
					97, // "a"
					30, // record separator before the next next-state item
					1, // "SOH" is the canonical boolean marker
					48, // "0" means false
					30, // first "RS" closes the next-state block
					30, // second "RS" opens the previous-state block
					1, // boolean marker
					48, // false
					30, // record separator before the next previous-state item
					3, // string marker
					97, // "a"
					30, // record separator before the next previous-state item
					4, // number marker
					49, // "1"
				],
			],
		]

		for (const [update, bytes] of cases) {
			expect(bytesOf(OList.packUpdate(update))).toEqual(bytes)
		}
	})
})
