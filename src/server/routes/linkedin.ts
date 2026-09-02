/**
 * LinkedIn OAuth callback route (EPIC-83 SLICE-83-3).
 *
 * Hardened: token goes to HttpOnly+Secure cookie, never in response body or logs.
 * Extracted from index.ts per layering convention.
 */

import { Hono } from "hono";
import { logger } from "@agentgate-hedera/passport";

export const linkedinRoutes = new Hono();

linkedinRoutes.get("/linkedin/callback", async (c) => {
  const authCode = c.req.query("code");
  const error = c.req.query("error");

  if (error) {
    logger.warn("LinkedIn OAuth error callback", { error });
    return c.json({ ok: false, error: `LinkedIn OAuth error: ${error}` }, 400);
  }

  if (!authCode) {
    return c.json({ ok: false, error: "Missing 'code' query parameter" }, 400);
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 3000}/linkedin/callback`;

  if (!clientId || !clientSecret) {
    logger.error("LinkedIn OAuth missing env config", {});
    return c.json({ ok: false, error: "LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET not set" }, 500);
  }

  try {
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = (await tokenRes.json()) as Record<string, unknown>;

    if (!tokenRes.ok) {
      logger.warn("LinkedIn OAuth token exchange failed", { status: tokenRes.status });
      return c.json({ ok: false, error: "Token exchange failed" }, 502);
    }

    const accessToken = tokenData.access_token as string;
    const expiresIn = (tokenData.expires_in as number) ?? 5184000;

    // Set HttpOnly + Secure + SameSite=Lax cookie — token never in response body
    c.header(
      "Set-Cookie",
      `li_token=${accessToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=${expiresIn}; Path=/`,
    );

    logger.info("LinkedIn OAuth success", { expiresIn });

    return c.json({
      ok: true,
      message: "Authorization successful! You can close this tab.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("LinkedIn OAuth exception", { error: msg });
    return c.json({ ok: false, error: "OAuth callback failed" }, 500);
  }
});
