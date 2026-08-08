import { describe, it, expect } from "vitest";
import { checkTypeEnum, categoryEnum, fixTypeEnum } from "../src/agent-readiness/shared.schema";

describe("Schema extensions", () => {
  it("has http_probe check type", () => {
    expect(checkTypeEnum.options).toContain("http_probe");
  });

  it("has content_parse check type", () => {
    expect(checkTypeEnum.options).toContain("content_parse");
  });

  it("has json_rpc check type", () => {
    expect(checkTypeEnum.options).toContain("json_rpc");
  });

  it("has header_check check type", () => {
    expect(checkTypeEnum.options).toContain("header_check");
  });

  it("has content_negotiation category", () => {
    expect(categoryEnum.options).toContain("content_negotiation");
  });

  it("has payments category", () => {
    expect(categoryEnum.options).toContain("payments");
  });

  it("has bazaar category", () => {
    expect(categoryEnum.options).toContain("bazaar");
  });

  it("has openapi category", () => {
    expect(categoryEnum.options).toContain("openapi");
  });

  it("has skills category", () => {
    expect(categoryEnum.options).toContain("skills");
  });

  it("has webmcp category", () => {
    expect(categoryEnum.options).toContain("webmcp");
  });

  it("has agents_txt category", () => {
    expect(categoryEnum.options).toContain("agents_txt");
  });

  it("has identity category", () => {
    expect(categoryEnum.options).toContain("identity");
  });

  it("has bot_auth category", () => {
    expect(categoryEnum.options).toContain("bot_auth");
  });

  it("fixTypeEnum has deterministic", () => {
    expect(fixTypeEnum.options).toContain("deterministic");
  });

  it("fixTypeEnum has assisted", () => {
    expect(fixTypeEnum.options).toContain("assisted");
  });

  it("fixTypeEnum has none", () => {
    expect(fixTypeEnum.options).toContain("none");
  });
});
