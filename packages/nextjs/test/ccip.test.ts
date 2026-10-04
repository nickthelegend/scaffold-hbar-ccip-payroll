import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "~~/app/api/ccip/[messageId]/route";
import { type CcipMessage, ccipStatus, isMessageId, pickCcipMessage } from "~~/utils/payroll/ccip";

const MESSAGE_ID = "0x65f52190fe3c3745b3a9f9f7e3dff0cff893e20820264614420c75e2e6cb8490";

const message = (overrides: Partial<CcipMessage>): CcipMessage => ({
  messageId: MESSAGE_ID,
  state: null,
  sourceNetworkName: "hedera-testnet",
  destNetworkName: "ethereum-testnet-sepolia",
  sendTransactionHash: `0x${"4b".repeat(32)}`,
  sendFinalized: null,
  commitBlockTimestamp: null,
  receiptTransactionHash: null,
  receiptTimestamp: null,
  ...overrides,
});

describe("ccipStatus", () => {
  it("walks a message through finality, commit and execution", () => {
    expect(ccipStatus(null).label).toBe("Not indexed yet");
    expect(ccipStatus(message({})).label).toBe("Waiting for finality");
    expect(ccipStatus(message({ sendFinalized: "2026-10-04T09:30:48" })).label).toBe("Finalized");
    expect(
      ccipStatus(message({ sendFinalized: "2026-10-04T09:30:48", commitBlockTimestamp: "2026-10-04T09:31:16" })).label,
    ).toBe("Committed");
    expect(ccipStatus(message({ state: 2, receiptTransactionHash: `0x${"1b".repeat(32)}` }))).toMatchObject({
      label: "Success",
      final: true,
    });
  });

  it("reports a destination execution failure, which can still be retried manually", () => {
    expect(ccipStatus(message({ state: 3 }))).toMatchObject({ label: "Failed", tone: "error", final: false });
  });
});

describe("pickCcipMessage", () => {
  it("keeps only the status fields and fills missing ones with null", () => {
    const picked = pickCcipMessage({ messageId: MESSAGE_ID, state: 2, infoRaw: "{...}", votes: null });
    expect(picked).toMatchObject({ messageId: MESSAGE_ID, state: 2, receiptTransactionHash: null });
    expect(picked).not.toHaveProperty("infoRaw");
  });
});

describe("isMessageId", () => {
  it("accepts 32-byte hex ids only", () => {
    expect(isMessageId(MESSAGE_ID)).toBe(true);
    expect(isMessageId(MESSAGE_ID.slice(0, -1))).toBe(false);
    expect(isMessageId("../../etc/passwd")).toBe(false);
  });
});

describe("GET /api/ccip/[messageId]", () => {
  afterEach(() => vi.unstubAllGlobals());

  const call = (messageId: string) => GET(new Request("http://test"), { params: Promise.resolve({ messageId }) });

  it("rejects malformed ids without calling the explorer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("0x1234")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the status fields of a known message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ messageId: MESSAGE_ID, state: 3, infoRaw: "{}" })),
    );
    const response = await call(MESSAGE_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ messageId: MESSAGE_ID, state: 3, receiptTransactionHash: null });
  });

  it("maps the explorer's 'Message not found' 500 to a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Message not found", { status: 500 })),
    );
    expect((await call(MESSAGE_ID)).status).toBe(404);
  });

  it("reports other explorer failures as 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 503 })),
    );
    expect((await call(MESSAGE_ID)).status).toBe(502);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect((await call(MESSAGE_ID)).status).toBe(502);
  });
});
