"use client";

import { useState } from "react";
import type { PayeeEntry } from "./types";
import { Card } from "./ui";
import { formatUnits, isAddress, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { useRefreshHistoryAfterTx } from "~~/hooks/payroll";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { DESTINATION_OPTIONS, HEDERA_SELECTOR, chainName } from "~~/utils/payroll/chains";
import { TOKEN_DECIMALS, formatInterval, parseHbar, parseTokens } from "~~/utils/payroll/units";

/** Owner-only write helper: resolves true once the transaction is confirmed, false if rejected or reverted. */
function useOwnerWrite() {
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "CrossChainPayroll" });
  const refreshHistory = useRefreshHistoryAfterTx();
  const write: typeof writeContractAsync = async (...params) => {
    try {
      const hash = await writeContractAsync(...params);
      if (hash) refreshHistory();
      return hash;
    } catch {
      // The scaffold already showed the error as a notification.
      return undefined;
    }
  };
  return { write, isMining };
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 min-w-0">
    <span className="text-xs uppercase tracking-wider text-base-content/60">{label}</span>
    {children}
  </label>
);

const Spinner = ({ on }: { on: boolean }) => (on ? <span className="loading loading-spinner loading-xs" /> : null);

export const OwnerPanel = ({ payees }: { payees: PayeeEntry[] }) => (
  <Card title="Owner controls" aside={<span className="badge badge-sm badge-primary">You own this payroll</span>}>
    <div className="grid gap-6 lg:grid-cols-2">
      <AddPayee />
      <UpdatePayee payees={payees} />
      <ScheduleControls />
      <Withdraw />
    </div>
  </Card>
);

