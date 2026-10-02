import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyHubSpotAppRequest, uninstallHubSpotApp } from "../src";
test("app context is bound to signed URL and expected app, rejects duplicate identities", async () => {
  const check = (url: string, appId = "3") => {
    const timestamp = String(Date.now());
    return verifyHubSpotAppRequest({
      url,
      appId,
      method: "POST",
      rawBody: "{}",
      secret: "secret",
      headers: {
        "x-hubspot-request-timestamp": timestamp,
        "x-hubspot-signature-v3": createHmac("sha256", "secret")
          .update(`POST${url}{}${timestamp}`)
          .digest("base64"),
      },
    });
  };
  const url = "https://app.test/card?appId=3&portalId=4&userId=5";
  expect(await check(url)).toEqual({ appId: "3", portalId: "4", userId: "5" });
  expect(await check(url, "9")).toBeNull();
  expect(await check(url + "&userId=6")).toBeNull();
});
test("uninstall requires success and uses bearer without leaking token in URL", async () => {
  await uninstallHubSpotApp({
    accessToken: "token",
    fetch: (async (url, init) => {
      expect(String(url)).toBe(
        "https://api.hubapi.com/appinstalls/2026-09/external-install",
      );
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer token",
      );
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });
  await expect(
    uninstallHubSpotApp({
      accessToken: "token",
      fetch: (async () => new Response(null, { status: 401 })) as typeof fetch,
    }),
  ).rejects.toThrow("401");
});
