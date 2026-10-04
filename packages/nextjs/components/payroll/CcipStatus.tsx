"use client";

import { Skeleton } from "./ui";
import { useCcipMessage } from "~~/hooks/payroll";
import { type CcipStatus as Status, ccipMessageUrl, ccipStatus } from "~~/utils/payroll/ccip";
import { destinationTxUrl } from "~~/utils/payroll/chains";
import { shortHex } from "~~/utils/payroll/units";

const TONE: Record<Status["tone"], string> = {
  neutral: "badge-ghost",
  info: "badge-info",
  success: "badge-success",
  error: "badge-error",
};

/** Live CCIP delivery status of one message: explorer link, stage badge and the destination transaction. */
export const CcipStatus = ({ messageId, chainSelector }: { messageId: string; chainSelector: bigint }) => {
  const { data: message, isLoading, isError, refetch } = useCcipMessage(messageId);
  const status = message !== undefined ? ccipStatus(message) : undefined;
  const receiptUrl = message?.receiptTransactionHash
    ? destinationTxUrl(chainSelector, message.receiptTransactionHash)
    : undefined;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <a className="link font-mono text-xs" href={ccipMessageUrl(messageId)} target="_blank" rel="noreferrer">
        CCIP {shortHex(messageId, 6)}
      </a>
      {isLoading ? (
        <Skeleton className="h-5 w-20" label="Loading CCIP status" />
      ) : status ? (
        <span className={`badge badge-sm ${TONE[status.tone]}`} title={status.description}>
          {status.label}
        </span>
      ) : (
        isError && (
          <button type="button" className="badge badge-sm badge-warning cursor-pointer" onClick={() => refetch()}>
            Status unavailable · retry
          </button>
        )
      )}
      {receiptUrl && (
        <a className="link text-xs" href={receiptUrl} target="_blank" rel="noreferrer">
          destination tx
        </a>
      )}
    </span>
  );
};
