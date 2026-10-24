import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

type ToastTone = 'success' | 'warning' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckCircle2 size={17} />
  if (tone === 'warning') return <AlertCircle size={17} />
  return <Info size={17} />
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      for (const timer of activeTimers) window.clearTimeout(timer)
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      counter.current += 1
      const id = counter.current
      setToasts((previous) => [...previous, { id, tone, message }])
      const timer = window.setTimeout(() => dismiss(id), 4200)
      timers.current.push(timer)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div
            className={`toast toast--${item.tone}`}
            key={item.id}
            role="status"
          >
            <span className="toast__icon">
              <ToastIcon tone={item.tone} />
            </span>
            <span>{item.message}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(item.id)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
