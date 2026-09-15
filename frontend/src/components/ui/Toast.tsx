import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'animate-fade-in flex items-start gap-2.5 rounded-lg border px-4 py-3 shadow-panel backdrop-blur-sm',
              t.kind === 'success' && 'bg-green-50/95 border-green-200 text-green-800 dark:bg-green-900/90 dark:border-green-700 dark:text-green-100',
              t.kind === 'error' && 'bg-danger-50/95 border-red-200 text-danger-600 dark:bg-danger-900/90 dark:border-danger-700 dark:text-danger-100',
              t.kind === 'info' && 'bg-blue-50/95 border-blue-200 text-blue-800 dark:bg-blue-900/90 dark:border-blue-700 dark:text-blue-100'
            )}
          >
            {t.kind === 'success' && <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            {t.kind === 'error' && <XCircle size={18} className="mt-0.5 shrink-0" />}
            {t.kind === 'info' && <Info size={18} className="mt-0.5 shrink-0" />}
            <p className="text-sm leading-snug flex-1">{t.message}</p>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="opacity-60 hover:opacity-100 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
