# Agent instructions

Briefing for coding agents (Claude Code, Cursor, Codex) working in a **CCIP Payroll** project. Claude Code loads it through `CLAUDE.md`.

`CrossChainPayroll` is a Hedera treasury that pays a list of payees every interval, each on the chain they choose: on Hedera with a token transfer, or on another chain through Chainlink CCIP with the fee paid in native HBAR. After every run the contract schedules its own next run with the Hedera Schedule Service. Read `README.md` → "How it works" before changing contract logic.

## Packages

| Path | What | Toolchain |
|---|---|---|
| `packages/foundry` | `CrossChainPayroll`, the vendored CCIP `Client`/`IRouterClient`, deploy script, tests | Foundry (`forge`) |
| `packages/nextjs` | Payroll dashboard, payee pages, CCIP status proxy | Next.js App Router, RainbowKit, wagmi, viem, DaisyUI |

## Commands

```bash
yarn install
yarn lint                 # ESLint + forge fmt --check + prettier (types: yarn next:check-types)
yarn test                 # foundry + frontend unit tests

yarn foundry:compile
yarn foundry:test                                     # unit + fuzz (mock router and Schedule Service)
yarn foundry:test:testnet --match-path "test/fork/*"  # real CCIP router on a Hedera testnet fork; needs forge v1.7.1 (1.8.x breaks Hashio forks)
yarn foundry:deploy --network hedera_testnet          # regenerates packages/nextjs/contracts/deployedContracts.ts

yarn next:dev             # http://localhost:3000
yarn next:test
yarn next:check-types
yarn next:build

yarn harness:validate     # Hedera Harness: static checks, every yarn command, Playwright route gate
```

Before finishing any change run `yarn foundry:test`, `yarn next:test`, `yarn next:check-types` and `yarn lint`. Run `yarn next:build` if you touched pages or config, and `yarn harness:validate` before a release.

## Invariants you must preserve

1. **Units.** Payout amounts use the payout token's decimals (CCIP-BnM: 18). HBAR inside the EVM (CCIP fees from `getFee`, `quoteRun().ccipFees`, `withdraw(address(0), …)`) is **tinybars** (8 decimals). A wallet transaction's `value` and `eth_getBalance` are **weibars** (18 decimals): tinybars × 1e10. Keep conversions in the frontend's pure unit helpers; never hand-roll them in components.
2. **A payout never reverts a run.** Every failure (tokens, HBAR, quote, send, a token refusing a Hedera transfer) emits `PayoutSkipped` with a reason. A run that reverted inside the Schedule Service would also lose the next schedule, so keep `ccipSend` and `getFee` inside `try`/`catch`, keep the Hedera transfer a low-level call, and reset the router allowance after a failed send. `quoteRun` reports lanes it cannot quote (`unquoted`) instead of reverting.
3. **Scheduling is best effort and measured.** `_scheduleNextRun` uses low-level calls and emits `ScheduleFailed` instead of reverting; `run` stays permissionless once due. Creating a schedule costs a flat ~1.41M gas regardless of the scheduled call's limit (measured; `SCHEDULE_NEXT_GAS` budgets 1.45M), and Hedera bills at least 80% of a gas limit, so `runGasLimit()` adds measured per-payout costs. Re-measure on testnet (mirror node `…/contracts/results/<tx>/actions`) if you change `run`, and do not pad.
4. **Schedule timing.** Runs are scheduled at `nextRunAt + SCHEDULE_DELAY`: inside a scheduled execution `block.timestamp` is the start of the ~2 s block and can read before the scheduled second. A scheduled run is recognised by its caller (`msg.sender == address(this)`), which is how `RunExecuted.byScheduleService` is set and why it does not try to delete its own schedule.
5. **One pending schedule, with the right budget.** A manual run before the schedule's second deletes that schedule; `pause` deletes it; `start` replaces it. Never leave a schedule that would fire into `NotDue` and burn the fee. A schedule keeps the gas limit it was created with, so `addPayee`/`updatePayee` call `_rebudgetPendingRun`, which replaces the pending schedule when `runGasLimit()` no longer equals `scheduledGasLimit` (those owner calls then cost ~1.7M gas). Keep that for any new function that changes the active payee set.
6. **Owner powers are bounded.** The owner manages payees and the schedule and can withdraw the treasury. Anyone may trigger a due run but cannot change who is paid or how much. Do not add functions that let a caller pick recipients or amounts at run time.
7. **Reentrancy.** `run` and `withdraw` are `nonReentrant`.
8. **CCIP message shape.** Token-only messages to EOAs: `data` empty, `feeToken = address(0)`, `GenericExtraArgsV2{gasLimit: 0, allowOutOfOrderExecution: true}`. If you add programmable transfers (data to a receiver contract), set a measured destination gas limit and keep out-of-order execution unless ordering matters.

