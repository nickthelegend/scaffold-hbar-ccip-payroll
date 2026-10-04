import { type Address, type Hex, encodeAbiParameters, encodeEventTopics, getAbiItem } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  type MirrorLog,
  buildHistory,
  decodePayrollLogs,
  fetchPayrollHistory,
  latestPayouts,
  payoutsTo,
  payrollAbi,
  skipReasonText,
} from "~~/utils/payroll/history";

const ALICE = "0xad7B4939Fe1d6ee776FB9Effc541351608752A4E" as Address;
const BOB = "0x7121C972911db0c76967BDce65359F1866622481" as Address;
const SEPOLIA = 16015286601757825753n;
const SCHEDULE = "0x0000000000000000000000000000000000a5a400" as Address;

/** Encodes a CrossChainPayroll event exactly as the mirror node serves it. */
function log(eventName: string, args: Record<string, unknown>, timestamp: string, tx = "aa", index = 0): MirrorLog {
  const event = getAbiItem({ abi: payrollAbi, name: eventName as never }) as unknown as {
    inputs: { name: string; type: string; indexed?: boolean }[];
  };
  const topics = encodeEventTopics({ abi: payrollAbi, eventName: eventName as never, args: args as never });
  const dataInputs = event.inputs.filter(input => !input.indexed);
  return {
    topics: topics as Hex[],
    data: encodeAbiParameters(dataInputs, dataInputs.map(input => args[input.name]) as never),
    transaction_hash: `0x${tx.repeat(32)}` as Hex,
    timestamp,
    index,
  };
}

/**
 * Run #1's PayoutSent to Alice as the mirror node served it on testnet: 0.1 CCIP-BnM to Ethereum Sepolia for a
 * 34.29966513 HBAR CCIP fee.
 */
const LIVE_PAYOUT_SENT: MirrorLog = {
  topics: [
    "0x127d360a407f72ca2727c9999bd79e72ef99e0cf1f427a6d9e9e0f00947e6603",
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x000000000000000000000000ad7b4939fe1d6ee776fb9effc541351608752a4e",
  ],
  data: "0x000000000000000000000000000000000000000000000000de41ba4fc9d91ad9000000000000000000000000000000000000000000000000016345785d8a000065f52190fe3c3745b3a9f9f7e3dff0cff893e20820264614420c75e2e6cb849000000000000000000000000000000000000000000000000000000000cc7122b1",
  transaction_hash: "0x4b03d1294082c2b3824a5d9ce859cfbafeedefacae54f8eccb8f276b52f26c81",
  timestamp: "1791106248.022653215",
  index: 20,
};

const run1 = [
  log(
    "PayoutSent",
    {
      runId: 1n,
      payeeId: 0n,
      account: ALICE,
      chainSelector: SEPOLIA,
      amount: 10n ** 17n,
      messageId: `0x${"65".repeat(32)}`,
      fee: 3_429_966_513n,
    },
    "1000.000000001",
    "aa",
    0,
  ),
  log(
    "PayoutSent",
    {
      runId: 1n,
      payeeId: 1n,
      account: BOB,
      chainSelector: 0n,
      amount: 5n * 10n ** 16n,
      messageId: `0x${"00".repeat(32)}`,
      fee: 0n,
    },
    "1000.000000001",
    "aa",
    1,
  ),
  log(
    "RunExecuted",
    { runId: 1n, paid: 2n, skipped: 0n, nextRunAt: 1600n, byScheduleService: true },
    "1000.000000001",
    "aa",
    2,
  ),
  log("RunScheduled", { at: 1610n, schedule: SCHEDULE, gasLimit: 2_110_000n }, "1000.000000001", "aa", 3),
];

const run2 = [
  log("PayoutSkipped", { runId: 2n, payeeId: 0n, reason: 1 }, "1612.5", "bb", 0),
  log(
    "PayoutSent",
    {
      runId: 2n,
      payeeId: 1n,
      account: BOB,
      chainSelector: 0n,
      amount: 5n * 10n ** 16n,
      messageId: `0x${"00".repeat(32)}`,
      fee: 0n,
    },
    "1612.5",
    "bb",
    1,
  ),
  log(
    "RunExecuted",
    { runId: 2n, paid: 1n, skipped: 1n, nextRunAt: 2200n, byScheduleService: false },
    "1612.5",
    "bb",
    2,
  ),
];

