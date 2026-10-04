import type { Address } from "viem";

/** A payee as `getPayees()` returns it, with its index (the payee id). */
export type PayeeEntry = {
  id: bigint;
  account: Address;
  chainSelector: bigint;
  active: boolean;
  amount: bigint;
  label: string;
};
