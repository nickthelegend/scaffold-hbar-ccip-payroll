"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { type Address, getAddress, isAddress } from "viem";
import { PayoutStatus } from "~~/components/payroll/PayoutStatus";
import { ExecutorBadge } from "~~/components/payroll/RunHistory";
import { ChainBadge, ErrorAlert, Skeleton } from "~~/components/payroll/ui";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { usePayees, usePayroll, usePayrollHistory } from "~~/hooks/payroll";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { isHedera } from "~~/utils/payroll/chains";
import { hashscanTxUrl, payoutsTo } from "~~/utils/payroll/history";
import { formatHbar, formatTime, formatTokens } from "~~/utils/payroll/units";

export default function PayeePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { targetNetwork } = useTargetNetwork();
  const { address: payroll } = usePayroll();

  if (!isAddress(address)) {
    return (
      <Message>
        <p className="text-lg m-0 break-all">“{decodeURIComponent(address)}” is not an EVM address.</p>
      </Message>
    );
  }
  if (!payroll) {
    return (
      <Message>
        <p className="text-lg m-0">CrossChainPayroll isn&apos;t deployed on {targetNetwork.name}.</p>
      </Message>
    );
  }
  return <PayeeHistory account={getAddress(address)} />;
}

const Message = ({ children }: { children: React.ReactNode }) => (
  <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
    {children}
    <Link href="/" className="btn btn-primary btn-sm">
      Back to the dashboard
    </Link>
  </div>
);

const PayeeHistory = ({ account }: { account: Address }) => {
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url ?? "";
  const { payees, isError: payeesError, refetch: refetchPayees } = usePayees();
  const history = usePayrollHistory();

  const entries = useMemo(
    () => payees?.filter(p => p.account.toLowerCase() === account.toLowerCase()),
    [payees, account],
  );
  const records = useMemo(
    () =>
      history.data && (entries || payeesError)
        ? payoutsTo(history.data.runs, account, new Set(entries?.map(e => e.id)))
        : undefined,
    [history.data, entries, payeesError, account],
  );
  const totalPaid = records?.reduce((sum, { payout }) => sum + (payout.kind === "sent" ? payout.amount : 0n), 0n);

  return (
    <div className="max-w-5xl mx-auto w-full px-4 sm:px-5 py-8 space-y-8 lg:pb-24">
      <section className="rounded-box border border-base-300 bg-base-100 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <p className="text-xs uppercase tracking-wider text-base-content/60 m-0">Payee</p>
            <h1 className="text-2xl font-bold m-0 break-words">
              {entries === undefined ? (
                <Skeleton className="h-7 w-40" />
              ) : (
                entries
                  .map(e => e.label)
                  .filter(Boolean)
                  .join(" / ") || "Unlabelled payee"
              )}
            </h1>
            <div className="flex">
              <HederaAddress address={account} chain={targetNetwork} />
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs uppercase tracking-wider text-base-content/60 m-0">Sent so far</p>
            <p className="text-2xl font-bold tabular-nums m-0">
              {totalPaid === undefined ? <Skeleton className="h-7 w-32" /> : formatTokens(totalPaid)}
            </p>
          </div>
        </div>
        {payeesError && !payees ? (
          <ErrorAlert message="Couldn't load the payees from the RPC." onRetry={() => refetchPayees()} />
        ) : entries && entries.length > 0 ? (
          <ul className="flex flex-wrap gap-2 m-0 p-0 list-none">
            {entries.map(entry => (
              <li
                key={entry.id.toString()}
                className="flex items-center gap-2 rounded-box bg-base-200 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-base-content/60">#{entry.id.toString()}</span>
                <span className="tabular-nums">{formatTokens(entry.amount)} per run</span>
                <ChainBadge selector={entry.chainSelector} />
                <span className={`badge badge-sm ${entry.active ? "badge-success" : "badge-ghost"}`}>
                  {entry.active ? "Active" : "Paused"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          entries && <p className="text-sm text-base-content/70 m-0">This address is not on the payroll.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold m-0">Payouts</h2>
        {records ? (
          records.length === 0 ? (
            <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60 m-0">
              No payouts to this address yet.
            </p>
          ) : (
            <ul className="space-y-3 m-0 p-0 list-none">
              {records.map(record => {
                const { run, payout } = record;
                return (
                  <li
                    key={`${run.runId}-${payout.payeeId}`}
                    className="rounded-box border border-base-300 bg-base-100 p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="font-bold">Run #{run.runId.toString()}</span>
                      <ExecutorBadge run={run} />
                      <span className="text-sm text-base-content/60">
                        {formatTime(Number(run.timestamp.split(".")[0]))}
                      </span>
                      <a
                        className="link text-sm sm:ml-auto"
                        href={hashscanTxUrl(explorer, run.timestamp)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        HashScan tx
                      </a>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {payout.kind === "sent" && (
                        <>
                          <span className="font-semibold tabular-nums">{formatTokens(payout.amount)}</span>
                          <ChainBadge selector={payout.chainSelector} />
                          {!isHedera(payout.chainSelector) && (
                            <span className="text-xs text-base-content/60 tabular-nums">
                              fee {formatHbar(payout.fee)}
                            </span>
                          )}
                        </>
                      )}
                      <PayoutStatus record={record} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : history.isError ? (
          <ErrorAlert message="Couldn't load payouts from the mirror node." onRetry={() => history.refetch()} />
        ) : (
          <Skeleton className="h-32 w-full" label="Loading payouts" />
        )}
      </section>
    </div>
  );
};
