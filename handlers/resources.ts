import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { databaseState, initializeDatabase, extractDatabaseUrlFromRequest } from "../database.js";
import { TableRow, DatabaseColumn } from "../types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

const SCHEMA_PATH = "schema";

export function setupResourceHandlers(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const requestDbUrl = extractDatabaseUrlFromRequest(request);
    if (requestDbUrl) {
      initializeDatabase(requestDbUrl);
    } else if (!databaseState.pool) {
      throw new Error("No database connection available. Database URL should be provided via SSE connection.");
    }
    
    const client = await databaseState.pool!.connect();
    try {
      const result = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      return {
        resources: result.rows.map((row: TableRow) => ({
          uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, databaseState.resourceBaseUrl!).href,
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
    } else if (!databaseState.pool) {
      throw new Error("No database connection available. Database URL should be provided via SSE connection.");
    }
    
    const resourceUrl = new URL(request.params.uri);

    const pathComponents = resourceUrl.pathname.split("/");
    const schema = pathComponents.pop();
    const tableName = pathComponents.pop();

    if (schema !== SCHEMA_PATH) {
      throw new Error("Invalid resource URI");
    }

    const client = await databaseState.pool!.connect();
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
}