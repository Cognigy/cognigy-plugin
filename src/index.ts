#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, loadConfigForEnvironment } from "./config.js";
import { CognigyApiClient } from "./api/client.js";
import { EnvironmentRuntime } from "./environmentRuntime.js";
import { ToolHandlers } from "./tools/handlers.js";
import { handleManageEnvironments } from "./tools/environments.js";
import { tools } from "./tools/definitions.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { logger } from "./utils/logger.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import { getSessionId, getTaskId, runWithTask } from "./utils/actorContext.js";
import { logProxyConfiguration } from "./utils/proxy.js";

async function main() {
  try {
    // Which environment this process talks to, and the client + handlers built
    // for it. It is pinned when the process starts (see environmentRuntime.ts);
    // the tool handlers are replaced, never reused, when the environment changes.
    let bootLogged = false;
    const runtime = new EnvironmentRuntime<{ toolHandlers: ToolHandlers }>({
      loadLegacyConfig: loadConfig,
      configForEnvironment: loadConfigForEnvironment,
      buildParts: (environmentConfig) => {
        // At boot this is logged below, once the log level is known.
        if (bootLogged) logProxyConfiguration(environmentConfig.apiBaseUrl);
        const apiClient = new CognigyApiClient({
          baseUrl: environmentConfig.apiBaseUrl,
          apiKey: environmentConfig.apiKey,
          auditAttribution: environmentConfig.auditAttribution,
        });
        return {
          toolHandlers: new ToolHandlers(
            apiClient,
            environmentConfig.endpointBaseUrl,
            environmentConfig.webchatBaseUrl,
            environmentConfig.staticFilesBaseUrl,
          ),
        };
      },
    });

    const config = runtime.current().config;
    logger.setLevel(config.logLevel);
    logger.info("Starting NiCE Cognigy Plugin", {
      name: config.serverName,
      version: config.serverVersion,
    });
    const boot = runtime.describe();
    // Names and URLs only: never the key.
    logger.info("Cognigy environment", {
      environment: boot.name ?? "plugin credentials",
      apiBaseUrl: boot.apiBaseUrl,
      source: boot.source,
    });
    logProxyConfiguration(config.apiBaseUrl);
    bootLogged = true;

    const rateLimiter = new RateLimiter(config.rateLimit);

    const server = new Server(
      { name: config.serverName, version: config.serverVersion },
      {
        capabilities: { tools: {} },
        instructions: SERVER_INSTRUCTIONS,
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const toolError = (error: any) => {
        logger.error("Tool execution error", {
          tool: name,
          error: error.message,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error.message,
                status: error.status,
                code: error.code,
                traceId: error.traceId,
              }),
            },
          ],
          isError: true,
        };
      };

      // manage_environments only reads or changes which environment this
      // process uses and makes no Cognigy request, so it needs neither the rate
      // limiter nor the current environment's handlers. Every other call is
      // resolved against the environment in effect NOW, so a call that started
      // before a switch finishes on the environment it started with.
      let call: ReturnType<typeof runtime.current> | undefined;
      if (name !== "manage_environments") {
        try {
          call = runtime.current();
        } catch (error: any) {
          return toolError(error);
        }
        const rateLimitKey = call.config.apiKey.substring(0, 10);
        if (!rateLimiter.check(rateLimitKey)) {
          // Logged with the tool name: a rejected call never reaches the
          // `Tool call received` line below, so without this a throttling
          // incident would leave no trace of which tool was being hammered.
          logger.warn(`Tool call rate limited: ${name}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Rate limit exceeded" }),
              },
            ],
          };
        }
      }

      // One task id per tool call, shared by every Cognigy API request the
      // call fans out to, so the audit events of a single tool call group
      // together. Logged so a local log line can be matched to an audit event.
      return runWithTask(async () => {
        logger.info(`Tool call received: ${name}`, {
          taskId: getTaskId(),
          sessionId: getSessionId(),
        });
        try {
          const result = call
            ? await call.parts.toolHandlers.handleToolCall(name, args || {})
            : handleManageEnvironments(args || {}, runtime);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error: any) {
          return toolError(error);
        }
      });
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("NiCE Cognigy Plugin started successfully");

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      // `finally` so a failing close can never strand the process: the guard
      // above means a later signal won't retry, and this runs as an event
      // listener, where a rejection would otherwise be unhandled.
      try {
        logger.info("Shutting down NiCE Cognigy Plugin");
        rateLimiter.destroy();
        await server.close();
      } catch (error: any) {
        logger.error("Error during shutdown", { error: error?.message });
      } finally {
        process.exit(0);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // StdioServerTransport never listens for stdin ending — if the parent
    // (Claude Code, or an `npx` wrapper) tears down the connection by closing
    // the pipes instead of sending a signal, nothing here would otherwise
    // notice. Without this, the RateLimiter's setInterval keeps the event
    // loop alive forever, turning every such disconnect into an orphaned,
    // memory-holding process. Treat stdin ending as a disconnect too.
    process.stdin.on("end", shutdown);
    process.stdin.on("close", shutdown);
  } catch (error: any) {
    logger.error("Failed to start MCP Server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

main();
