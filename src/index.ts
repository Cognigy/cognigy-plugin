#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import {
  buildRuntime,
  Environments,
  tagWithEnvironment,
  withEnvironmentField,
  type ResolvedEnvironment,
} from "./environments.js";
import { tools } from "./tools/definitions.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { logger } from "./utils/logger.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import { getSessionId, getTaskId, runWithTask } from "./utils/actorContext.js";

function errorResult(error: any, environment?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...(environment ? { _environment: environment } : {}),
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

async function main() {
  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);
    logger.info("Starting NiCE Cognigy Plugin", {
      name: config.serverName,
      version: config.serverVersion,
    });

    // The plugin's own credentials are the `default` environment; extra ones
    // come from ~/.cognigy-plugin/environments.json (see environments.ts).
    const environments = new Environments(buildRuntime(config));
    const extra = environments.names();
    if (extra.length > 0) {
      logger.info("Extra Cognigy environments configured", {
        environments: extra,
      });
    }
    const rateLimiter = new RateLimiter(config.rateLimit);

    const server = new Server(
      { name: config.serverName, version: config.serverVersion },
      {
        capabilities: { tools: {} },
        // COGNIGY_DEV_NOTICE is set only by scripts/dev-engine.mjs (local dev).
        instructions: process.env.COGNIGY_DEV_NOTICE
          ? `${process.env.COGNIGY_DEV_NOTICE}\n\n${SERVER_INSTRUCTIONS}`
          : SERVER_INSTRUCTIONS,
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: withEnvironmentField(tools, environments.names()),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // `environment` is ours, not the tool's: take it off before dispatch.
      const { environment, ...toolArgs } = (args ?? {}) as Record<
        string,
        unknown
      >;
      let target: ResolvedEnvironment;
      try {
        target = environments.resolve(environment);
      } catch (error: any) {
        logger.warn(`Tool call without a usable environment: ${name}`, {
          error: error.message,
        });
        return errorResult(error);
      }
      const tag = target.multiple ? target.name : undefined;

      const rateLimitKey = target.runtime.config.apiKey.substring(0, 10);
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

      // One task id per tool call, shared by every Cognigy API request the
      // call fans out to, so the audit events of a single tool call group
      // together. Logged so a local log line can be matched to an audit event.
      return runWithTask(async () => {
        logger.info(`Tool call received: ${name}`, {
          taskId: getTaskId(),
          sessionId: getSessionId(),
          ...(tag ? { environment: tag } : {}),
        });
        try {
          const result = await target.runtime.toolHandlers.handleToolCall(
            name,
            toolArgs,
          );
          const tagged = tag ? tagWithEnvironment(result, tag) : result;
          return {
            content: [{ type: "text" as const, text: JSON.stringify(tagged) }],
          };
        } catch (error: any) {
          logger.error("Tool execution error", {
            tool: name,
            error: error.message,
          });
          return errorResult(error, tag);
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
