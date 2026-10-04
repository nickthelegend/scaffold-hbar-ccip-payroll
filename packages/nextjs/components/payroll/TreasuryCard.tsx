"use client";

import { useState } from "react";
import { Card, ErrorAlert, Skeleton, Stat } from "./ui";
import type { Address } from "viem";
import { useAccount, useBalance, useGasPrice } from "wagmi";
import {
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
  useTransactor,
} from "~~/hooks/scaffold-hbar";
import {
  formatHbar,
  formatTokens,
  parseHbar,
  runway,
  scheduledRunFee,
  tinybarsToWeibars,
  weibarsToTinybars,
} from "~~/utils/payroll/units";

const BALANCE_POLL_MS = 10_000;

export const TreasuryCard = ({ payroll }: { payroll: Address }) => {
  const { targetNetwork } = useTargetNetwork();
  const tokenBalance = useScaffoldReadContract({
    contractName: "CCIPBnM",
    functionName: "balanceOf",
    args: [payroll],
  });
  const hbarBalance = useBalance({
    address: payroll,
    chainId: targetNetwork.id,
    query: { refetchInterval: BALANCE_POLL_MS },
  });
  const quote = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "quoteRun" });
  const gasPrice = useGasPrice({ chainId: targetNetwork.id });

  const failed = [tokenBalance, hbarBalance, quote, gasPrice].filter(read => read.isError && read.data === undefined);
  const hbarTinybars = hbarBalance.data ? weibarsToTinybars(hbarBalance.data.value) : undefined;
  const [tokensPerRun, ccipFees, gasLimit] = quote.data ?? [];
  const hssFee =
    gasLimit !== undefined && gasPrice.data !== undefined ? scheduledRunFee(gasLimit, gasPrice.data) : undefined;
  const hbarPerRun = ccipFees !== undefined && hssFee !== undefined ? ccipFees + hssFee : undefined;
  const ready =
    tokenBalance.data !== undefined &&
    hbarTinybars !== undefined &&
    tokensPerRun !== undefined &&
    hbarPerRun !== undefined;
  const cover = ready
    ? runway({ tokenBalance: tokenBalance.data!, hbarBalance: hbarTinybars, tokensPerRun, hbarPerRun })
    : undefined;

  return (
    <Card title="Treasury">
      {failed.length > 0 && (
        <ErrorAlert
          message={`Couldn't read the treasury from the ${targetNetwork.name} RPC.`}
          onRetry={() => failed.forEach(read => read.refetch())}
        />
      )}
      <dl className="grid grid-cols-2 gap-4 m-0">
        <Stat label="CCIP-BnM">
          {tokenBalance.data === undefined ? <Skeleton /> : formatTokens(tokenBalance.data, "")}
        </Stat>
        <Stat label="HBAR">{hbarTinybars === undefined ? <Skeleton /> : formatHbar(hbarTinybars)}</Stat>
        <Stat
          label="Cost per run"
          hint={
            hssFee !== undefined && ccipFees !== undefined
              ? `${formatHbar(ccipFees)} CCIP fees + ≈${formatHbar(hssFee)} for the scheduled execution`
              : undefined
          }
        >
          {tokensPerRun === undefined || hbarPerRun === undefined ? (
            <Skeleton className="h-4 w-36" />
          ) : (
            <>
              {formatTokens(tokensPerRun)} + ≈{formatHbar(hbarPerRun)}
            </>
          )}
        </Stat>
        <Stat
          label="Runway"
          hint={cover ? `Limited by ${cover.limitedBy === "hbar" ? "HBAR" : "CCIP-BnM"}` : undefined}
        >
          {!ready ? (
            <Skeleton />
          ) : cover === undefined ? (
            "No active payees"
          ) : (
            `Covers ${cover.runs} run${cover.runs === 1n ? "" : "s"}`
          )}
        </Stat>
      </dl>
      <FundTreasury payroll={payroll} />
    </Card>
  );
};

/** Anyone can top the treasury up: mint test CCIP-BnM to it, or send it HBAR for CCIP and scheduling fees. */
const FundTreasury = ({ payroll }: { payroll: Address }) => {
  const { address: account } = useAccount();
  const { writeContractAsync: writeBnM, isMining: dripping } = useScaffoldWriteContract({ contractName: "CCIPBnM" });
  const transactor = useTransactor();
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const tinybars = parseHbar(amount);
  const connectHint = account ? undefined : "Connect a wallet first";

  const sendHbar = async () => {
    if (!tinybars) return;
    setSending(true);
    try {
      // A transaction's value is in weibars (18 decimals), not tinybars.
      if (await transactor({ to: payroll, value: tinybarsToWeibars(tinybars) })) setAmount("");
    } catch {
      // The transactor already showed the error.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-base-300">
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={!account || dripping}
        title={connectHint ?? "Mints 1 test CCIP-BnM to the treasury; anyone can"}
        onClick={() => writeBnM({ functionName: "drip", args: [payroll] }).catch(() => undefined)}
      >
        {dripping && <span className="loading loading-spinner loading-xs" />}
        Add 1 CCIP-BnM
      </button>
      <form
        className="join grow min-w-0 max-w-xs"
        onSubmit={event => {
          event.preventDefault();
          sendHbar();
        }}
      >
        <input
          className="input input-sm join-item w-full min-w-0"
          inputMode="decimal"
          placeholder="HBAR amount"
          aria-label="HBAR amount to send to the treasury"
          value={amount}
          onChange={event => setAmount(event.target.value)}
        />
        <button
          className="btn btn-sm btn-primary join-item"
          disabled={!account || !tinybars || sending}
          title={connectHint}
        >
          {sending && <span className="loading loading-spinner loading-xs" />}
          Send HBAR
        </button>
      </form>
      {amount !== "" && tinybars === undefined && (
        <p className="text-xs text-error m-0 w-full">Enter a positive amount with at most 8 decimals.</p>
      )}
    </div>
  );
};
