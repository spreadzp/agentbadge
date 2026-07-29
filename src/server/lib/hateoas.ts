/**
 * SLICE-17-7: HATEOAS link builders
 *
 * Generates `_links` objects for API responses so agents can navigate
 * the workflow without hardcoding URLs.
 */

export interface Link {
  href: string;
  method?: "GET" | "POST";
}

export function passportLinks(tokenId: string, serial: number): Record<string, Link> {
  return {
    self: { href: `/passport/${tokenId}/${serial}` },
    did_document: { href: `/did/did:hcs:${tokenId}:${serial}` },
    audit: { href: `/audit/${tokenId}/${serial}` },
    upgrade: { href: `/passport/${tokenId}/${serial}/upgrade`, method: "POST" },
  };
}

export function agentLinks(did: string): Record<string, Link> {
  const encoded = encodeURIComponent(did);
  return {
    self: { href: `/agents/${encoded}` },
    did_document: { href: `/did/${encoded}` },
    a2a_send: { href: "/a2a/send", method: "POST" },
  };
}

export function taskLinks(taskId: string, posterDid: string, status: string): Record<string, Link> {
  const links: Record<string, Link> = {
    self: { href: `/market/tasks/${taskId}` },
    poster: { href: `/agents/${encodeURIComponent(posterDid)}` },
  };
  if (status === "posted") {
    links.claim = { href: `/market/tasks/${taskId}/claim`, method: "POST" };
  }
  if (status === "claimed") {
    links.deliver = { href: `/market/tasks/${taskId}/deliver`, method: "POST" };
  }
  if (status === "delivered") {
    links.complete = { href: `/market/tasks/${taskId}/complete`, method: "POST" };
  }
  return links;
}