const AddPayee = () => {
  const { write, isMining } = useOwnerWrite();
  const [account, setAccount] = useState("");
  const [selector, setSelector] = useState(DESTINATION_OPTIONS[0].selector.toString());
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const parsed = parseTokens(amount);
  const crossChain = selector !== HEDERA_SELECTOR.toString();
  // The router can list lanes the payout token's CCIP pool cannot travel; the contract refuses those payees.
  const { data: reachable, isLoading: checkingLane } = useScaffoldReadContract({
    contractName: "CrossChainPayroll",
    functionName: "canPayOn",
    args: [BigInt(selector)],
    query: { enabled: crossChain },
  });
  const laneOk = !crossChain || reachable === true;
  const valid = isAddress(account) && parsed !== undefined && parsed > 0n && laneOk;

  return (
    <form
      className="space-y-3"
      onSubmit={async event => {
        event.preventDefault();
        if (!isAddress(account) || !parsed) return;
        const ok = await write({
          functionName: "addPayee",
          args: [account, BigInt(selector), parsed, label.trim()],
        });
        if (ok) {
          setAccount("");
          setAmount("");
          setLabel("");
        }
      }}
    >
      <h3 className="font-semibold m-0">Add a payee</h3>
      <Field label="Account (EVM address)">
        <input
          className={`input input-sm w-full font-mono ${account && !isAddress(account) ? "input-error" : ""}`}
          placeholder="0x…"
          value={account}
          onChange={e => setAccount(e.target.value.trim())}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid on">
          <select className="select select-sm w-full" value={selector} onChange={e => setSelector(e.target.value)}>
            {DESTINATION_OPTIONS.map(option => (
              <option key={option.selector.toString()} value={option.selector.toString()}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CCIP-BnM per run">
          <input
            className={`input input-sm w-full ${amount && parsed === undefined ? "input-error" : ""}`}
            inputMode="decimal"
            placeholder="0.1"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </Field>
      </div>
      {crossChain && !checkingLane && reachable === false && (
        <p className="text-xs text-warning m-0" role="alert">
          The payout token&apos;s CCIP pool doesn&apos;t reach {chainName(BigInt(selector))}, so the contract would
          refuse this payee. Pick another chain.
        </p>
      )}
      <Field label="Label">
        <input
          className="input input-sm w-full"
          placeholder="Alice"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
      </Field>
      <button className="btn btn-sm btn-primary" disabled={!valid || isMining}>
        <Spinner on={isMining} />
        Add payee
      </button>
    </form>
  );
};

const UpdatePayee = ({ payees }: { payees: PayeeEntry[] }) => {
  const { write, isMining } = useOwnerWrite();
  const [id, setId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [active, setActive] = useState(true);
  const parsed = parseTokens(amount);

  const select = (value: string) => {
    setId(value);
    const payee = payees.find(p => p.id.toString() === value);
    if (payee) {
      setAmount(formatUnits(payee.amount, TOKEN_DECIMALS));
      setActive(payee.active);
    }
  };

  if (payees.length === 0) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={async event => {
        event.preventDefault();
        if (id === "" || parsed === undefined) return;
        await write({ functionName: "updatePayee", args: [BigInt(id), parsed, active] });
      }}
    >
      <h3 className="font-semibold m-0">Update a payee</h3>
      <Field label="Payee">
        <select className="select select-sm w-full" value={id} onChange={e => select(e.target.value)}>
          <option value="" disabled>
            Choose a payee
          </option>
          {payees.map(p => (
            <option key={p.id.toString()} value={p.id.toString()}>
              #{p.id.toString()} {p.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="CCIP-BnM per run">
          <input
            className={`input input-sm w-full ${amount && parsed === undefined ? "input-error" : ""}`}
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={id === ""}
          />
        </Field>
        <label className="label cursor-pointer gap-2 h-8">
          <input
            type="checkbox"
            className="toggle toggle-sm toggle-success"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            disabled={id === ""}
          />
          <span className="text-sm">{active ? "Active" : "Paused"}</span>
        </label>
      </div>
      <p className="text-xs text-base-content/60 m-0">
        To change where someone is paid, pause them and add them again.
      </p>
      <button className="btn btn-sm btn-primary" disabled={id === "" || parsed === undefined || isMining}>
        <Spinner on={isMining} />
        Update payee
      </button>
    </form>
  );
};

const INTERVAL_UNITS = [
  { label: "minutes", seconds: 60 },
  { label: "hours", seconds: 3_600 },
  { label: "days", seconds: 86_400 },
];

const ScheduleControls = () => {
  const { write, isMining } = useOwnerWrite();
  const [firstRun, setFirstRun] = useState("");
  const [count, setCount] = useState("7");
  const [unit, setUnit] = useState(String(86_400));
  const intervalSeconds = /^\d+$/.test(count) ? Number(count) * Number(unit) : 0;
  // `datetime-local` is in the viewer's time zone; an empty value starts now.
  const firstRunAt = firstRun ? Math.floor(new Date(firstRun).getTime() / 1000) : 0;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold m-0">Schedule</h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={event => {
          event.preventDefault();
          write({ functionName: "start", args: [BigInt(firstRunAt)] });
        }}
      >
        <Field label="First run (empty = now)">
          <input
            type="datetime-local"
            className="input input-sm"
            value={firstRun}
            onChange={e => setFirstRun(e.target.value)}
          />
        </Field>
        <button className="btn btn-sm btn-primary" disabled={isMining}>
          <Spinner on={isMining} />
          Start
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline btn-warning"
          disabled={isMining}
          onClick={() => write({ functionName: "pause" })}
        >
          Pause
        </button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={event => {
          event.preventDefault();
          write({ functionName: "setInterval", args: [BigInt(intervalSeconds)] });
        }}
      >
        <Field label="Pay every">
          <div className="join">
            <input
              className="input input-sm join-item w-20"
              inputMode="numeric"
              value={count}
              onChange={e => setCount(e.target.value)}
            />
            <select className="select select-sm join-item" value={unit} onChange={e => setUnit(e.target.value)}>
              {INTERVAL_UNITS.map(u => (
                <option key={u.seconds} value={u.seconds}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <button className="btn btn-sm btn-outline" disabled={intervalSeconds < 60 || isMining}>
          Set interval
        </button>
      </form>
      <p className="text-xs text-base-content/60 m-0">
        {intervalSeconds >= 60
          ? `Runs every ${formatInterval(intervalSeconds)}. `
          : "The minimum interval is 1 minute. "}
        A new interval applies from the run after the next one.
      </p>
    </div>
  );
};

const Withdraw = () => {
  const { address } = useAccount();
  const { write, isMining } = useOwnerWrite();
  const { data: token } = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "token" });
  // `withdraw` takes address(0) for HBAR.
  const [withdrawHbar, setWithdrawHbar] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const asset = withdrawHbar ? zeroAddress : token;
  // HBAR is withdrawn in tinybars, the unit the contract uses internally.
  const parsed = withdrawHbar ? parseHbar(amount) : parseTokens(amount);
  const recipient = to || address || "";
  const valid = asset !== undefined && isAddress(recipient) && parsed !== undefined && parsed > 0n;

  return (
    <form
      className="space-y-3"
      onSubmit={async event => {
        event.preventDefault();
        if (!asset || !isAddress(recipient) || !parsed) return;
        if (await write({ functionName: "withdraw", args: [asset, recipient, parsed] })) {
          setAmount("");
        }
      }}
    >
      <h3 className="font-semibold m-0">Withdraw</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset">
          <select
            className="select select-sm w-full"
            value={withdrawHbar ? "hbar" : "token"}
            onChange={e => setWithdrawHbar(e.target.value === "hbar")}
          >
            <option value="token">CCIP-BnM</option>
            <option value="hbar">HBAR</option>
          </select>
        </Field>
        <Field label="Amount">
          <input
            className={`input input-sm w-full ${amount && parsed === undefined ? "input-error" : ""}`}
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <Field label="To (default: your wallet)">
        <input
          className={`input input-sm w-full font-mono ${to && !isAddress(to) ? "input-error" : ""}`}
          placeholder={address ?? "0x…"}
          value={to}
          onChange={e => setTo(e.target.value.trim())}
        />
      </Field>
      <button className="btn btn-sm btn-outline" disabled={!valid || isMining}>
        <Spinner on={isMining} />
        Withdraw
      </button>
    </form>
  );
};