## Hedera and CCIP specifics

- CCIP on Hedera testnet: Router 1.2.0 `0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4`, chain selector `222782988166878823`, TokenAdminRegistry `0xA6643e4f53ceABad16970e8592D4eF7fea49260a`. CCIP-BnM `0xF8238FD7Dd2bEbEDaa65c3974175d98e6110bEb1` (anyone can `drip(address)` 1 token); its pool reaches **OP Sepolia and Ethereum Sepolia**. The router also lists lanes the token can't travel (e.g. Base Sepolia), which is why `addPayee` checks `canPayOn` (router lane **and** token pool). An older CCIP-BnM `0x01Ac…` is still registered on Hedera but its Sepolia pool rejects Hedera as a source (`InvalidSourcePoolAddress` on arrival): don't use it.
- Fees in native HBAR are quoted in tinybars. Today on testnet: Hedera → OP Sepolia ≈ 2.6 HBAR, → Ethereum Sepolia ≈ 36 HBAR per token transfer (destination gas dominates).
- A full `ccipSend` cannot run on a plain fork: the router wraps the fee through WHBAR, which calls the HTS system contract (0x167). Fork tests cover the router's lane checks and quotes; live sends are proven on testnet.
- Message status: `https://ccip.chain.link/api/h/atlas/message/<messageId>` (proxied by `app/api/ccip/[messageId]/route.ts`); human page `https://ccip.chain.link/msg/<messageId>`.
- Mirror node log queries filtered by topic must cover ≤ 7 days; page with `links.next`. The mirror node lags consensus by a few seconds.
- Debug a failed run with `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/<txHash>/actions`: it shows the router, onRamp, token pool and Schedule Service (`0x16b`) calls with gas and revert data.

## Layout

- Contract: `packages/foundry/contracts/CrossChainPayroll.sol`; CCIP types in `contracts/ccip/`; Schedule Service interface in `contracts/interfaces/`
- Tests: `packages/foundry/test/CrossChainPayroll.t.sol` (mocks in `test/mocks/` are etched at `0x16b` or deployed as the router), fork tests in `test/fork/`
- App: `packages/nextjs/app/page.tsx` (dashboard), `app/payee/[address]/page.tsx`, `app/api/ccip/[messageId]/route.ts`, `components/payroll/`, `hooks/payroll/`, `utils/payroll/` (pure, unit-tested in `packages/nextjs/test/`)

## Frontend conventions

- `CrossChainPayroll` lives in `deployedContracts.ts`, so reads use `useScaffoldReadContract` and writes `useScaffoldWriteContract`. CCIP-BnM's `drip` and `balanceOf` live in `externalContracts.ts`.
- History comes from mirror-node logs decoded with viem against the generated ABI. Keep decoding, grouping and status mapping pure and tested.
- Use DaisyUI classes before raw Tailwind, the `~~` import alias, and `"use client"` on pages with hooks. Show skeletons while loading; never render an empty state before the data has loaded.

## Extending

- **Another payout token** (e.g. USDC once a CCT lane exists): deploy with `PAYOUT_TOKEN=0x…` and check the token pool's supported chains. For an HTS token, associate the payroll contract with it first.
- **Per-payee tokens or streaming:** keep `run` bounded by `MAX_PAYEES` and re-measure `runGasLimit`.
- **Programmable payouts** (e.g. deposit straight into a vault on the destination): send `data` to a receiver contract and budget its gas in `extraArgs`.

## Style

Solidity: custom errors (no `require` strings), NatSpec on external functions, `forge fmt`. TypeScript: `type` over `interface`, let inference work, comments that add information.
