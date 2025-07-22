#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setupResourceHandlers } from "./handlers/resources.js";
import { setupToolHandlers } from "./handlers/tools.js";
import { startHttpServer } from "./server.js";

const server = new Server(
  {
    name: "example-servers/postgres",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Setup all handlers
setupResourceHandlers(server);
setupToolHandlers(server);

async function runServer(): Promise<void> {
  const isHttpMode = process.env.MCP_HTTP_MODE === 'true' || process.argv.includes('--http');
  
  if (isHttpMode) {
    startHttpServer(server);
  } else {
    // CLI/stdio mode
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

runServer().catch(console.error);