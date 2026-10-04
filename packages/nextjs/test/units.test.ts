import { describe, expect, it } from "vitest";
import { chainName, destinationTxUrl } from "~~/utils/payroll/chains";
import {
  entityIdFromAddress,
  formatCountdown,
  formatHbar,
  formatInterval,
  formatTokens,
  parseHbar,
  parseTokens,
  runway,
  scheduledRunFee,
  tinybarsToWeibars,
  weibarsToTinybars,
} from "~~/utils/payroll/units";

describe("HBAR units", () => {
  it("converts between tinybars (contract amounts) and weibars (tx value, RPC balances)", () => {
    expect(tinybarsToWeibars(1n)).toBe(10_000_000_000n);
    expect(tinybarsToWeibars(100_000_000n)).toBe(10n ** 18n);
    expect(weibarsToTinybars(10n ** 18n)).toBe(100_000_000n);
    // Sub-tinybar dust cannot be spent by the EVM, so it rounds down.
    expect(weibarsToTinybars(19_999_999_999n)).toBe(1n);
  });

  it("parses typed HBAR to tinybars and rejects more than 8 decimals", () => {
    expect(parseHbar("5")).toBe(500_000_000n);
    expect(parseHbar(" 0.00000001 ")).toBe(1n);
    expect(parseHbar("0.000000001")).toBeUndefined();
    expect(parseHbar("-1")).toBeUndefined();
    expect(parseHbar("1e3")).toBeUndefined();
    expect(parseHbar("")).toBeUndefined();
  });

  it("parses token amounts with 18 decimals", () => {
    expect(parseTokens("0.1")).toBe(10n ** 17n);
    expect(parseTokens("abc")).toBeUndefined();
  });

  it("formats tinybars and token amounts", () => {
    expect(formatHbar(3_429_966_513n)).toBe("34.2997 ℏ");
    expect(formatHbar(0n)).toBe("0 ℏ");
    expect(formatTokens(15n * 10n ** 16n)).toBe("0.15 CCIP-BnM");
  });
});

describe("scheduledRunFee", () => {
  it("charges 80% of the gas limit at the RPC gas price, converted from weibars to tinybars", () => {
    // 2.11M gas at 870 gwei-weibars (87 tinybars) per gas: 0.8 × 2_110_000 × 87 tinybars.
    expect(scheduledRunFee(2_110_000n, 870_000_000_000n)).toBe(146_856_000n);
  });

  it("rounds a fractional tinybar up", () => {
    expect(scheduledRunFee(1n, 10_000_000_000n)).toBe(1n);
  });
});

describe("runway", () => {
  const perRun = { tokensPerRun: 15n * 10n ** 16n, hbarPerRun: 3_600_000_000n };

  it("is limited by whichever of tokens or HBAR runs out first", () => {
    expect(runway({ ...perRun, tokenBalance: 10n ** 18n, hbarBalance: 100n * 10n ** 8n })).toEqual({
      runs: 2n,
      limitedBy: "hbar",
    });
    expect(runway({ ...perRun, tokenBalance: 2n * 10n ** 17n, hbarBalance: 1_000n * 10n ** 8n })).toEqual({
      runs: 1n,
      limitedBy: "tokens",
    });
  });

  it("covers zero runs when either side is empty", () => {
    expect(runway({ ...perRun, tokenBalance: 10n ** 18n, hbarBalance: 0n })?.runs).toBe(0n);
  });

  it("ignores HBAR when every payee is on Hedera and is undefined without active payees", () => {
    expect(runway({ tokenBalance: 10n ** 18n, hbarBalance: 0n, tokensPerRun: 10n ** 17n, hbarPerRun: 0n })).toEqual({
      runs: 10n,
      limitedBy: "tokens",
    });
    expect(runway({ tokenBalance: 10n ** 18n, hbarBalance: 0n, tokensPerRun: 0n, hbarPerRun: 0n })).toBeUndefined();
  });
});

describe("time formatting", () => {
  it("describes intervals in the two largest units", () => {
    expect(formatInterval(604_800)).toBe("7 days");
    expect(formatInterval(86_400 + 12 * 3_600 + 5)).toBe("1 day 12 hours");
    expect(formatInterval(90)).toBe("1 minute 30 seconds");
    expect(formatInterval(0)).toBe("0 seconds");
  });

  it("formats countdowns compactly", () => {
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(12)).toBe("12s");
    expect(formatCountdown(187)).toBe("3m 07s");
    expect(formatCountdown(4 * 3_600 + 5 * 60)).toBe("4h 05m");
    expect(formatCountdown(6 * 86_400 + 23 * 3_600 + 59)).toBe("6d 23h");
  });
});

describe("entityIdFromAddress", () => {
  it("converts long-zero addresses to 0.0.N", () => {
    expect(entityIdFromAddress("0x0000000000000000000000000000000000a5a311")).toBe("0.0.10855185");
  });

  it("rejects ordinary EVM addresses", () => {
    expect(entityIdFromAddress("0x2A5fD5e5a0f8b7B462c185C49991A8A024731F4C")).toBeUndefined();
  });
});

describe("chains", () => {
  it("names CCIP selectors and links destination transactions", () => {
    expect(chainName(0n)).toBe("Hedera");
    expect(chainName(16015286601757825753n)).toBe("Ethereum Sepolia");
    expect(chainName(42n)).toBe("Chain 42");
    expect(destinationTxUrl(16015286601757825753n, "0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
    expect(destinationTxUrl(0n, "0xabc")).toBeUndefined();
  });
});
