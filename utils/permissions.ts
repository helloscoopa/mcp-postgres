import { Permission } from "../types.js";

export function parsePermissions(queryParams: URLSearchParams): Permission[] {
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

export function validateSqlPermissions(sql: string, permissions: Permission[]): void {
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

export function validateSecret(queryParams: URLSearchParams): boolean {
  const requiredSecret = process.env.MCP_SECRET;
  if (!requiredSecret) {
    throw new Error("MCP_SECRET environment variable is required for HTTP mode");
  }
  
  const providedSecret = queryParams.get('secret');
  return providedSecret === requiredSecret;
}