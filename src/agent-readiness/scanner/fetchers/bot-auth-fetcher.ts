export interface BotAuthResult {
  source: "bot-auth";
  data: {
    found: boolean;
    members: Array<{ name: string; publicKeyUrl: string }>;
    publicKeysReachable: boolean;
  };
}

type FetchFn = typeof fetch;

export async function fetchBotAuth(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<BotAuthResult> {
  const _fetch = fetchFn ?? fetch;
  const url = `${baseUrl}/.well-known/http-message-signatures-directory`;

  const empty: BotAuthResult = {
    source: "bot-auth",
    data: { found: false, members: [], publicKeysReachable: false },
  };

  try {
    const resp = await _fetch(url);
    if (!resp.ok) return empty;

    const dir = await resp.json();
    const members: Array<{ name: string; publicKeyUrl: string }> = (dir.members ?? [])
      .filter((m: any) => m.name && m.publicKeyUrl);

    // Verify public keys are reachable
    let publicKeysReachable = members.length > 0;
    for (const m of members) {
      try {
        const keyResp = await _fetch(m.publicKeyUrl);
        if (!keyResp.ok) {
          publicKeysReachable = false;
          break;
        }
      } catch {
        publicKeysReachable = false;
        break;
      }
    }

    return {
      source: "bot-auth",
      data: { found: true, members, publicKeysReachable },
    };
  } catch {
    return empty;
  }
}
