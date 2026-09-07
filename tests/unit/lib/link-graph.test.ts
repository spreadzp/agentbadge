import { describe, it, expect } from "vitest";
import { buildLinkGraph } from "../../../src/server/lib/link-graph";

describe("SLICE-113-7: Link graph endpoint", () => {
  const graph = buildLinkGraph();

  it("returns nodes for all public pages", () => {
    const nodeUrls = graph.nodes.map((n) => n.url);
    expect(nodeUrls).toContain("/");
    expect(nodeUrls).toContain("/blog");
    expect(nodeUrls).toContain("/faq");
    expect(nodeUrls).toContain("/about");
    expect(nodeUrls).toContain("/pricing");
  });

  it("returns nodes with correct types", () => {
    const home = graph.nodes.find((n) => n.url === "/");
    expect(home?.type).toBe("homepage");

    const blog = graph.nodes.find((n) => n.url === "/blog");
    expect(blog?.type).toBe("blog");

    const article = graph.nodes.find((n) => n.url === "/blog/what-is-agent-readiness");
    expect(article?.type).toBe("blog-article");
  });

  it("returns edges with correct relationship types", () => {
    const relationships = graph.edges.map((e) => e.relationship);
    expect(relationships).toContain("navigation");
    expect(relationships).toContain("contextual");
    expect(relationships).toContain("breadcrumb");
  });

  it("blog articles have related edges", () => {
    const relatedEdges = graph.edges.filter((e) => e.relationship === "related");
    expect(relatedEdges.length).toBeGreaterThan(0);
    const articleRelated = relatedEdges.filter((e) => e.from.startsWith("/blog/"));
    expect(articleRelated.length).toBeGreaterThan(0);
  });

  it("blog articles have breadcrumb edges to /blog", () => {
    const breadcrumbEdges = graph.edges.filter(
      (e) => e.relationship === "breadcrumb" && e.from.startsWith("/blog/") && e.to === "/blog",
    );
    expect(breadcrumbEdges.length).toBeGreaterThan(0);
  });

  it("rule pages have breadcrumb edges to /rules", () => {
    const ruleBreadcrumbs = graph.edges.filter(
      (e) => e.relationship === "breadcrumb" && e.from.startsWith("/rules/") && e.to === "/rules",
    );
    expect(ruleBreadcrumbs.length).toBeGreaterThan(0);
  });
});
