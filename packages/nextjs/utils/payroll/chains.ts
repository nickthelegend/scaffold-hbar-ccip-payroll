/** `chainSelector` value the contract uses for "pay on Hedera itself" (CCIP selectors are never 0). */
export const HEDERA_SELECTOR = 0n;

type Destination = {
  name: string;
  /** Block explorer transaction URL prefix on the destination chain (Hedera payouts link to HashScan instead). */
  txUrl?: string;
};

/** CCIP chain selectors of the testnets Hedera testnet has CCIP lanes to, plus Hedera itself. */
export const DESTINATIONS: Record<string, Destination> = {
  "0": { name: "Hedera" },
  "16015286601757825753": { name: "Ethereum Sepolia", txUrl: "https://sepolia.etherscan.io/tx/" },
  "10344971235874465080": { name: "Base Sepolia", txUrl: "https://sepolia.basescan.org/tx/" },
  "3478487238524512106": { name: "Arbitrum Sepolia", txUrl: "https://sepolia.arbiscan.io/tx/" },
  "5224473277236331295": { name: "OP Sepolia", txUrl: "https://sepolia-optimism.etherscan.io/tx/" },
  "14767482510784806043": { name: "Avalanche Fuji", txUrl: "https://testnet.snowtrace.io/tx/" },
  "16281711391670634445": { name: "Polygon Amoy", txUrl: "https://amoy.polygonscan.com/tx/" },
};

export const DESTINATION_OPTIONS = Object.entries(DESTINATIONS).map(([selector, { name }]) => ({
  selector: BigInt(selector),
  name,
}));

export const isHedera = (selector: bigint) => selector === HEDERA_SELECTOR;

export function chainName(selector: bigint): string {
  return DESTINATIONS[selector.toString()]?.name ?? `Chain ${selector}`;
}

/** Explorer link for a transaction on a CCIP destination chain, or undefined for chains not in the map. */
export function destinationTxUrl(selector: bigint, txHash: string): string | undefined {
  const prefix = DESTINATIONS[selector.toString()]?.txUrl;
  return prefix ? `${prefix}${txHash}` : undefined;
}
