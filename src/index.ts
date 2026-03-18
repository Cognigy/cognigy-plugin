#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { CognigyApiClient } from './api/client.js';
import { ToolHandlers } from './tools/handlers.js';
import { tools } from './tools/definitions.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { logger } from './utils/logger.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { createAuthProvider } from './auth/createAuthProvider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourceDir = join(__dirname, 'resources');

function loadResource(filename: string): string {
  return readFileSync(join(resourceDir, filename), 'utf-8');
}

const RESOURCE_MAP: Record<string, { name: string; description: string; file: string }> = {
  'cognigy://guide/agent-creation': {
    name: 'Agent Creation Guide',
    description: 'Full workflow for building a Cognigy AI Agent',
    file: 'agent-creation.md',
  },
  'cognigy://guide/llm-providers': {
    name: 'LLM Provider Reference',
    description: 'Valid provider names, model strings, and credential info',
    file: 'llm-providers.md',
  },
  'cognigy://guide/troubleshooting': {
    name: 'Troubleshooting Guide',
    description: 'Common issues, diagnostic steps, and fixes',
    file: 'troubleshooting.md',
  },
  'cognigy://guide/knowledge-setup': {
    name: 'Knowledge Setup Guide',
    description: 'How to add knowledge stores and sources for RAG',
    file: 'knowledge-setup.md',
  },
  'cognigy://guide/tools-setup': {
    name: 'Tools Setup Guide',
    description: 'Available tool types, configuration, and prerequisites',
    file: 'tools-setup.md',
  },
  'cognigy://guide/webchat-setup': {
    name: 'Webchat v3 Setup Guide',
    description: 'Full settings reference, style presets, common recipes, and embedding for Webchat v3 endpoints',
    file: 'webchat-setup.md',
  },
  'cognigy://guide/flow-nodes': {
    name: 'Flow Node Reference',
    description: 'Supported flow node types, config schemas, placement rules, and examples for manage_flow_nodes',
    file: 'flow-nodes.md',
  },
};

async function main() {
  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);
    logger.info('Starting Cognigy MCP Server', {
      name: config.serverName,
      version: config.serverVersion,
      authMode: config.authMode,
    });

    const authProvider = createAuthProvider(config);

    // Initialize API client
    const apiClient = new CognigyApiClient({
      baseUrl: config.apiBaseUrl,
      authProvider,
    });

    // Initialize tool handlers
    const toolHandlers = new ToolHandlers(apiClient, config.endpointBaseUrl, config.webchatBaseUrl);

    // Initialize rate limiter
    logger.info('Starting Cognigy MCP Server', { name: config.serverName, version: config.serverVersion });

    const rateLimiter = new RateLimiter(config.rateLimit);

    const server = new Server(
      { name: config.serverName, version: config.serverVersion },
      {
        capabilities: { tools: {}, resources: {} },
        instructions: SERVER_INSTRUCTIONS,
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info(`Tool call received: ${name}`);

      // Check rate limit
      const rateLimitKey = await authProvider.getRateLimitKey();
      if (!rateLimiter.check(rateLimitKey)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Rate limit exceeded' }) }],
        };
      }

      try {
        const result = await toolHandlers.handleToolCall(name, args || {});
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error: any) {
        logger.error('Tool execution error', { tool: name, error: error.message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: error.message, status: error.status, code: error.code, traceId: error.traceId }),
          }],
          isError: true,
        };
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: Object.entries(RESOURCE_MAP).map(([uri, meta]) => ({
        uri,
        name: meta.name,
        description: meta.description,
        mimeType: 'text/markdown',
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const meta = RESOURCE_MAP[uri];
      if (!meta) throw new Error(`Unknown resource: ${uri}`);
      return {
        contents: [{ uri, mimeType: 'text/markdown', text: loadResource(meta.file) }],
      };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Cognigy MCP Server started successfully', {
      authMode: config.authMode,
      authentication: 'deferred-until-first-api-use',
    });

    const shutdown = async () => {
      logger.info('Shutting down Cognigy MCP Server');
      rateLimiter.destroy();
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error: any) {
    logger.error('Failed to start MCP Server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

const subcommand = process.argv[2];
if (subcommand === 'init') {
  import('./cli/init.js')
    .then(({ runInit }) => runInit(process.argv.slice(2)))
    .catch((error) => {
      console.error(`Error: ${error.message || error}`);
      process.exit(1);
    });
} else {
  main();
}
