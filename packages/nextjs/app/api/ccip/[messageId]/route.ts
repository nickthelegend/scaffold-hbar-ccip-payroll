import { NextResponse } from "next/server";
import { CCIP_MESSAGE_API, isMessageId, pickCcipMessage } from "~~/utils/payroll/ccip";

const REVALIDATE_SECONDS = 30;

/**
 * Proxies the CCIP explorer's message API, which does not promise CORS for browsers. Responds with the message's
 * status fields, 404 while the explorer has not indexed the message yet, or 502 if the explorer is unreachable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  if (!isMessageId(messageId)) {
    return NextResponse.json(
      { error: "Expected a CCIP message id: 0x followed by 64 hex characters" },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${CCIP_MESSAGE_API}${messageId.toLowerCase()}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch {
    return NextResponse.json({ error: "The CCIP explorer is unreachable" }, { status: 502 });
  }

  const cacheHeaders = { "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=60` };
  if (!response.ok) {
    // The explorer answers an unknown id with HTTP 500 and the text "Message not found".
    const body = await response.text().catch(() => "");
    if (/not found/i.test(body)) {
      return NextResponse.json({ error: "Message not indexed yet" }, { status: 404, headers: cacheHeaders });
    }
    return NextResponse.json({ error: `The CCIP explorer returned ${response.status}` }, { status: 502 });
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(pickCcipMessage(raw), { headers: cacheHeaders });
}
