import { describe, it, expect } from "bun:test";
import { DataHubLinks } from "../../src/views/marketplace-fragment";

describe("DataHubLinks", () => {
  it("returns empty string when no datasetUrn", () => {
    const result = DataHubLinks(undefined).toString();
    expect(result).toBe("");
  });

  it("returns empty string when datasetUrn is empty", () => {
    const result = DataHubLinks("").toString();
    expect(result).toBe("");
  });

  it("renders DataHub Catalog heading when URN present", () => {
    const result = DataHubLinks("urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)").toString();
    expect(result).toContain("DataHub Catalog");
  });

  it("shows dataset URN in output", () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)";
    const result = DataHubLinks(urn).toString();
    expect(result).toContain(urn);
  });

  it("includes dataset link with correct URL", () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)";
    const result = DataHubLinks(urn).toString();
    const encoded = encodeURIComponent(urn);
    expect(result).toContain(`/dataset/${encoded}`);
  });

  it("includes lineage link with correct URL", () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)";
    const result = DataHubLinks(urn).toString();
    const encoded = encodeURIComponent(urn);
    expect(result).toContain(`/lineage/${encoded}`);
  });

  it("includes glossary link", () => {
    const result = DataHubLinks("urn:li:dataset:test").toString();
    expect(result).toContain("/glossary");
  });

  it("includes assertions link", () => {
    const result = DataHubLinks("urn:li:dataset:test").toString();
    expect(result).toContain("/assertions");
  });

  it("all links open in new tab", () => {
    const result = DataHubLinks("urn:li:dataset:test").toString();
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
  });

  it("uses DATAHUB_UI_URL env var when set", () => {
    const original = process.env.DATAHUB_UI_URL;
    process.env.DATAHUB_UI_URL = "http://datahub.example.com";
    const result = DataHubLinks("urn:li:dataset:test").toString();
    expect(result).toContain("datahub.example.com");
    process.env.DATAHUB_UI_URL = original;
  });

  it("defaults to localhost:9002 when env var not set", () => {
    const original = process.env.DATAHUB_UI_URL;
    delete process.env.DATAHUB_UI_URL;
    const result = DataHubLinks("urn:li:dataset:test").toString();
    expect(result).toContain("localhost:9002");
    process.env.DATAHUB_UI_URL = original;
  });
});
