import { useI, useLoadable, useO } from "atom.io/react"

import { profileAtoms } from "./loadable-atoms"
import { renameProfile, saveProfileErrorAtom } from "./transaction"

const selectedProfileKey = `profile::current-user`

export function ProfilePanel() {
	const loadedProfile = useLoadable(profileAtoms, selectedProfileKey, {
		id: `current-user`,
		name: `Loading...`,
		plan: `free`,
	})
	const profile = loadedProfile.value
	const setProfile = useI(profileAtoms, selectedProfileKey)
	const saveError = useO(saveProfileErrorAtom)

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				const form = new FormData(event.currentTarget)
				renameProfile(profile.id, String(form.get(`name`) ?? profile.name))
			}}
		>
			<label>
				Name
				<input
					name="name"
					value={profile.name}
					onChange={(event) => {
						setProfile({ ...profile, name: event.currentTarget.value })
					}}
				/>
			</label>
			<button type="submit">Save</button>
			{saveError ? <p>{saveError.message}</p> : null}
		</form>
	)
}
