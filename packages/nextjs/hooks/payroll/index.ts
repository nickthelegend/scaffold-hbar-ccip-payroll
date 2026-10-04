import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Address, zeroAddress } from "viem";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { type CcipMessage, ccipStatus } from "~~/utils/payroll/ccip";
import { fetchPayrollHistory } from "~~/utils/payroll/history";
import { contracts } from "~~/utils/scaffold-hbar/contract";

const HISTORY_POLL_MS = 15_000;
const CCIP_POLL_MS = 30_000;
/** The mirror node indexes a transaction a few seconds after consensus. */
const MIRROR_LAG_MS = 5_000;

/**
 * The CrossChainPayroll address on the target network from `deployedContracts.ts`, or undefined when it has no
 * deployment there. Read statically, so a flaky RPC never makes the dashboard claim the contract is missing.
 */
export function usePayroll() {
  const { targetNetwork } = useTargetNetwork();
  const address = contracts?.[targetNetwork.id]?.CrossChainPayroll?.address;
  return { address: address && address !== zeroAddress ? (address as Address) : undefined };
}

const historyKey = (chainId: number, payroll: Address | undefined) => ["payroll-history", chainId, payroll];

/** Runs, payouts and the latest scheduling outcome, decoded from the mirror node. */
export function usePayrollHistory() {
  const { targetNetwork } = useTargetNetwork();
  const { address } = usePayroll();
  return useQuery({
    queryKey: historyKey(targetNetwork.id, address),
    queryFn: () => fetchPayrollHistory(targetNetwork.id, address!),
    enabled: Boolean(address),
    refetchInterval: HISTORY_POLL_MS,
  });
}

/** Refetches the history once the mirror node has had time to index a transaction that just landed. */
export function useRefreshHistoryAfterTx() {
  const queryClient = useQueryClient();
  const { targetNetwork } = useTargetNetwork();
  const { address } = usePayroll();
  return () => {
    setTimeout(() => queryClient.invalidateQueries({ queryKey: historyKey(targetNetwork.id, address) }), MIRROR_LAG_MS);
  };
}

/** A CCIP message's status from the CCIP explorer (through `/api/ccip`); `null` until the explorer indexes it. */
export function useCcipMessage(messageId: string | undefined) {
  return useQuery({
    queryKey: ["ccip-message", messageId],
    queryFn: async (): Promise<CcipMessage | null> => {
      const response = await fetch(`/api/ccip/${messageId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`CCIP status unavailable (${response.status})`);
      return response.json();
    },
    enabled: Boolean(messageId),
    refetchInterval: query =>
      query.state.data !== undefined && ccipStatus(query.state.data).final ? false : CCIP_POLL_MS,
  });
}

/** Wall-clock seconds, re-rendering every `intervalMs`, for countdowns. */
export function useNowSeconds(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The payee list with each payee's id (its index). `payees` is undefined until loaded. */
export function usePayees() {
  const read = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "getPayees" });
  const payees = useMemo(() => read.data?.map((payee, index) => ({ ...payee, id: BigInt(index) })), [read.data]);
  return { payees, isError: read.isError, refetch: read.refetch };
}
