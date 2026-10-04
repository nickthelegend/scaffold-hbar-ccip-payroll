import { chainName, isHedera } from "~~/utils/payroll/chains";

export const Skeleton = ({ className = "h-4 w-24", label }: { className?: string; label?: string }) => (
  <span
    className={`inline-block rounded bg-base-300 animate-pulse align-middle ${className}`}
    role={label ? "status" : undefined}
    aria-label={label}
  />
);

export const ErrorAlert = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="alert alert-error alert-soft text-sm flex flex-wrap">
    <span className="grow">{message}</span>
    {onRetry && (
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export const ChainBadge = ({ selector }: { selector: bigint }) => (
  <span
    className={`badge badge-sm whitespace-nowrap ${isHedera(selector) ? "badge-primary" : "badge-info"} badge-soft`}
  >
    {chainName(selector)}
  </span>
);

export const Card = ({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={`rounded-box border border-base-300 bg-base-100 p-5 space-y-4 min-w-0 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold m-0">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** A label/value row inside a card. */
export const Stat = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="min-w-0">
    <dt className="text-xs uppercase tracking-wider text-base-content/60">{label}</dt>
    <dd className="m-0 font-semibold tabular-nums break-words">{children}</dd>
    {hint && <p className="text-xs text-base-content/60 m-0">{hint}</p>}
  </div>
);
