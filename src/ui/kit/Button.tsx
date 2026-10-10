import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

const STYLES: Record<Variant, string> = {
  default: 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100',
  primary: 'border-[var(--accent)] text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  danger: 'border-red-700 text-red-300 hover:bg-red-950/50',
  ghost: 'border-transparent text-neutral-400 hover:text-neutral-100',
};

/** The app's standard button: one size, one border style, consistent disabled state. */
export function Button({ variant = 'default', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`px-3 py-1 text-xs tracking-wider border transition-colors disabled:opacity-40 disabled:pointer-events-none ${STYLES[variant]} ${className}`}
    />
  );
}
