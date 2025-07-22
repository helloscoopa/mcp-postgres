#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pkg from "pg";
const { Pool } = pkg;
import type { Pool as PoolType } from "pg";


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

let pool: PoolType | null = null;
let resourceBaseUrl: URL | null = null;
let currentDatabaseUrl: string | null = null;

type Permission = 'read' | 'ddl' | 'dml';
let currentPermissions: Permission[] = ['read'];

function initializeDatabase(databaseUrl: string) {
  if (currentDatabaseUrl === databaseUrl && pool) {
    return;
  }
  
  if (pool) {
    pool.end();
  }
  
  pool = new Pool({
    connectionString: databaseUrl,
  });
  
  resourceBaseUrl = new URL(databaseUrl);
  resourceBaseUrl.protocol = "postgres:";
  resourceBaseUrl.password = "";
  
  currentDatabaseUrl = databaseUrl;
}

function extractDatabaseUrlFromRequest(request: any): string | null {
  const meta = request.meta;
  if (meta?.connectionParams?.db) {
    return decodeURIComponent(meta.connectionParams.db);
  }
  
  if (meta?.progressToken && typeof meta.progressToken === 'string') {
    try {
      const params = new URLSearchParams(meta.progressToken);
      if (params.has('db')) {
        return decodeURIComponent(params.get('db')!);
      }
    } catch {}
  }
  
  return null;
}

function getDatabaseUrl(queryParams?: URLSearchParams): string {
  if (queryParams?.has('db')) {
    return decodeURIComponent(queryParams.get('db')!);
  }
  
  const urlParam = process.env.DATABASE_URL;
  if (urlParam) {
    return urlParam;
  }
  
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args[0];
  }
  
  throw new Error("Database URL must be provided via 'db' query parameter, DATABASE_URL environment variable, or CLI argument");
}

