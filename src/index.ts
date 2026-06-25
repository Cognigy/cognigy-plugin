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

async function main() {
  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);
    logger.info("Starting Cognigy Platform MCP", {
      name: config.serverName,
      version: config.serverVersion,
    });

    const apiClient = new CognigyApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
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
      logger.info(`Tool call received: ${name}`);

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

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Cognigy Platform MCP started successfully");

    const shutdown = async () => {
      logger.info("Shutting down Cognigy Platform MCP");
      rateLimiter.destroy();
      await server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error: any) {
    logger.error("Failed to start MCP Server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

main();
