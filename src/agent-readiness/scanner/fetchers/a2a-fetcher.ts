export interface A2AResult {
  source: "a2a";
  data: {
    found: boolean;
    valid: boolean;
    name: string | null;
    description: string | null;
    url: string | null;
    version: string | null;
    capabilities: unknown | null;
  };
}

type FetchFn = typeof fetch;

export async function fetchA2A(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<A2AResult> {
  const _fetch = fetchFn ?? fetch;
  const url = `${baseUrl}/.well-known/agent-card.json`;

  const empty: A2AResult = {
    source: "a2a",
    data: {
      found: false,
      valid: false,
      name: null,
      description: null,
      url: null,
      version: null,
      capabilities: null,
    },
  };

  try {
    const resp = await _fetch(url);
    if (!resp.ok) return empty;

    const card = await resp.json();
    const valid = !!(
      card.name &&
      card.description &&
      card.url &&
      card.version &&
      card.capabilities
    );

    return {
      source: "a2a",
      data: {
        found: true,
        valid,
        name: card.name ?? null,
        description: card.description ?? null,
        url: card.url ?? null,
        version: card.version ?? null,
        capabilities: card.capabilities ?? null,
      },
    };
  } catch {
    return empty;
  }
}
