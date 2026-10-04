/**
 * This file contains external contract definitions (contracts not deployed by this project).
 * Add entries here to interact with pre-deployed contracts on any supported chain.
 */
import { hederaTestnet } from "viem/chains";
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const externalContracts = {
  [hederaTestnet.id]: {
    /**
     * Chainlink's CCIP test token on Hedera testnet, the payroll's payout token. Anyone can mint 1 token (18 decimals)
     * to any address with `drip`.
     */
    CCIPBnM: {
      address: "0xF8238FD7Dd2bEbEDaa65c3974175d98e6110bEb1",
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "symbol",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "string" }],
        },
        {
          type: "function",
          name: "decimals",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint8" }],
        },
        {
          type: "function",
          name: "drip",
          stateMutability: "nonpayable",
          inputs: [{ name: "to", type: "address" }],
          outputs: [],
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
