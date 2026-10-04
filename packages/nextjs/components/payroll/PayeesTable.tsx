import Link from "next/link";
import { PayoutStatus } from "./PayoutStatus";
import type { PayeeEntry } from "./types";
import { ChainBadge, Skeleton } from "./ui";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { type Run, latestPayouts } from "~~/utils/payroll/history";
import { formatTokens } from "~~/utils/payroll/units";

export const PayeesTable = ({
  payees,
  runs,
  historyFailed,
}: {
  payees: PayeeEntry[];
  /** Undefined while the history loads or when it failed to load. */
  runs?: Run[];
  historyFailed: boolean;
}) => {
  const { targetNetwork } = useTargetNetwork();
  if (payees.length === 0) {
    return (
      <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60 m-0">
        No payees yet. The owner adds them below.
      </p>
    );
  }
  const latest = runs ? latestPayouts(runs) : undefined;

  return (
    <ul className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100 m-0 p-0 list-none">
      {payees.map(payee => {
        const last = latest?.get(payee.id);
        return (
          <li key={payee.id.toString()} className="p-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1.6fr] md:items-center">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/payee/${payee.account}`} className="font-semibold link link-hover">
                  {payee.label || `Payee #${payee.id}`}
                </Link>
                {!payee.active && <span className="badge badge-sm badge-ghost">Paused</span>}
              </div>
              <div className="flex">
                <HederaAddress address={payee.account} chain={targetNetwork} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">{formatTokens(payee.amount)}</span>
              <span className="text-sm text-base-content/60">to</span>
              <ChainBadge selector={payee.chainSelector} />
            </div>
            <div className="min-w-0 text-sm">
              <span className="text-xs uppercase tracking-wider text-base-content/60 mr-2">Last payout</span>
              {latest === undefined ? (
                historyFailed ? (
                  <span className="text-base-content/60">Unavailable</span>
                ) : (
                  <Skeleton className="h-4 w-32" />
                )
              ) : last ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="text-xs text-base-content/60">run #{last.run.runId.toString()}</span>
                  <PayoutStatus record={last} />
                </span>
              ) : (
                <span className="text-base-content/60">None yet</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
