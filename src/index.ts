#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { CognigyApiClient } from "./api/client.js";
import { ToolHandlers } from "./tools/handlers.js";
import { tools } from "./tools/definitions.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { logger } from "./utils/logger.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import { getSessionId, getTaskId, runWithTask } from "./utils/actorContext.js";

async function main() {
  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);
    logger.info("Starting NiCE Cognigy Plugin", {
      name: config.serverName,
      version: config.serverVersion,
    });

    const apiClient = new CognigyApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      auditAttribution: config.auditAttribution,
    });
    const toolHandlers = new ToolHandlers(
      apiClient,
      config.endpointBaseUrl,
      config.webchatBaseUrl,
      config.staticFilesBaseUrl,
    );
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

      const rateLimitKey = config.apiKey.substring(0, 10);
      if (!rateLimiter.check(rateLimitKey)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Rate limit exceeded" }),
            },
          ],
        };
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
          const result = await toolHandlers.handleToolCall(name, args || {});
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error: any) {
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
