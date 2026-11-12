import { ButtonLink } from '@/components/Button'
import ui from '@/styles/ui.module.scss'

export function NotFound() {
  return (
    <div className={ui.page}>
      <div className={`${ui.card} ${ui.empty}`}>
        <h3>That page does not exist</h3>
        <p>The link may be old or mistyped.</p>
        <ButtonLink to="/">Browse jobs</ButtonLink>
      </div>
    </div>
  )
}
