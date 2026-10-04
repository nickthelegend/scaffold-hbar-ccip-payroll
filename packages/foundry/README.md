# Foundry package: CrossChainPayroll

Contracts, deploy script and tests. The project overview, live proof and design live in the [root README](../../README.md); this file covers working inside `packages/foundry`.

## Setup

Forge libraries are git submodules under `lib/`. The scaffold CLI installs them; in a git clone run, from the repo root:

```bash
git submodule update --init --recursive
```

Use Foundry **1.7.x** (`foundryup -i v1.7.1`). Forge 1.8+ sends block tags in a form Hedera's JSON-RPC relay rejects, which breaks fork tests.

## Contracts

| File | What |
|---|---|
| `contracts/CrossChainPayroll.sol` | Treasury, payees, CCIP payouts, self-scheduling through the Hedera Schedule Service |
| `contracts/ccip/Client.sol`, `IRouterClient.sol`, `ITokenAdminRegistry.sol` | The subsets of Chainlink CCIP a sender needs (vendored; same encoding as `@chainlink/contracts-ccip`) |
| `contracts/interfaces/IHederaScheduleService.sol` | HIP-1215 system contract at `0x16b` |

## Test

```bash
yarn foundry:test                                     # unit + fuzz: mock router, token registry and Schedule Service
yarn foundry:test:testnet --match-path "test/fork/*"  # the real CCIP router and TokenAdminRegistry on a Hedera testnet fork
```

The mocks in `test/mocks/` behave like the real thing where it matters: the router checks the lane and the fee and pulls the tokens, and the Schedule Service mock records scheduled calls and can `fire` them after a warp, with the requested gas limit.

## Deploy

The payroll depends on Hedera system contracts and a live CCIP router, so it targets Hedera testnet (or mainnet), not a local chain.

```bash
yarn foundry:account:import      # or foundry:account:generate; the account must exist on Hedera (fund it at the faucet)
yarn foundry:deploy --network hedera_testnet
```

`script/Deploy.s.sol` reads optional overrides: `CCIP_ROUTER`, `TOKEN_ADMIN_REGISTRY`, `PAYOUT_TOKEN`, `PAYROLL_INTERVAL` (seconds). Deploying writes `deployments/296.json` and regenerates `packages/nextjs/contracts/deployedContracts.ts`.

Verify on Sourcify (HashScan reads it):

```bash
yarn foundry:verify:testnet <address> contracts/CrossChainPayroll.sol:CrossChainPayroll \
  --constructor-args $(cast abi-encode "f(address,address,address,uint256)" <router> <token> <registry> <interval>)
```

## Debugging a run

`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/<txHash>/actions` shows every internal call (router, onRamp, token pool, `0x16b`) with gas and revert data. `INSUFFICIENT_GAS` from `0x16b` means a schedule was created with too little gas: creating one costs ~1.41M on its own.
