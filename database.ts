import pkg from "pg";
const { Pool } = pkg;
import type { Pool as PoolType } from "pg";
import { DatabaseState } from "./types.js";

export const databaseState: DatabaseState = {
  pool: null,
  resourceBaseUrl: null,
  currentDatabaseUrl: null,
  currentPermissions: ['read']
};

export function initializeDatabase(databaseUrl: string): void {
  if (databaseState.currentDatabaseUrl === databaseUrl && databaseState.pool) {
    return;
  }
  
  if (databaseState.pool) {
    databaseState.pool.end();
  }
  
  databaseState.pool = new Pool({
    connectionString: databaseUrl,
  });
  
  databaseState.resourceBaseUrl = new URL(databaseUrl);
  databaseState.resourceBaseUrl.protocol = "postgres:";
  databaseState.resourceBaseUrl.password = "";
  
  databaseState.currentDatabaseUrl = databaseUrl;
}

export function extractDatabaseUrlFromRequest(request: any): string | null {
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
    } catch {
      // Ignore parsing errors
    }
  }
  
  return null;
}

export function getDatabaseUrl(queryParams?: URLSearchParams): string {
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