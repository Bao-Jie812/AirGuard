import { useId } from 'react'

export function LogoMark({ size = 36 }: { size?: number }) {
  const gradientId = `brand-${useId().replace(/:/g, '')}`
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
      fill="none"
    >
      <rect width="36" height="36" rx="11" fill={`url(#${gradientId})`} />
      <path
        d="M9 16.5c3.1 0 3.1-3 6.2-3s3.1 3 6.2 3 3.1-3 6.2-3"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9 22c3.1 0 3.1-3 6.2-3s3.1 3 6.2 3 3.1-3 6.2-3"
        stroke="white"
        strokeOpacity="0.7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="18" cy="10.5" r="2" fill="white" />
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="36"
          y2="36"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#3f738f" />
          <stop offset="1" stopColor="#2f7d7a" />
        </linearGradient>
      </defs>
    </svg>
  )
}
