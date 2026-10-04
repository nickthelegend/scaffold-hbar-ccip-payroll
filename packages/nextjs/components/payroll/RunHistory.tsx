import Link from "next/link";
import { PayoutStatus } from "./PayoutStatus";
import type { PayeeEntry } from "./types";
import { ChainBadge } from "./ui";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { isHedera } from "~~/utils/payroll/chains";
import { type Payout, type Run, hashscanTxUrl } from "~~/utils/payroll/history";
import { formatHbar, formatTime, formatTokens, shortHex } from "~~/utils/payroll/units";

export const RunHistory = ({ runs, payees }: { runs: Run[]; payees: PayeeEntry[] }) => {
  if (runs.length === 0) {
    return (
      <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60 m-0">
        No runs yet. The first one executes when the schedule above comes due.
      </p>
    );
  }
  return (
    <ol className="space-y-4 m-0 p-0 list-none">
      {runs.map(run => (
        <RunItem key={run.runId.toString()} run={run} payees={payees} />
      ))}
    </ol>
  );
};

/** The run's executor: the Schedule Service calls the contract with the contract itself as msg.sender. */
export const ExecutorBadge = ({ run }: { run: Run }) =>
  run.byScheduleService ? (
    <span className="badge badge-sm badge-primary badge-soft" title="Scheduled by the contract itself (HIP-1215)">
      Executed by Hedera Schedule Service
    </span>
  ) : (
    <span className="badge badge-sm badge-ghost">Triggered manually</span>
  );

const RunItem = ({ run, payees }: { run: Run; payees: PayeeEntry[] }) => {
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url ?? "";
  const seconds = Number(run.timestamp.split(".")[0]);

  return (
    <li className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-bold m-0">Run #{run.runId.toString()}</h3>
        <ExecutorBadge run={run} />
        <span className="text-sm text-base-content/70">
          {run.paid.toString()} paid · {run.skipped.toString()} skipped
        </span>
        <span className="text-sm text-base-content/60">{formatTime(seconds)}</span>
        <a
          className="link text-sm sm:ml-auto"
          href={hashscanTxUrl(explorer, run.timestamp)}
          target="_blank"
          rel="noreferrer"
        >
          HashScan tx
        </a>
      </div>
      <ul className="divide-y divide-base-300 m-0 p-0 list-none">
        {run.payouts.map(payout => (
          <PayoutLine key={payout.payeeId.toString()} run={run} payout={payout} payees={payees} />
        ))}
      </ul>
    </li>
  );
};

const PayoutLine = ({ run, payout, payees }: { run: Run; payout: Payout; payees: PayeeEntry[] }) => {
  const payee = payees.find(p => p.id === payout.payeeId);
  const name = payee?.label || `Payee #${payout.payeeId}`;
  const account = payout.kind === "sent" ? payout.account : payee?.account;

  return (
    <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {account ? (
        <Link href={`/payee/${account}`} className="font-semibold link link-hover" title={account}>
          {name}
        </Link>
      ) : (
        <span className="font-semibold">{name}</span>
      )}
      {account && <span className="font-mono text-xs text-base-content/60">{shortHex(account)}</span>}
      {payout.kind === "sent" && (
        <>
          <span className="tabular-nums">{formatTokens(payout.amount)}</span>
          <ChainBadge selector={payout.chainSelector} />
          {!isHedera(payout.chainSelector) && (
            <span className="text-xs text-base-content/60 tabular-nums">fee {formatHbar(payout.fee)}</span>
          )}
        </>
      )}
      <PayoutStatus record={{ run, payout }} />
    </li>
  );
};
