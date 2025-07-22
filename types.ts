import type { Pool as PoolType } from "pg";

export type Permission = 'read' | 'ddl' | 'dml';

export interface DatabaseState {
  pool: PoolType | null;
  resourceBaseUrl: URL | null;
  currentDatabaseUrl: string | null;
  currentPermissions: Permission[];
}

export interface TransportInfo {
  permissions: Permission[];
  databaseUrl: string;
}


export interface TableRow {
  table_name: string;
}

export interface DatabaseColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

export interface SchemaInfo {
  table?: string;
  columns?: DatabaseColumn[];
  tables?: Record<string, { columns: DatabaseColumn[] }>;
}

export interface ToolCallArguments {
  sql?: unknown;
  table_name?: unknown;
}