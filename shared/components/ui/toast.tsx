"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastType = "success" | "error" | "warning" | "info";
type Toast = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

const ToastCtx = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
} | null>(null);

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-[rgb(var(--success))]" />,
  error: <XCircle className="h-5 w-5 text-[rgb(var(--danger))]" />,
  warning: <AlertTriangle className="h-5 w-5 text-[rgb(var(--warning))]" />,
  info: <Info className="h-5 w-5 text-[rgb(var(--primary))]" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((s) => [...s, { ...t, id }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="card flex min-w-72 items-start gap-3 p-4 shadow-lg"
            >
              {icons[t.type]}
              <div className="flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.description && (
                  <div className="mt-0.5 text-xs text-[rgb(var(--muted-fg))]">
                    {t.description}
                  </div>
                )}
                {t.action && (
                  <button
                    onClick={() => {
                      t.action?.onClick();
                      setToasts((s) => s.filter((x) => x.id !== t.id));
                    }}
                    className="mt-2 text-xs font-semibold text-[rgb(var(--primary))] hover:underline block"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))}
                className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}
