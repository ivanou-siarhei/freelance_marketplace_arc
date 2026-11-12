import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api, type Job } from '@/lib/api'
import { CATEGORIES } from '@/lib/categories'
import { tryParseUsdc } from '@/lib/format'
import { JobCard, JobGrid } from '@/components/JobCard'
import { ButtonLink } from '@/components/Button'
import ui from '@/styles/ui.module.scss'
import s from './Jobs.module.scss'

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function Jobs() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [minBudget, setMinBudget] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const debouncedSearch = useDebounced(search)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (category) params.set('category', category)
    const min = tryParseUsdc(minBudget)
    const max = tryParseUsdc(maxBudget)
    if (min) params.set('minBudget', min.toString())
    if (max) params.set('maxBudget', max.toString())
    return params.toString()
  }, [debouncedSearch, category, minBudget, maxBudget])

  const jobs = useQuery({
    queryKey: ['jobs', 'browse', query],
    queryFn: () => api<{ jobs: Job[] }>(`/jobs?${query}`),
  })

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <h1>Find work. Get paid in USDC.</h1>
        <p>Every job is backed by USDC held in escrow, so freelancers know the money is there before they start.</p>
      </div>

      <div className={s.filters}>
        <label className={ui.field}>
          <span>Search</span>
          <div style={{ position: 'relative' }}>
            <input
              className={ui.input}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Landing page, smart contract, logo..."
              style={{ paddingLeft: 38 }}
            />
            <Search size={16} aria-hidden style={{ position: 'absolute', left: 13, top: 15, color: 'var(--subtle)' }} />
          </div>
        </label>
        <label className={ui.field}>
          <span>Category</span>
          <select className={ui.select} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span>Min budget</span>
          <div className={ui.amountInput}>
            <input className={ui.input} inputMode="decimal" value={minBudget} onChange={(e) => setMinBudget(e.target.value)} placeholder="0" />
            <em>USDC</em>
          </div>
        </label>
        <label className={ui.field}>
          <span>Max budget</span>
          <div className={ui.amountInput}>
            <input className={ui.input} inputMode="decimal" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} placeholder="Any" />
            <em>USDC</em>
          </div>
        </label>
      </div>

      {jobs.isLoading ? (
        <JobGrid>
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className={ui.skeleton} />
          ))}
        </JobGrid>
      ) : jobs.isError ? (
        <div className={`${ui.notice} ${ui.noticeError}`}>Could not load jobs. {jobs.error.message}</div>
      ) : jobs.data && jobs.data.jobs.length > 0 ? (
        <JobGrid>
          {jobs.data.jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </JobGrid>
      ) : (
        <div className={`${ui.card} ${ui.empty}`}>
          <h3>No open jobs match</h3>
          <p>Try clearing the filters, or post the first job yourself.</p>
          <ButtonLink to="/post">Post a job</ButtonLink>
        </div>
      )}
    </div>
  )
}
