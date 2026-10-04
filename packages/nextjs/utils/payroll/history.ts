import { type Address, type Hex, decodeEventLog } from "viem";
import { hedera, hederaTestnet } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

/** The ABI is identical on every network; testnet's copy is always generated. */
export const payrollAbi = deployedContracts[hederaTestnet.id].CrossChainPayroll.abi;

const MIRROR_NODES: Record<number, string> = {
  [hederaTestnet.id]: "https://testnet.mirrornode.hedera.com",
  [hedera.id]: "https://mainnet-public.mirrornode.hedera.com",
};

export const mirrorNodeUrl = (chainId: number) => MIRROR_NODES[chainId] ?? MIRROR_NODES[hederaTestnet.id];

/** Upper bound on pages of 100 logs fetched per refresh. */
const MAX_PAGES = 50;

/** A contract log as `/api/v1/contracts/{address}/results/logs` serves it. */
export type MirrorLog = {
  data: Hex;
  topics: Hex[];
  transaction_hash: Hex;
  /** Consensus timestamp, "seconds.nanoseconds". */
  timestamp: string;
  /** Position of the log within its transaction. */
  index: number;
};

export type PayrollEvent = {
  eventName: string;
  args: Record<string, unknown>;
  txHash: Hex;
  /** Consensus timestamp, "seconds.nanoseconds": HashScan links transactions by it. */
  timestamp: string;
};

/** Mirrors the contract's `SkipReason` enum. */
const SKIP_REASONS = [
  "Not enough CCIP-BnM in the treasury",
  "Not enough HBAR in the treasury for the CCIP fee",
  "CCIP could not quote a fee for this lane",
  "The CCIP router rejected the transfer",
  "The token refused the transfer on Hedera (e.g. the payee is not associated with an HTS token)",
];

export const skipReasonText = (reason: number) => SKIP_REASONS[reason] ?? `Unknown reason (${reason})`;

export type SentPayout = {
  kind: "sent";
  runId: bigint;
  payeeId: bigint;
  account: Address;
  chainSelector: bigint;
  amount: bigint;
  /** Zero for payouts on Hedera, which are plain transfers. */
  messageId: Hex;
  /** CCIP fee in tinybars. */
  fee: bigint;
};

export type SkippedPayout = { kind: "skipped"; runId: bigint; payeeId: bigint; reason: number };

export type Payout = SentPayout | SkippedPayout;

export type Run = {
  runId: bigint;
  paid: bigint;
  skipped: bigint;
  nextRunAt: bigint;
  /** True when the Hedera Schedule Service executed the run, false when someone called `run()` by hand. */
  byScheduleService: boolean;
  txHash: Hex;
  timestamp: string;
  payouts: Payout[];
};

export type ScheduleFailure = { at: bigint; responseCode: bigint; timestamp: string };

export type PayrollHistory = {
  /** Newest first. */
  runs: Run[];
  /** Set when the most recent attempt to schedule the next run failed, so it needs a manual `run()`. */
  scheduleFailure?: ScheduleFailure;
};

/** Total order of logs: consensus timestamp to the nanosecond, then position within the transaction. */
const logOrder = (log: MirrorLog) => {
  const [seconds, nanos = "0"] = log.timestamp.split(".");
  return BigInt(seconds) * 1_000_000_000n + BigInt(nanos.padEnd(9, "0"));
};

/** Decodes CrossChainPayroll logs in chronological order, skipping anything that is not one of its events. */
export function decodePayrollLogs(logs: MirrorLog[]): PayrollEvent[] {
  const ordered = [...logs].sort((a, b) => {
    const delta = logOrder(a) - logOrder(b);
    return delta !== 0n ? (delta < 0n ? -1 : 1) : a.index - b.index;
  });
  const events: PayrollEvent[] = [];
  for (const log of ordered) {
    const topics = log.topics.filter(Boolean);
    if (topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({ abi: payrollAbi, data: log.data, topics: topics as [Hex, ...Hex[]] });
      events.push({
        eventName: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        txHash: log.transaction_hash,
        timestamp: log.timestamp,
      });
    } catch {
      // Not a CrossChainPayroll event.
    }
  }
  return events;
}

