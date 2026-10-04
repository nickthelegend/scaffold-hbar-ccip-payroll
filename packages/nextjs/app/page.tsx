"use client";

import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { OwnerPanel } from "~~/components/payroll/OwnerPanel";
import { PayeesTable } from "~~/components/payroll/PayeesTable";
import { RunHistory } from "~~/components/payroll/RunHistory";
import { ScheduleCard } from "~~/components/payroll/ScheduleCard";
import { TreasuryCard } from "~~/components/payroll/TreasuryCard";
import { ErrorAlert, Skeleton } from "~~/components/payroll/ui";
import { usePayees, usePayroll, usePayrollHistory } from "~~/hooks/payroll";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { ccipAddressUrl } from "~~/utils/payroll/ccip";

const Home: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const { address: payroll } = usePayroll();

  return (
    <div className="flex flex-col grow lg:pb-20">
      <section className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-5 py-12 space-y-5">
          <p className="uppercase tracking-[0.2em] text-xs text-white/70 m-0">CCIP Payroll · Scaffold-HBAR template</p>
          <h1 className="text-3xl md:text-5xl font-bold leading-tight m-0 max-w-3xl">
            Payroll from Hedera to any chain, with no keeper.
          </h1>
          <p className="text-lg text-white/80 max-w-2xl m-0">
            A Hedera treasury pays every payee on the chain they choose, through Chainlink CCIP, and schedules its own
            next run with the Hedera Schedule Service.
          </p>
          {payroll && (
            <div className="flex flex-wrap gap-3">
              <a
                className="btn btn-sm btn-outline text-white border-white/40 hover:bg-white/10"
                href={ccipAddressUrl(payroll)}
                target="_blank"
                rel="noreferrer"
              >
                CCIP explorer <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
              <a
                className="btn btn-sm btn-outline text-white border-white/40 hover:bg-white/10"
                href={`${targetNetwork.blockExplorers?.default.url}/contract/${payroll}`}
                target="_blank"
                rel="noreferrer"
              >
                Contract on HashScan <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </section>

      <div className="max-w-5xl mx-auto w-full px-4 sm:px-5 py-8 space-y-8">
        {payroll ? (
          <Dashboard />
        ) : (
          <div role="alert" className="alert alert-warning text-sm">
            CrossChainPayroll isn&apos;t deployed on {targetNetwork.name}. Switch to Hedera Testnet, or deploy it with{" "}
            <code>yarn deploy --network hedera_testnet</code>.
          </div>
        )}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { address: payroll } = usePayroll();
  const { address: connected } = useAccount();
  const { data: owner } = useScaffoldReadContract({ contractName: "CrossChainPayroll", functionName: "owner" });
  const { payees, isError: payeesError, refetch: refetchPayees } = usePayees();
  const history = usePayrollHistory();
  const isOwner = Boolean(owner && connected && owner.toLowerCase() === connected.toLowerCase());

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <TreasuryCard payroll={payroll!} />
        <ScheduleCard scheduleFailure={history.data?.scheduleFailure} />
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-bold m-0">Payees</h2>
        {payees ? (
          <PayeesTable payees={payees} runs={history.data?.runs} historyFailed={history.isError} />
        ) : payeesError ? (
          <ErrorAlert message="Couldn't load the payees from the RPC." onRetry={() => refetchPayees()} />
        ) : (
          <Skeleton className="h-32 w-full" label="Loading payees" />
        )}
      </section>

      {isOwner && payees && <OwnerPanel payees={payees} />}

      <section className="space-y-3">
        <h2 className="text-xl font-bold m-0">Run history</h2>
        {history.data && payees ? (
          <RunHistory runs={history.data.runs} payees={payees} />
        ) : history.isError ? (
          <ErrorAlert message="Couldn't load the run history from the mirror node." onRetry={() => history.refetch()} />
        ) : (
          <Skeleton className="h-40 w-full" label="Loading run history" />
        )}
      </section>
    </>
  );
};

export default Home;
