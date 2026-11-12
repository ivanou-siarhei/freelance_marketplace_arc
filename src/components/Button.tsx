import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import s from '@/styles/ui.module.scss'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

function classes(variant: Variant, extra: { block?: boolean; small?: boolean }): string {
  return [s.btn, s[variant], extra.block ? s.block : '', extra.small ? s.small : ''].filter(Boolean).join(' ')
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  block?: boolean
  small?: boolean
  loading?: boolean
  children: ReactNode
}

export function Button({ variant = 'primary', block, small, loading, children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" className={classes(variant, { block, small })} disabled={disabled || loading} {...rest}>
      {loading ? <span className={s.spinner} aria-hidden /> : null}
      {children}
    </button>
  )
}

interface ButtonLinkProps extends LinkProps {
  variant?: Variant
  block?: boolean
  small?: boolean
}

export function ButtonLink({ variant = 'primary', block, small, ...rest }: ButtonLinkProps) {
  return <Link className={classes(variant, { block, small })} {...rest} />
}
