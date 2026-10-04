"use client";

import { Card, ErrorAlert, Skeleton, Stat } from "./ui";
import { zeroAddress } from "viem";
import { useBlock } from "wagmi";
import { useNowSeconds, useRefreshHistoryAfterTx } from "~~/hooks/payroll";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import type { ScheduleFailure } from "~~/utils/payroll/history";
import { entityIdFromAddress, formatCountdown, formatInterval, formatTime } from "~~/utils/payroll/units";

/** After this long past its second, a pending schedule that has not run is probably not going to. */
const OVERDUE_GRACE_SECONDS = 60;

export const ScheduleCard = ({ scheduleFailure }: { scheduleFailure?: ScheduleFailure }) => {
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url;
  const now = useNowSeconds();
  const paused = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "paused" });
  const nextRunAt = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "nextRunAt" });
  const schedule = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "schedule" });
  const scheduledAt = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "scheduledAt" });
  const interval = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "interval" });
  const runCount = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "runCount" });
  const { data: block } = useBlock({ chainId: targetNetwork.id, watch: true });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "CrossChainPayroll" });
  const refreshHistory = useRefreshHistoryAfterTx();

  const reads = [paused, nextRunAt, schedule, scheduledAt, interval, runCount];
  const failed = reads.filter(r => r.isError && r.data === undefined);
  const loaded = reads.every(r => r.data !== undefined);

  if (!loaded) {
    return (
      <Card title="Schedule">
        {failed.length > 0 ? (
          <ErrorAlert
            message={`Couldn't read the schedule from the ${targetNetwork.name} RPC.`}
            onRetry={() => failed.forEach(r => r.refetch())}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
      </Card>
    );
  }

  const isPaused = paused.data!;
  const pending = schedule.data !== zeroAddress ? schedule.data! : undefined;
  const pendingId = pending ? entityIdFromAddress(pending) : undefined;
  const executesAt = Number(scheduledAt.data!);
  const due = Number(nextRunAt.data!);
  // `run()` checks block.timestamp, which trails the wall clock by up to a block.
  const isDue = block !== undefined && Number(block.timestamp) >= due;
  const canRun = !isPaused && isDue;
  const overdue = !isPaused && pending !== undefined && now > executesAt + OVERDUE_GRACE_SECONDS;
  const unscheduled = !isPaused && pending === undefined;

  const runNow = async () => {
    try {
      if (await writeContractAsync({ functionName: "run" })) refreshHistory();
    } catch {
      // Already shown as a notification.
    }
  };

  return (
    <Card
      title="Schedule"
      aside={
        <span className={`badge ${isPaused ? "badge-warning" : "badge-success"}`}>
          {isPaused ? "Paused" : "Running"}
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-4 m-0">
        <Stat label="Next run due" hint={isPaused ? "Paused: no run will execute" : formatTime(due)}>
          {isPaused ? "—" : due <= now ? "Due now" : `in ${formatCountdown(due - now)}`}
        </Stat>
        <Stat label="Every">{formatInterval(Number(interval.data))}</Stat>
        <Stat label="Hedera schedule" hint={pending ? `Executes ${formatTime(executesAt)}` : "No schedule pending"}>
          {pending && pendingId ? (
            <a className="link" href={`${explorer}/schedule/${pendingId}`} target="_blank" rel="noreferrer">
              {pendingId}
            </a>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Executes in">
          {pending ? (executesAt > now ? formatCountdown(executesAt - now) : "Executing…") : "—"}
        </Stat>
        <Stat label="Runs so far">{runCount.data!.toString()}</Stat>
      </dl>

      {!isPaused && (scheduleFailure || unscheduled || overdue) && (
        <div role="alert" className="alert alert-warning alert-soft text-sm">
          <span>
            {scheduleFailure
              ? `The contract could not schedule the next run with the Hedera Schedule Service (response code ${scheduleFailure.responseCode}). `
              : overdue
                ? "The scheduled run has not executed yet. "
                : "No run is scheduled. "}
            <code>run()</code> is permissionless: once the run is due, anyone can trigger it here and it schedules the
            following one.
          </span>
        </div>
      )}

      {canRun && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary btn-sm" disabled={isMining} onClick={runNow}>
            {isMining && <span className="loading loading-spinner loading-xs" />}
            Run payroll now
          </button>
          <span className="text-xs text-base-content/60">This run is due. Anyone can trigger it.</span>
        </div>
      )}
    </Card>
  );
};
