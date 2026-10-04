import { CcipStatus } from "./CcipStatus";
import { isHedera } from "~~/utils/payroll/chains";
import { type PayoutRecord, skipReasonText } from "~~/utils/payroll/history";

/** One payout's outcome: CCIP delivery status, "paid on Hedera", or why it was skipped. */
export const PayoutStatus = ({ record }: { record: PayoutRecord }) => {
  const { payout } = record;
  if (payout.kind === "skipped") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="badge badge-sm badge-warning">Skipped</span>
        <span className="text-xs text-base-content/70">{skipReasonText(payout.reason)}</span>
      </span>
    );
  }
  if (isHedera(payout.chainSelector)) {
    return <span className="badge badge-sm badge-success">Paid on Hedera</span>;
  }
  return <CcipStatus messageId={payout.messageId} chainSelector={payout.chainSelector} />;
};
