import { NextResponse, type NextRequest } from "next/server";
import { resolveReferralCode } from "@/lib/referrals/actions";

/**
 * A referral link.
 *
 * A route handler rather than a page because it has one job — leave a touch on
 * the visitor's own device and send them on — and because only a route handler
 * or a server action may write a cookie.
 *
 * It runs for signed-out visitors and reads nothing. No lookup, no validation
 * against the database, no row written anywhere. That is deliberate: a public
 * endpoint that could tell a valid code from an invalid one is an enumeration
 * oracle, and one that resolved a code to its owner would disclose the
 * referrer to anybody holding a link. Whether the string means anything is
 * decided later, by `attribute_referral`, for a caller whose identity is
 * verified.
 *
 * It is also why no referral table grants `anon` a single privilege.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  await resolveReferralCode(token);

  // Signup, not the landing page: the link's purpose is to bring someone in,
  // and the touch is only worth anything if an account follows.
  return NextResponse.redirect(new URL("/signup", request.url));
}
