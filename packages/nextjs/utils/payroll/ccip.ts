import type { Hex } from "viem";

/** The CCIP explorer's public message API (no key, but no CORS guarantee either, so the app proxies it). */
export const CCIP_MESSAGE_API = "https://ccip.chain.link/api/h/atlas/message/";

export const ccipMessageUrl = (messageId: string) => `https://ccip.chain.link/msg/${messageId}`;
export const ccipAddressUrl = (address: string) => `https://ccip.chain.link/address/${address}`;

export const isMessageId = (value: string): value is Hex => /^0x[0-9a-fA-F]{64}$/.test(value);

/** Execution state on the destination OffRamp (`Internal.MessageExecutionState`); null until executed. */
export const EXECUTION_STATE = { UNTOUCHED: 0, IN_PROGRESS: 1, SUCCESS: 2, FAILURE: 3 } as const;

/** The subset of the CCIP explorer's message record the app uses. */
export type CcipMessage = {
  messageId: Hex;
  state: number | null;
  sourceNetworkName: string | null;
  destNetworkName: string | null;
  sendTransactionHash: Hex | null;
  sendFinalized: string | null;
  commitBlockTimestamp: string | null;
  receiptTransactionHash: Hex | null;
  receiptTimestamp: string | null;
};

const FIELDS = [
  "messageId",
  "state",
  "sourceNetworkName",
  "destNetworkName",
  "sendTransactionHash",
  "sendFinalized",
  "commitBlockTimestamp",
  "receiptTransactionHash",
  "receiptTimestamp",
] as const satisfies readonly (keyof CcipMessage)[];

/** Keeps the fields the app needs from the explorer's (much larger) record, defaulting missing ones to null. */
export function pickCcipMessage(raw: Record<string, unknown>): CcipMessage {
  const message = Object.fromEntries(FIELDS.map(field => [field, raw[field] ?? null]));
  return message as CcipMessage;
}

export type CcipStatus = {
  label: string;
  tone: "neutral" | "info" | "success" | "error";
  description: string;
  /** No further change is expected, so polling can stop. */
  final: boolean;
};

/** Maps a CCIP message (or null when the explorer has not indexed it yet) to the stage it is in. */
export function ccipStatus(message: CcipMessage | null): CcipStatus {
  if (!message) {
    return {
      label: "Not indexed yet",
      tone: "neutral",
      description: "The CCIP explorer picks messages up a few seconds after they are sent.",
      final: false,
    };
  }
  switch (message.state) {
    case EXECUTION_STATE.SUCCESS:
      return {
        label: "Success",
        tone: "success",
        description: "Tokens delivered on the destination chain.",
        final: true,
      };
    case EXECUTION_STATE.FAILURE:
      return {
        label: "Failed",
        tone: "error",
        description: "Execution failed on the destination chain. It can be retried manually from the CCIP explorer.",
        final: false,
      };
    case EXECUTION_STATE.IN_PROGRESS:
      return { label: "Executing", tone: "info", description: "Executing on the destination chain.", final: false };
  }
  if (message.commitBlockTimestamp) {
    return {
      label: "Committed",
      tone: "info",
      description: "Committed on the destination chain, waiting for execution.",
      final: false,
    };
  }
  if (message.sendFinalized) {
    return {
      label: "Finalized",
      tone: "info",
      description: "Final on Hedera, waiting for the commit on the destination chain.",
      final: false,
    };
  }
  return {
    label: "Waiting for finality",
    tone: "neutral",
    description: "Sent from Hedera, waiting for source-chain finality.",
    final: false,
  };
}
