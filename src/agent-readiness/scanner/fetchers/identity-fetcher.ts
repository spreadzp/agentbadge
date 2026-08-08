export interface IdentityResult {
  source: "identity";
  data: {
    webfinger: boolean;
    hostMeta: boolean;
    did: boolean;
    appleAppLinks: boolean;
    androidAssetLinks: boolean;
    oauthAuthorizationServer: boolean;
  };
}

type FetchFn = typeof fetch;

export async function fetchIdentity(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<IdentityResult> {
  const _fetch = fetchFn ?? fetch;

  const endpoints = [
    { key: "webfinger", path: "/.well-known/webfinger" },
    { key: "hostMeta", path: "/.well-known/host-meta" },
    { key: "did", path: "/.well-known/did.json" },
    { key: "appleAppLinks", path: "/.well-known/apple-app-site-association" },
    { key: "androidAssetLinks", path: "/.well-known/assetlinks.json" },
    { key: "oauthAuthorizationServer", path: "/.well-known/oauth-authorization-server" },
  ] as const;

  const results = await Promise.all(
    endpoints.map(async (ep) => {
      try {
        const resp = await _fetch(`${baseUrl}${ep.path}`);
        return { key: ep.key, present: resp.ok };
      } catch {
        return { key: ep.key, present: false };
      }
    }),
  );

  const data: IdentityResult["data"] = {
    webfinger: false,
    hostMeta: false,
    did: false,
    appleAppLinks: false,
    androidAssetLinks: false,
    oauthAuthorizationServer: false,
  };

  for (const r of results) {
    (data as Record<string, boolean>)[r.key] = r.present;
  }

  return { source: "identity", data };
}
