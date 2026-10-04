# CCIP Payroll — product requirements

## Problem
Teams that hold their treasury on Hedera pay contributors who live on other chains. Today that means a person bridging
by hand every pay period, or a keeper bot that someone has to run, fund and trust. Payroll needs to pay each
contributor on the chain they choose, on time, without anyone pressing a button.

## Users
- **Employer** (the payroll's owner): adds payees and amounts, funds the treasury, starts and pauses payroll.
- **Payee**: receives a fixed amount every interval on Hedera or on a CCIP-connected chain. Needs no Hedera account
  for cross-chain payouts and no gas on the destination.
- **Anyone**: can trigger a due run if a schedule was missed, and can top up the treasury.

## Requirements
1. `addPayee(account, chainSelector, amount, label)`: `chainSelector == 0` pays on Hedera, otherwise the CCIP router
   must support the destination (`isChainSupported`). At most `MAX_PAYEES` (20).
2. `run()` (permissionless once `block.timestamp >= nextRunAt`, never while paused) pays every active payee:
   Hedera payees by token transfer, others by `ccipSend` of the payout token to their EOA with the fee in native HBAR
   (`feeToken = address(0)`), `extraArgs` V2 with gas limit 0 and out-of-order execution allowed.
3. A payout that cannot be made (not enough tokens, not enough HBAR for the fee, quote or send rejected) emits
   `PayoutSkipped` with the reason and never reverts the run.
4. After a run, `nextRunAt += interval` (or `now + interval` if the run was late) and the contract schedules `run()`
   on the Hedera Schedule Service (0x16b) at `nextRunAt + SCHEDULE_DELAY`, searching up to `CAPACITY_SEARCH` seconds
   for capacity. The gas limit is measured per active payee (`runGasLimit`). Scheduling failures emit
   `ScheduleFailed` and never revert.
5. A run triggered by hand before its schedule fires deletes that schedule. `RunExecuted.byScheduleService` records
   whether the network executed the run (the Schedule Service calls as the contract itself).
6. `pause()` deletes the pending schedule; `start(firstRunAt)` (re)starts and schedules.
7. The owner can withdraw tokens or HBAR. Nobody else can move funds or change payees.
8. The Next.js app shows treasury balances, cost per run and runway, the schedule with a countdown and HashScan link,
   payees, and run history where every CCIP payout links to the CCIP explorer with its live delivery status; a payee
   page lists one address's payouts; the owner manages payroll from the dashboard.