const SCHEMA_PATH = "schema";

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const requestDbUrl = extractDatabaseUrlFromRequest(request);
  if (requestDbUrl) {
    initializeDatabase(requestDbUrl);
  } else if (!pool) {
    throw new Error("No database connection available. Database URL should be provided via SSE connection.");
  }
  
  const client = await pool!.connect();
  try {
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return {
      resources: result.rows.map((row: any) => ({
        uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl!).href,
        mimeType: "application/json",
        name: `"${row.table_name}" database schema`,
      })),
    };
  } finally {
    client.release();
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const requestDbUrl = extractDatabaseUrlFromRequest(request);
  if (requestDbUrl) {
    initializeDatabase(requestDbUrl);
  } else if (!pool) {
    throw new Error("No database connection available. Database URL should be provided via SSE connection.");
  }
  
  const resourceUrl = new URL(request.params.uri);

  const pathComponents = resourceUrl.pathname.split("/");
  const schema = pathComponents.pop();
  const tableName = pathComponents.pop();

  if (schema !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI");
  }

  const client = await pool!.connect();
  try {
    const result = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
      [tableName],
    );

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(result.rows, null, 2),
        },
      ],
    };
  } finally {
    client.release();
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const permissionDescription = currentPermissions.length === 1 && currentPermissions[0] === 'read' 
    ? "Run a read-only SQL query" 
    : `Run SQL queries with permissions: ${currentPermissions.join(', ')}`;
    
  return {
    tools: [
      {
        name: "query",
        description: permissionDescription,
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", description: "SQL query to execute" },
          },
          required: ["sql"]
        },
      },
      {
        name: "schema",
        description: "Get database schema information including all tables and their columns",
        inputSchema: {
          type: "object",
          properties: {
            table_name: { 
              type: "string", 
              description: "Optional: Get schema for a specific table only" 
            },
          },
          required: []
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "query") {
    const requestDbUrl = extractDatabaseUrlFromRequest(request);
    if (requestDbUrl) {
      initializeDatabase(requestDbUrl);
    } else if (!pool) {
      throw new Error("No database connection available. Database URL should be provided via SSE connection.");
    }
    
    const sql = request.params.arguments?.sql as string;
    
    // Validate SQL permissions
    try {
      validateSqlPermissions(sql, currentPermissions);
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Permission Error: ${error.message}` }],
        isError: true,
      };
    }

    const client = await pool!.connect();
    try {
      // For read-only permissions, use READ ONLY transaction
      // For DDL/DML permissions, use regular transaction 
      if (currentPermissions.length === 1 && currentPermissions[0] === 'read') {
        await client.query("BEGIN TRANSACTION READ ONLY");
      } else {
        await client.query("BEGIN TRANSACTION");
      }
      
      const result = await client.query(sql);
      await client.query("COMMIT");
      
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
        isError: false,
      };
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => {});
      return {
        content: [{ type: "text", text: `SQL Error: ${error.message}` }],
        isError: true,
      };
    } finally {
      client.release();
    }
  } else if (request.params.name === "schema") {
    const requestDbUrl = extractDatabaseUrlFromRequest(request);
    if (requestDbUrl) {
      initializeDatabase(requestDbUrl);
    } else if (!pool) {
      throw new Error("No database connection available. Database URL should be provided via SSE connection.");
    }
    
    const tableName = request.params.arguments?.table_name as string | undefined;
    
    const client = await pool!.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      
      let schemaInfo: any = {};
      
      if (tableName) {
        // Get schema for specific table
        const columnsResult = await client.query(`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length,
            numeric_precision,
            numeric_scale
          FROM information_schema.columns 
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [tableName]);
        
        if (columnsResult.rows.length === 0) {
          return {
            content: [{ type: "text", text: `Table '${tableName}' not found in public schema` }],
            isError: true,
          };
        }
        
        schemaInfo = {
          table: tableName,
          columns: columnsResult.rows
        };
      } else {
        // Get schema for all tables
        const tablesResult = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          ORDER BY table_name
        `);
        
        schemaInfo.tables = {};
        
        for (const tableRow of tablesResult.rows) {
          const currentTableName = tableRow.table_name;
          
          const columnsResult = await client.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default,
              character_maximum_length,
              numeric_precision,
              numeric_scale
            FROM information_schema.columns 
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
          `, [currentTableName]);
          
          schemaInfo.tables[currentTableName] = {
            columns: columnsResult.rows
          };
        }
      }
      
      await client.query("COMMIT");
      
      return {
        content: [{ type: "text", text: JSON.stringify(schemaInfo, null, 2) }],
        isError: false,
      };
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => {});
      return {
        content: [{ type: "text", text: `Schema Error: ${error.message}` }],
        isError: true,
      };
    } finally {
      client.release();
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Store active transports for cleanup
const activeTransports = new Map<string, SSEServerTransport>();
const transportPermissions = new Map<string, Permission[]>();
const transportDatabaseUrls = new Map<string, string>();

function parsePermissions(queryParams: URLSearchParams): Permission[] {
  const permissionsParam = queryParams.get('permissions');
  if (!permissionsParam) {
    // Default to read-only if no permissions specified
    return ['read'];
  }
  
  const permissions = permissionsParam.split(',').map(p => p.trim().toLowerCase());
  const validPermissions: Permission[] = [];
  
  for (const permission of permissions) {
    if (permission === 'read' || permission === 'ddl' || permission === 'dml') {
      if (!validPermissions.includes(permission)) {
        validPermissions.push(permission);
      }
    } else {
      throw new Error(`Invalid permission: ${permission}. Valid permissions are: read, ddl, dml`);
    }
  }
  
  return validPermissions.length > 0 ? validPermissions : ['read'];
}

function validateSqlPermissions(sql: string, permissions: Permission[]): void {
  const sqlUpper = sql.trim().toUpperCase();
  
  // Remove comments and normalize whitespace
  const cleanSql = sqlUpper.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  
  if (!cleanSql) {
    throw new Error("Empty query not allowed");
  }
  
  // DDL operations
  const ddlPatterns = [
    /^\s*CREATE\s+/,
    /^\s*DROP\s+/,
    /^\s*ALTER\s+/,
    /^\s*TRUNCATE\s+/,
    /^\s*COMMENT\s+/
  ];
  
  // DML operations  
  const dmlPatterns = [
    /^\s*INSERT\s+/,
    /^\s*UPDATE\s+/,
    /^\s*DELETE\s+/,
    /^\s*MERGE\s+/,
    /^\s*UPSERT\s+/
  ];
  
  // Check if it's a DDL operation
  const isDdl = ddlPatterns.some(pattern => pattern.test(cleanSql));
  if (isDdl && !permissions.includes('ddl')) {
    throw new Error("DDL operations not permitted. Current permissions: " + permissions.join(', '));
  }
  
  // Check if it's a DML operation
  const isDml = dmlPatterns.some(pattern => pattern.test(cleanSql));
  if (isDml && !permissions.includes('dml')) {
    throw new Error("DML operations not permitted. Current permissions: " + permissions.join(', '));
  }
  
  // If it's not DDL or DML, assume it's a read operation
  if (!isDdl && !isDml && !permissions.includes('read')) {
    throw new Error("Read operations not permitted. Current permissions: " + permissions.join(', '));
  }
}

function validateSecret(queryParams: URLSearchParams): boolean {
  const requiredSecret = process.env.MCP_SECRET;
  if (!requiredSecret) {
    throw new Error("MCP_SECRET environment variable is required for HTTP mode");
  }
  
  const providedSecret = queryParams.get('secret');
  return providedSecret === requiredSecret;
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
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
    } catch (error: any) {
      res.writeHead(500, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: error.message }));
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
            currentPermissions = storedPermissions;
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
        currentPermissions = storedPermissions;
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
    currentPermissions = permissions;
  } catch (error: any) {
    res.writeHead(400, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
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
      hasDatabase: !!pool,
      activeConnections: activeTransports.size,
      secretRequired: !!process.env.MCP_SECRET
    }));
    return;
  }
  
  // Default response
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

async function runServer() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const isHttpMode = process.env.MCP_HTTP_MODE === 'true' || process.argv.includes('--http');
  
  if (isHttpMode) {
    const httpServer = createServer(handleHttpRequest);
    
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
  } else {
    // CLI/stdio mode
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

runServer().catch(console.error);
