import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, LockKeyhole } from "lucide-react";
import { api, ApiError, SESSION_EXPIRED } from "@/lib/api";
import { cx } from "@/components/ui";

const LENGTH = 4;

/**
 * Everything behind a four-digit PIN.
 *
 * The session lives in an httpOnly cookie set by the Worker and lasts until the
 * end of the business day, so this is asked for once each morning rather than
 * on every visit.
 */
export function PinGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const session = useQuery({
    queryKey: ["auth", "session"],
    queryFn: api.auth.session,
    // The gate must never serve a stale "you're in" from cache.
    staleTime: 0,
    retry: false,
  });

  // Any request rejected as unauthenticated puts the gate back up, wherever
  // the user happens to be.
  useEffect(() => {
    const onExpired = () => {
      client.setQueryData(["auth", "session"], (prev: unknown) =>
        prev ? { ...(prev as object), authenticated: false } : prev,
      );
      client.invalidateQueries({ queryKey: ["auth", "session"] });
    };
    document.addEventListener(SESSION_EXPIRED, onExpired);
    return () => document.removeEventListener(SESSION_EXPIRED, onExpired);
  }, [client]);

  if (session.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 size={18} className="animate-spin" style={{ color: "var(--ink-3)" }} />
      </div>
    );
  }

  if (!session.data?.authenticated) {
    return (
      <PinScreen
        configured={session.data?.configured ?? true}
        businessName={session.data?.businessName ?? "Towel Wage"}
        onSignedIn={() => {
          // A fresh sign-in means every cached 401 is now wrong.
          client.clear();
          client.invalidateQueries();
        }}
      />
    );
  }

  return <>{children}</>;
}

function PinScreen({
  configured,
  businessName,
  onSignedIn,
}: {
  configured: boolean;
  businessName: string;
  onSignedIn: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: onSignedIn,
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
      setDigits(Array(LENGTH).fill(""));
      setShake(true);
      setTimeout(() => setShake(false), 420);
      inputs.current[0]?.focus();
    },
  });

  // Land in the first box, ready to type.
  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const submit = (pin: string) => {
    setError("");
    login.mutate(pin);
  };

  const setDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (error) setError("");

    if (digit && index < LENGTH - 1) inputs.current[index + 1]?.focus();

    const pin = next.join("");
    if (pin.length === LENGTH && next.every(Boolean)) submit(pin);
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        // Clear this box first; only step back once it is already empty.
        next[index] = "";
        setDigits(next);
      } else if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        inputs.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < LENGTH - 1) inputs.current[index + 1]?.focus();
    if (e.key === "Enter" && digits.every(Boolean)) submit(digits.join(""));
  };

  /** Pasting the whole PIN should fill every box, not just the one in focus. */
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(LENGTH)
      .fill("")
      .map((_, i) => pasted[i] ?? "");
    setDigits(next);
    inputs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
    if (pasted.length === LENGTH) submit(pasted);
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <div
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <LockKeyhole size={20} />
        </div>

        <h1 className="mt-4 text-base font-semibold">{businessName}</h1>
        <p className="mt-1 text-xs ink-3">
          {configured ? "Enter your PIN to continue" : "Server needs setting up"}
        </p>

        {configured ? (
          <>
            <div
              className={cx(
                "mt-6 flex justify-center gap-2.5",
                shake && "animate-[pin-shake_0.4s_ease-in-out]",
              )}
              onPaste={onPaste}
            >
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={`PIN digit ${index + 1} of ${LENGTH}`}
                  maxLength={1}
                  disabled={login.isPending}
                  value={digit}
                  onChange={(e) => setDigit(index, e.target.value)}
                  onKeyDown={(e) => onKeyDown(index, e)}
                  onFocus={(e) => e.currentTarget.select()}
                  className={cx(
                    "h-14 w-12 rounded-lg border text-center text-2xl font-semibold outline-none",
                    "transition-colors focus:border-[color:var(--accent)]",
                    "disabled:opacity-50",
                    // The first box pulses on load, so it is obvious where to
                    // start without a caret being the only cue.
                    index === 0 && !digit && "animate-[pin-flash_1.6s_ease-in-out_3]",
                  )}
                  style={{
                    background: "var(--panel)",
                    borderColor: error ? "var(--neg)" : "var(--line-strong)",
                    color: "var(--ink)",
                  }}
                />
              ))}
            </div>

            <div className="mt-3 flex h-8 items-center justify-center">
              {login.isPending && (
                <span className="flex items-center gap-1.5 text-xs ink-3">
                  <Loader2 size={13} className="animate-spin" /> Checking…
                </span>
              )}
              {!login.isPending && error && (
                <span
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: "var(--neg)" }}
                  role="alert"
                >
                  <AlertCircle size={13} /> {error}
                </span>
              )}
            </div>
          </>
        ) : (
          <div
            className="mt-5 rounded-md border px-3 py-3 text-left text-xs leading-relaxed"
            style={{ background: "var(--warn-soft)", borderColor: "var(--line)" }}
          >
            <p className="font-medium" style={{ color: "var(--warn)" }}>
              No PIN is configured
            </p>
            <p className="mt-1.5 ink-2">
              Add an <code className="font-mono">APP_PIN</code> secret (four digits) to the
              Worker, then reload this page. Until then nothing can be signed in to — the app
              fails closed rather than leaving the data open.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
