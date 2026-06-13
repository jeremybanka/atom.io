import { type } from "arktype"
import { Junction } from "atom.io/foundations/junction"

describe(`Junction with external storage`, () => {
	it(`accepts external storage methods`, () => {
		type PlayerJoinedRoom = { joinedAt: number }
		const relationMap = new Map<string, Set<string>>()
		const contentMap = new Map<string, PlayerJoinedRoom>()
		const playersInRooms = new Junction(
			{
				between: [`room`, `player`],
				cardinality: `1:n`,
				relations: [[`Lounge`, [`Gertrude`]]],
				contents: [[`Lounge:Gertrude`, { joinedAt: Number.NaN }]],
			},
			{
				isAType: (input): input is string => typeof input === `string`,
				isBType: (input): input is string => typeof input === `string`,
				isContent: (input): input is { joinedAt: number } =>
					type({ joinedAt: `number` })(input) instanceof type.errors === false,
				externalStore: {
					getContent: (key: string) => contentMap.get(key),
					setContent: (key: string, content: { joinedAt: number }) =>
						contentMap.set(key, content),
					deleteContent: (key: string) => contentMap.delete(key),
					getRelatedKeys: (key: string) => relationMap.get(key),
					addRelation: (keyA: string, keyB: string) => {
						const setA = relationMap.get(keyA) ?? new Set()
						setA.add(keyB)
						relationMap.set(keyA, setA)
						const setB = relationMap.get(keyB) ?? new Set()
						setB.add(keyA)
						relationMap.set(keyB, setB)
					},
					deleteRelation(a: string, b: string): void {
						const aRelations = relationMap.get(a)
						if (aRelations) {
							aRelations.delete(b)
							if (aRelations.size === 0) {
								relationMap.delete(a)
							}
							const bRelations = relationMap.get(b)
							if (bRelations) {
								bRelations.delete(a)
								if (bRelations.size === 0) {
									relationMap.delete(b)
								}
							}
						}
					},
					replaceRelationsSafely: (a, bs) => {
						const aRelationsPrev = relationMap.get(a)
						if (aRelationsPrev) {
							for (const b of aRelationsPrev) {
								const bRelations = relationMap.get(b)
								if (bRelations) {
									if (bRelations.size === 1) {
										relationMap.delete(b)
									} else {
										bRelations.delete(a)
									}
									contentMap.delete(playersInRooms.makeContentKey(a, b))
								}
							}
						}
						relationMap.set(a, new Set(bs))
						for (const b of bs) {
							let bRelations = relationMap.get(b)
							if (bRelations) {
								bRelations.add(a)
							} else {
								bRelations = new Set([a])
								relationMap.set(b, bRelations)
							}
						}
					},
					replaceRelationsUnsafely: (a, bs) => {
						relationMap.set(a, new Set(bs))
						for (const b of bs) {
							const bRelations = new Set([a])
							relationMap.set(b, bRelations)
						}
					},
					has: (a: string, b?: string) => {
						if (b) {
							const aRelations = relationMap.get(a)
							return aRelations?.has(b) ?? false
						}
						return relationMap.has(a)
					},
				},
			},
		)
		const room = `Shrine`
		const player = `Adelaide`
		const joinedAt = 162
		playersInRooms.set({ player, room }, { joinedAt })
		expect(playersInRooms.has(room)).toBe(true)
		expect(playersInRooms.getRelatedKeys(player)).toEqual(new Set([room]))
		expect(playersInRooms.getContent(room, player)).toEqual({ joinedAt })
		playersInRooms.delete({ player, room })
		expect(playersInRooms.getRelatedKeys(player)).toBeUndefined()
		expect(playersInRooms.getContent(player, room)).toBeUndefined()
	})
})
