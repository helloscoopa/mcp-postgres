import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { databaseState, initializeDatabase, extractDatabaseUrlFromRequest } from "../database.js";
import { validateSqlPermissions } from "../utils/permissions.js";
import { SchemaInfo, DatabaseColumn, TableRow, ToolCallArguments } from "../types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateStringArgument(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} parameter must be a string`);
  }
  return value;
}

function validateOptionalStringArgument(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} parameter must be a string`);
  }
  return value;
}

export function setupToolHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const permissionDescription = databaseState.currentPermissions.length === 1 && databaseState.currentPermissions[0] === 'read' 
      ? "Run a read-only SQL query" 
      : `Run SQL queries with permissions: ${databaseState.currentPermissions.join(', ')}`;
      
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
      } else if (!databaseState.pool) {
        throw new Error("No database connection available. Database URL should be provided via SSE connection.");
      }
      
      const sql = validateStringArgument(request.params.arguments?.sql, 'sql');
      
      // Validate SQL permissions
      try {
        validateSqlPermissions(sql, databaseState.currentPermissions);
      } catch (error: unknown) {
        return {
          content: [{ type: "text", text: `Permission Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }

      const client = await databaseState.pool!.connect();
      try {
        // For read-only permissions, use READ ONLY transaction
        // For DDL/DML permissions, use regular transaction 
        if (databaseState.currentPermissions.length === 1 && databaseState.currentPermissions[0] === 'read') {
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
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => {});
        return {
          content: [{ type: "text", text: `SQL Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      } finally {
        client.release();
      }
    } else if (request.params.name === "schema") {
      const requestDbUrl = extractDatabaseUrlFromRequest(request);
      if (requestDbUrl) {
        initializeDatabase(requestDbUrl);
      } else if (!databaseState.pool) {
        throw new Error("No database connection available. Database URL should be provided via SSE connection.");
      }
      
      const tableName = validateOptionalStringArgument(request.params.arguments?.table_name, 'table_name');
      
      const client = await databaseState.pool!.connect();
      try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        
        let schemaInfo: SchemaInfo = {};
        
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
            columns: columnsResult.rows as DatabaseColumn[]
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
          
          for (const tableRow of tablesResult.rows as TableRow[]) {
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
            
            schemaInfo.tables![currentTableName] = {
              columns: columnsResult.rows as DatabaseColumn[]
            };
          }
        }
        
        await client.query("COMMIT");
        
        return {
          content: [{ type: "text", text: JSON.stringify(schemaInfo, null, 2) }],
          isError: false,
        };
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => {});
        return {
          content: [{ type: "text", text: `Schema Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      } finally {
        client.release();
      }
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  });
}