import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { databaseState, initializeDatabase, getDatabaseUrl } from "./database.js";
import { parsePermissions, validateSecret } from "./utils/permissions.js";
import { Permission, TransportInfo } from "./types.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Store active transports for cleanup
const activeTransports = new Map<string, SSEServerTransport>();
const transportPermissions = new Map<string, Permission[]>();
const transportDatabaseUrls = new Map<string, string>();

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse, server: Server) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  
  // Extract query parameters
  const queryParams = url.searchParams;
  
  // Validate secret for SSE endpoint only (message endpoint is protected by session ID)
  if (req.method !== 'OPTIONS' && url.pathname !== '/health' && url.pathname !== '/message') {
    try {
      if (!validateSecret(queryParams)) {
        res.writeHead(401, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'Invalid or missing secret' }));
        return;
      }
    } catch (error: unknown) {
      res.writeHead(500, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: getErrorMessage(error) }));
      return;
    }
  }
  
  // Handle message posting first (doesn't need database URL extraction)
  if (req.method === 'POST' && url.pathname === '/message') {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Find the appropriate transport by session ID if provided
    const sessionId = url.searchParams.get('sessionId');
    if (sessionId) {
      for (const [transportId, transport] of activeTransports.entries()) {
        if (transport.sessionId === sessionId) {
          // Update currentPermissions and database connection for this specific transport
          const storedPermissions = transportPermissions.get(transportId);
          const storedDatabaseUrl = transportDatabaseUrls.get(transportId);
          if (storedPermissions) {
            databaseState.currentPermissions = storedPermissions;
          }
          if (storedDatabaseUrl) {
            initializeDatabase(storedDatabaseUrl);
          }
          await transport.handlePostMessage(req, res);
          return;
        }
      }
    }
    
    // If sessionId was provided but not found, return error
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid session ID' }));
      return;
    }
    
    // If no session ID provided, try the first available transport as fallback
    const transports = Array.from(activeTransports.entries());
    if (transports.length > 0) {
      const [transportId, transport] = transports[0];
      // Update currentPermissions and database connection for this specific transport
      const storedPermissions = transportPermissions.get(transportId);
      const storedDatabaseUrl = transportDatabaseUrls.get(transportId);
      if (storedPermissions) {
        databaseState.currentPermissions = storedPermissions;
      }
      if (storedDatabaseUrl) {
        initializeDatabase(storedDatabaseUrl);
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No active MCP session found' }));
    return;
  }
  
  // For all other endpoints, extract database URL and permissions from query parameters
  let databaseUrl: string;
  let permissions: Permission[];
  
  try {
    databaseUrl = getDatabaseUrl(queryParams);
    permissions = parsePermissions(queryParams);
    initializeDatabase(databaseUrl);
    databaseState.currentPermissions = permissions;
  } catch (error: unknown) {
    res.writeHead(400, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: getErrorMessage(error) }));
    return;
  }
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }
  
  // Handle MCP over SSE
  if (req.method === 'GET' && url.pathname === '/sse') {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Ensure we have database URL and permissions (should be extracted above)
    if (!databaseUrl || !permissions) {
      res.writeHead(400, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'Database URL and permissions required for SSE connection' }));
      return;
    }
    
    const transport = new SSEServerTransport('/message', res);
    const transportId = Math.random().toString(36).substring(2, 11);
    activeTransports.set(transportId, transport);
    transportPermissions.set(transportId, permissions);
    transportDatabaseUrls.set(transportId, databaseUrl);
    
    transport.onclose = () => {
      activeTransports.delete(transportId);
      transportPermissions.delete(transportId);
      transportDatabaseUrls.delete(transportId);
    };
    
    await server.connect(transport);
    return;
  }
  
  // Health check endpoint
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ 
      status: 'ok', 
      hasDatabase: !!databaseState.pool,
      activeConnections: activeTransports.size,
      secretRequired: !!process.env.MCP_SECRET
    }));
    return;
  }
  
  // Default response
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function startHttpServer(server: Server): void {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const httpServer = createServer((req, res) => handleHttpRequest(req, res, server));
  
  httpServer.listen(port, () => {
    console.log(`MCP HTTP server running at http://localhost:${port}`);
    console.log(`SSE endpoint: http://localhost:${port}/sse`);
    console.log(`Health check: http://localhost:${port}/health`);
    if (process.env.DATABASE_URL) {
      console.log('Using DATABASE_URL environment variable');
    } else {
      console.log('Database URL should be provided via query parameter ?db=...');
    }
  });
}