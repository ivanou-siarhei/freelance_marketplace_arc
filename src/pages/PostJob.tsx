import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Job } from '@/lib/api'
import { CATEGORIES } from '@/lib/categories'
import { formatDuration, tryParseUsdc } from '@/lib/format'
import { useAppConfig } from '@/hooks/useAppConfig'
import { Button } from '@/components/Button'
import { ConnectGate } from '@/components/ConnectGate'
import ui from '@/styles/ui.module.scss'

const REVIEW_PRESETS = [120, 600, 3600, 86400, 3 * 86400, 7 * 86400, 14 * 86400]

export function PostJob() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { params } = useAppConfig()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [deadline, setDeadline] = useState('')
  const [reviewSeconds, setReviewSeconds] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Review periods offered come from the deployed contract's own bounds.
  const reviewOptions = useMemo(() => {
    const min = params?.minReviewPeriod ?? 60
    const max = params?.maxReviewPeriod ?? 30 * 86400
    const options = REVIEW_PRESETS.filter((value) => value >= min && value <= max)
    return options.length > 0 ? options : [min]
  }, [params])
  const review = reviewSeconds && reviewOptions.includes(reviewSeconds) ? reviewSeconds : (reviewOptions.find((v) => v >= 86400) ?? reviewOptions[reviewOptions.length - 1] ?? 3600)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const min = tryParseUsdc(budgetMin)
    const max = tryParseUsdc(budgetMax)
    if (!min || !max) return setError('Enter a budget range greater than zero, like 50 and 150.')
    if (min > max) return setError('The minimum budget cannot be higher than the maximum.')
    setSubmitting(true)
    try {
      const job = await api<Job>('/jobs', {
        method: 'POST',
        body: {
          title,
          category,
          description,
          budgetMin: min.toString(),
          budgetMax: max.toString(),
          reviewPeriodSeconds: review,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job posted. Freelancers can bid now.')
      void navigate(`/jobs/${job.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not post the job.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={ui.page} style={{ maxWidth: 760 }}>
      <div className={ui.pageHead}>
        <h1>Post a job</h1>
        <p>Describe the work and your budget. You choose a freelancer, then fund the escrow. Nothing is charged until you do.</p>
      </div>
      <ConnectGate reason="Connect a wallet to post a job. Your wallet address identifies you as the client.">
        <form className={`${ui.card} ${ui.stack}`} onSubmit={(event) => void onSubmit(event)}>
          <label className={ui.field}>
            <span>Title</span>
            <input className={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design a landing page for my app" required minLength={3} maxLength={120} />
          </label>
          <div className={ui.formGrid}>
            <label className={ui.field}>
              <span>Category</span>
              <select className={ui.select} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className={ui.field}>
              <span>Bidding closes (optional)</span>
              <input className={ui.input} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          </div>
          <label className={ui.field}>
            <span>Description</span>
            <textarea className={ui.textarea} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be delivered, and what does a great result look like?" required minLength={10} maxLength={5000} />
          </label>
          <div className={ui.formGrid}>
            <label className={ui.field}>
              <span>Budget from</span>
              <div className={ui.amountInput}>
                <input className={ui.input} inputMode="decimal" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="50" required />
                <em>USDC</em>
              </div>
            </label>
            <label className={ui.field}>
              <span>Budget to</span>
              <div className={ui.amountInput}>
                <input className={ui.input} inputMode="decimal" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="150" required />
                <em>USDC</em>
              </div>
            </label>
          </div>
          <label className={ui.field}>
            <span>Review window after delivery</span>
            <select className={ui.select} value={review} onChange={(e) => setReviewSeconds(Number(e.target.value))}>
              {reviewOptions.map((value) => (
                <option key={value} value={value}>
                  {formatDuration(value)}
                </option>
              ))}
            </select>
            <small>
              After the freelancer delivers, you have this long to approve. If you do nothing, the payment is released to the freelancer automatically. Freelancers see this before they bid.
            </small>
          </label>
          {error ? <div className={`${ui.notice} ${ui.noticeError}`}>{error}</div> : null}
          <Button type="submit" loading={submitting} block>
            Post job
          </Button>
        </form>
      </ConnectGate>
    </div>
  )
}
