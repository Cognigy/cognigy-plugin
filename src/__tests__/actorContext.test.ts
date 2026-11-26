/**
 * Tests for audit-event actor attribution (the X-AI-Assist-Context header, and
 * the legacy X-Ask-AI-Context one, that the Cognigy platform maps onto
 * auditEvent.performedBy).
 */
import { createServer, Server } from "http";
import { AddressInfo } from "net";

import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";

import { CognigyApiClient } from "../api/client.js";
import {
  getActorContextHeaders,
  getSessionId,
  getTaskId,
  runWithTask,
} from "../utils/actorContext.js";

describe("actor context", () => {
  it("claims nothing outside a tool call", () => {
    expect(getTaskId()).toBeUndefined();
    expect(getActorContextHeaders()).toBeUndefined();
  });

  it("declares 'agent-plugin' and legacy 'mcp-plugin' with a taskId and sessionId inside a task", async () => {
    await runWithTask(async () => {
      const headers = getActorContextHeaders();
      expect(headers).toBeDefined();
      // The platform reads the actor from `type`, not `actor`, and refuses a
      // non-string taskId — both are load-bearing. 2026.22.0+ reads only the
      // new header, 2026.17.0–2026.21.x only the legacy one.
      const ids = { taskId: getTaskId(), sessionId: getSessionId() };
      expect(JSON.parse(headers!["X-AI-Assist-Context"])).toEqual({
        type: "agent-plugin",
        ...ids,
      });
      expect(JSON.parse(headers!["X-Ask-AI-Context"])).toEqual({
        type: "mcp-plugin",
        ...ids,
      });
      expect(typeof getTaskId()).toBe("string");
    });
  });

  it("gives concurrent tool calls distinct taskIds but one sessionId", async () => {
    const collect = () =>
      runWithTask(async () => {
        // Yield so the two tasks genuinely interleave.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return JSON.parse(getActorContextHeaders()!["X-AI-Assist-Context"]);
      });

    const [first, second] = await Promise.all([collect(), collect()]);

    expect(first.taskId).not.toBe(second.taskId);
    expect(first.sessionId).toBe(second.sessionId);
  });
});

describe("CognigyApiClient audit attribution", () => {
  let server: Server;
  let baseUrl: string;
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastHeaders = request.headers;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ items: [], total: 0 }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const headerFrom = () => lastHeaders["x-ai-assist-context"];
  const legacyHeaderFrom = () => lastHeaders["x-ask-ai-context"];

  it("sends the actor context on requests made inside a tool call", async () => {
    const client = new CognigyApiClient({ baseUrl, apiKey: "test-key" });

    await runWithTask(() => client.get("/v2.0/projects"));

    expect(JSON.parse(headerFrom() as string)).toMatchObject({
      type: "agent-plugin",
    });
    expect(JSON.parse(legacyHeaderFrom() as string)).toMatchObject({
      type: "mcp-plugin",
    });
    expect(lastHeaders["x-api-key"]).toBe("test-key");
  });

  it("omits the actor context outside a tool call", async () => {
    const client = new CognigyApiClient({ baseUrl, apiKey: "test-key" });

    await client.get("/v2.0/projects");

    expect(headerFrom()).toBeUndefined();
    expect(legacyHeaderFrom()).toBeUndefined();
  });

  it("omits the actor context when attribution is disabled", async () => {
    const client = new CognigyApiClient({
      baseUrl,
      apiKey: "test-key",
      auditAttribution: false,
    });

    await runWithTask(() => client.get("/v2.0/projects"));

    expect(headerFrom()).toBeUndefined();
    expect(legacyHeaderFrom()).toBeUndefined();
  });

  it("attributes file uploads too", async () => {
    const client = new CognigyApiClient({ baseUrl, apiKey: "test-key" });

    await runWithTask(() =>
      client.uploadFile(
        "/v2.0/knowledgestores/upload",
        Buffer.from("hello"),
        "hello.txt",
      ),
    );

    expect(JSON.parse(headerFrom() as string)).toMatchObject({
      type: "agent-plugin",
    });
  });
});