/**
 * Folds the chronological event stream into runs (newest first) and the state of the latest scheduling attempt.
 * A run's payouts are emitted before its `RunExecuted`, so they are collected by run id.
 */
export function buildHistory(events: PayrollEvent[]): PayrollHistory {
  const payouts = new Map<bigint, Payout[]>();
  const runs: Run[] = [];
  let scheduleFailure: ScheduleFailure | undefined;

  const addPayout = (payout: Payout) => {
    const list = payouts.get(payout.runId) ?? [];
    list.push(payout);
    payouts.set(payout.runId, list);
  };

  for (const { eventName, args, txHash, timestamp } of events) {
    switch (eventName) {
      case "PayoutSent":
        addPayout({
          kind: "sent",
          runId: args.runId as bigint,
          payeeId: args.payeeId as bigint,
          account: args.account as Address,
          chainSelector: args.chainSelector as bigint,
          amount: args.amount as bigint,
          messageId: args.messageId as Hex,
          fee: args.fee as bigint,
        });
        break;
      case "PayoutSkipped":
        addPayout({
          kind: "skipped",
          runId: args.runId as bigint,
          payeeId: args.payeeId as bigint,
          reason: Number(args.reason),
        });
        break;
      case "RunExecuted": {
        const runId = args.runId as bigint;
        runs.push({
          runId,
          paid: args.paid as bigint,
          skipped: args.skipped as bigint,
          nextRunAt: args.nextRunAt as bigint,
          byScheduleService: Boolean(args.byScheduleService),
          txHash,
          timestamp,
          payouts: payouts.get(runId) ?? [],
        });
        break;
      }
      case "RunScheduled":
        scheduleFailure = undefined;
        break;
      case "ScheduleFailed":
        scheduleFailure = { at: args.at as bigint, responseCode: args.responseCode as bigint, timestamp };
        break;
    }
  }
  return { runs: runs.reverse(), scheduleFailure };
}

export type PayoutRecord = { run: Run; payout: Payout };

/**
 * Every payout addressed to `account`, newest first. Skipped payouts carry only a payee id, so `payeeIds` (the ids
 * whose account is `account`) resolves them.
 */
export function payoutsTo(runs: Run[], account: Address, payeeIds: ReadonlySet<bigint>): PayoutRecord[] {
  const target = account.toLowerCase();
  return runs.flatMap(run =>
    run.payouts
      .filter(payout =>
        payout.kind === "sent" ? payout.account.toLowerCase() === target : payeeIds.has(payout.payeeId),
      )
      .map(payout => ({ run, payout })),
  );
}

/** The most recent payout per payee id. */
export function latestPayouts(runs: Run[]): Map<bigint, PayoutRecord> {
  const latest = new Map<bigint, PayoutRecord>();
  for (const run of runs) {
    for (const payout of run.payouts) {
      if (!latest.has(payout.payeeId)) latest.set(payout.payeeId, { run, payout });
    }
  }
  return latest;
}

/** Pages through a mirror-node collection newest first (following `links.next`), up to MAX_PAGES. */
export async function fetchAllPages<T>(
  baseUrl: string,
  path: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const response = await fetcher(`${baseUrl}${next}`);
    if (!response.ok) throw new Error(`Mirror node returned ${response.status}`);
    const body = (await response.json()) as Record<string, unknown> & { links?: { next: string | null } };
    items.push(...((body[key] as T[] | undefined) ?? []));
    next = body.links?.next ?? null;
  }
  return items;
}

export async function fetchPayrollHistory(
  chainId: number,
  payroll: Address,
  fetcher: typeof fetch = fetch,
): Promise<PayrollHistory> {
  const logs = await fetchAllPages<MirrorLog>(
    mirrorNodeUrl(chainId),
    `/api/v1/contracts/${payroll}/results/logs?order=desc&limit=100`,
    "logs",
    fetcher,
  );
  return buildHistory(decodePayrollLogs(logs));
}

/** HashScan links a transaction by its consensus timestamp, which also works for scheduled transactions. */
export const hashscanTxUrl = (explorer: string, timestamp: string) => `${explorer}/transaction/${timestamp}`;
