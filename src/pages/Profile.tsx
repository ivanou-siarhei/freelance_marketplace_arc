import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Profile } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import { Button } from '@/components/Button'
import { ConnectGate } from '@/components/ConnectGate'
import ui from '@/styles/ui.module.scss'

function ProfileForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio)
  const [skills, setSkills] = useState(profile.skills.join(', '))
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/profiles/me', {
        method: 'PUT',
        body: {
          displayName,
          bio,
          skills: skills
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      toast.success('Profile saved.')
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`${ui.card} ${ui.stack}`} onSubmit={(event) => void save(event)}>
      <label className={ui.field}>
        <span>Display name</span>
        <input className={ui.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Ada Lovelace" />
      </label>
      <label className={ui.field}>
        <span>About you</span>
        <textarea className={ui.textarea} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1000} placeholder="What you do and the work you are proud of." />
      </label>
      <label className={ui.field}>
        <span>Skills</span>
        <input className={ui.input} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Solidity, React, Brand design" />
        <small>Separate skills with commas. Up to 15.</small>
      </label>
      <div className={ui.row}>
        <Button type="submit" loading={saving}>
          Save profile
        </Button>
      </div>
    </form>
  )
}

function ProfileView({ profile }: { profile: Profile }) {
  return (
    <section className={`${ui.card} ${ui.stack}`}>
      <div className={ui.stack} style={{ gap: 4 }}>
        <h2>{profile.displayName || 'Unnamed freelancer'}</h2>
        <span className={`${ui.mono} ${ui.muted}`}>{shortAddress(profile.address)}</span>
      </div>
      {profile.bio ? <p>{profile.bio}</p> : <p className={ui.muted}>This person has not written a bio yet.</p>}
      {profile.skills.length > 0 ? (
        <div className={ui.row}>
          {profile.skills.map((skill) => (
            <span key={skill} className={ui.chip}>
              {skill}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ProfileLoader({ address, editable }: { address: string; editable: boolean }) {
  const query = useQuery({ queryKey: ['profile', address], queryFn: () => api<Profile>(`/profiles/${address}`) })
  if (query.isLoading) return <div className={ui.skeleton} />
  if (query.isError || !query.data) return <div className={`${ui.notice} ${ui.noticeError}`}>Could not load this profile.</div>
  return editable ? <ProfileForm profile={query.data} /> : <ProfileView profile={query.data} />
}

export function ProfilePage() {
  const { address: routeAddress } = useParams()
  const { address: me } = useSession()
  const viewingOther = Boolean(routeAddress) && routeAddress?.toLowerCase() !== me

  return (
    <div className={ui.page} style={{ maxWidth: 760 }}>
      <div className={ui.pageHead}>
        <h1>{viewingOther ? 'Profile' : 'Your profile'}</h1>
        <p>{viewingOther ? 'Freelancers and clients are identified by their wallet.' : 'This is what clients see when you bid and what freelancers see when you hire.'}</p>
      </div>
      {viewingOther && routeAddress ? (
        <ProfileLoader address={routeAddress.toLowerCase()} editable={false} />
      ) : (
        <ConnectGate reason="Connect your wallet to edit your profile.">{me ? <ProfileLoader address={me} editable /> : null}</ConnectGate>
      )}
    </div>
  )
}