describe("decodePayrollLogs", () => {
  it("decodes a real PayoutSent log from the mirror node", () => {
    const [event] = decodePayrollLogs([LIVE_PAYOUT_SENT]);
    expect(event.eventName).toBe("PayoutSent");
    expect(event.args).toMatchObject({
      runId: 1n,
      payeeId: 0n,
      chainSelector: SEPOLIA,
      amount: 10n ** 17n,
      messageId: "0x65f52190fe3c3745b3a9f9f7e3dff0cff893e20820264614420c75e2e6cb8490",
      fee: 3_429_966_513n,
    });
    expect((event.args.account as string).toLowerCase()).toBe(ALICE.toLowerCase());
  });

  it("orders logs served newest-first chronologically, by nanosecond then log index", () => {
    const events = decodePayrollLogs([...run1, ...run2].reverse());
    expect(events.map(e => e.eventName)).toEqual([
      "PayoutSent",
      "PayoutSent",
      "RunExecuted",
      "RunScheduled",
      "PayoutSkipped",
      "PayoutSent",
      "RunExecuted",
    ]);
  });

  it("skips logs that are not CrossChainPayroll events", () => {
    const foreign: MirrorLog = { ...LIVE_PAYOUT_SENT, topics: [`0x${"ff".repeat(32)}`], data: "0x" };
    const empty: MirrorLog = { ...LIVE_PAYOUT_SENT, topics: [] };
    expect(decodePayrollLogs([foreign, empty])).toEqual([]);
  });
});

describe("buildHistory", () => {
  const history = buildHistory(decodePayrollLogs([...run1, ...run2].reverse()));

  it("groups payouts under their run, newest run first", () => {
    expect(history.runs.map(r => r.runId)).toEqual([2n, 1n]);
    expect(history.runs[1].payouts.map(p => [p.kind, p.payeeId])).toEqual([
      ["sent", 0n],
      ["sent", 1n],
    ]);
    expect(history.runs[0].payouts[0]).toEqual({ kind: "skipped", runId: 2n, payeeId: 0n, reason: 1 });
  });

  it("records who executed each run and where to find it", () => {
    expect(history.runs[1]).toMatchObject({
      byScheduleService: true,
      timestamp: "1000.000000001",
      nextRunAt: 1600n,
    });
    expect(history.runs[0].byScheduleService).toBe(false);
  });

  it("flags a schedule failure only while no later RunScheduled replaced it", () => {
    expect(history.scheduleFailure).toBeUndefined();

    const failed = buildHistory(
      decodePayrollLogs([...run1, ...run2, log("ScheduleFailed", { at: 2210n, responseCode: -1n }, "1612.5", "bb", 3)]),
    );
    expect(failed.scheduleFailure).toEqual({ at: 2210n, responseCode: -1n, timestamp: "1612.5" });

    const recovered = buildHistory(
      decodePayrollLogs([
        ...run1,
        log("ScheduleFailed", { at: 1610n, responseCode: 367n }, "1000.000000002", "cc"),
        log("RunScheduled", { at: 1700n, schedule: SCHEDULE, gasLimit: 2_110_000n }, "1100.0", "dd"),
      ]),
    );
    expect(recovered.scheduleFailure).toBeUndefined();
  });

  it("finds each payee's latest payout and every payout to an address", () => {
    const latest = latestPayouts(history.runs);
    expect(latest.get(0n)?.payout.kind).toBe("skipped");
    expect(latest.get(1n)?.run.runId).toBe(2n);

    const alice = payoutsTo(history.runs, ALICE, new Set([0n]));
    expect(alice.map(({ run, payout }) => [run.runId, payout.kind])).toEqual([
      [2n, "skipped"],
      [1n, "sent"],
    ]);
    expect(payoutsTo(history.runs, BOB.toLowerCase() as Address, new Set([1n]))).toHaveLength(2);
  });
});

describe("fetchPayrollHistory", () => {
  it("follows the mirror node's links.next across pages", async () => {
    const pages: Record<string, unknown> = {
      "/api/v1/contracts/0xpayroll/results/logs?order=desc&limit=100": {
        logs: [...run2].reverse(),
        links: { next: "/api/v1/contracts/0xpayroll/results/logs?order=desc&limit=100&timestamp=lt:1612.5" },
      },
      "/api/v1/contracts/0xpayroll/results/logs?order=desc&limit=100&timestamp=lt:1612.5": {
        logs: [...run1].reverse(),
        links: { next: null },
      },
    };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url).replace("https://testnet.mirrornode.hedera.com", "");
      return Response.json(pages[path]);
    });
    const history = await fetchPayrollHistory(296, "0xpayroll" as Address, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(history.runs.map(r => r.runId)).toEqual([2n, 1n]);
  });

  it("throws when the mirror node fails", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 503 }));
    await expect(fetchPayrollHistory(296, "0xpayroll" as Address, fetcher as typeof fetch)).rejects.toThrow("503");
  });
});

describe("skipReasonText", () => {
  it("explains every SkipReason in plain English", () => {
    expect(skipReasonText(0)).toMatch(/CCIP-BnM/);
    expect(skipReasonText(1)).toMatch(/HBAR/);
    expect(skipReasonText(9)).toBe("Unknown reason (9)");
  });
});
