import { sql } from '../db'
import { addr, HttpError, optStr, requireAddress, route } from '../http'
import { mapProfile } from '../serialize'

function skillsFrom(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 15) throw new HttpError(400, 'skills must be a list of up to 15 items')
  const skills = value.map((item) => {
    if (typeof item !== 'string' || item.trim().length < 1 || item.trim().length > 30) {
      throw new HttpError(400, 'Each skill must be 1 to 30 characters')
    }
    return item.trim()
  })
  return Array.from(new Set(skills))
}

export function registerProfileRoutes(): void {
  route('GET', '/profiles/:address', async (ctx) => {
    const address = addr(ctx.params.address ?? '')
    const rows = await sql`SELECT * FROM users WHERE address = ${address}`
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? mapProfile(row) : mapProfile({ address })
  })

  // Only the signed-in wallet can edit its own profile.
  route(
    'PUT',
    '/profiles/me',
    async (ctx) => {
      const address = requireAddress(ctx)
      const body = await ctx.json()
      const displayName = optStr(body.displayName, 'Display name', 60)
      const bio = optStr(body.bio, 'Bio', 1000)
      const skills = skillsFrom(body.skills)
      const rows = await sql`
        INSERT INTO users (address, display_name, bio, skills)
        VALUES (${address}, ${displayName}, ${bio}, ${sql.array(skills, 'TEXT')})
        ON CONFLICT (address) DO UPDATE
        SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, skills = EXCLUDED.skills, updated_at = now()
        RETURNING *`
      return mapProfile(rows[0] as Record<string, unknown>)
    },
    { auth: true },
  )
}
