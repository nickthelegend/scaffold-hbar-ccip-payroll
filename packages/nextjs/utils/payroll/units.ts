import { formatUnits, parseUnits } from "viem";

/**
 * HBAR has two units in this app. Inside contracts (fees, balances, `withdraw` amounts) HBAR is in tinybars (8
 * decimals). A transaction's `value`, and balances read over JSON-RPC, are in weibars (18 decimals).
 */
export const HBAR_DECIMALS = 8;
export const WEIBARS_PER_TINYBAR = 10n ** 10n;
/** The payout token (CCIP-BnM) has 18 decimals. */
export const TOKEN_DECIMALS = 18;

/** Hedera charges at least 80% of a transaction's gas limit, whatever it actually uses. */
const MIN_GAS_CHARGE_BPS = 8_000n;

export const tinybarsToWeibars = (tinybars: bigint) => tinybars * WEIBARS_PER_TINYBAR;

/** Rounds down: the EVM cannot spend a fraction of a tinybar. */
export const weibarsToTinybars = (weibars: bigint) => weibars / WEIBARS_PER_TINYBAR;

const AMOUNT_PATTERN = (decimals: number) => new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);

/** Parses a user-typed decimal amount, or returns undefined if it is malformed or has too many decimals. */
export function parseAmount(input: string, decimals: number): bigint | undefined {
  const value = input.trim();
  if (!AMOUNT_PATTERN(decimals).test(value)) return undefined;
  return parseUnits(value, decimals);
}

export const parseHbar = (input: string) => parseAmount(input, HBAR_DECIMALS);
export const parseTokens = (input: string) => parseAmount(input, TOKEN_DECIMALS);

const formatNumber = (value: string, maxDigits: number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: maxDigits });

export const formatHbar = (tinybars: bigint, maxDigits = 4) =>
  `${formatNumber(formatUnits(tinybars, HBAR_DECIMALS), maxDigits)} ℏ`;

/** Payout-token amount; pass `symbol: ""` for a bare number. */
export const formatTokens = (amount: bigint, symbol = "CCIP-BnM", maxDigits = 4) =>
  `${formatNumber(formatUnits(amount, TOKEN_DECIMALS), maxDigits)} ${symbol}`.trim();

/**
 * What the Schedule Service charges to execute a run, in tinybars: at least 80% of the gas limit at the network gas
 * price. `gasPriceWeibars` is what `eth_gasPrice` returns (weibars per gas).
 */
export function scheduledRunFee(gasLimit: bigint, gasPriceWeibars: bigint): bigint {
  const weibars = (gasLimit * gasPriceWeibars * MIN_GAS_CHARGE_BPS) / 10_000n;
  return (weibars + WEIBARS_PER_TINYBAR - 1n) / WEIBARS_PER_TINYBAR;
}

export type Runway = { runs: bigint; limitedBy: "tokens" | "hbar" };

/** How many full runs the treasury covers: the smaller of what its tokens and its HBAR pay for. */
export function runway({
  tokenBalance,
  hbarBalance,
  tokensPerRun,
  hbarPerRun,
}: {
  tokenBalance: bigint;
  /** tinybars */
  hbarBalance: bigint;
  tokensPerRun: bigint;
  /** tinybars */
  hbarPerRun: bigint;
}): Runway | undefined {
  if (tokensPerRun === 0n) return undefined;
  const byTokens = tokenBalance / tokensPerRun;
  if (hbarPerRun === 0n) return { runs: byTokens, limitedBy: "tokens" };
  const byHbar = hbarBalance / hbarPerRun;
  return byHbar < byTokens ? { runs: byHbar, limitedBy: "hbar" } : { runs: byTokens, limitedBy: "tokens" };
}

const UNITS: [seconds: number, singular: string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/** "7 days", "1 day 12 hours", "90 seconds" → "1 minute 30 seconds". Shows the two largest units. */
export function formatInterval(seconds: number): string {
  const parts: string[] = [];
  let rest = Math.max(0, Math.floor(seconds));
  for (const [size, name] of UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(`${count} ${name}${count === 1 ? "" : "s"}`);
  }
  return parts.slice(0, 2).join(" ") || "0 seconds";
}

/** Compact countdown: "6d 23h", "4h 05m", "3m 07s", "12s". */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** A unix time (seconds) in the viewer's locale and time zone. */
export const formatTime = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** Hedera entities created by system contracts (schedules, tokens) have long-zero EVM addresses: 0x000…<num>. */
export function entityIdFromAddress(address: string): string | undefined {
  if (!/^0x0{24}[0-9a-fA-F]{16}$/.test(address)) return undefined;
  return `0.0.${BigInt(address)}`;
}

export const shortHex = (value: string, chars = 4) => `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
