# PostgreSQL MCP Server - Development Guide

This document contains development instructions for the PostgreSQL MCP server.

## Project Structure

The codebase follows a modular architecture for better maintainability:

```
src/postgres/
├── index.ts              # Main entry point and server initialization
├── types.ts              # TypeScript type definitions and interfaces
├── database.ts           # Database connection management and utilities
├── server.ts             # HTTP server logic and SSE transport handling
├── handlers/
│   ├── resources.ts      # MCP resource handlers (ListResources, ReadResource)
│   └── tools.ts          # MCP tool handlers (query, schema tools)
├── utils/
│   └── permissions.ts    # Permission parsing and SQL validation
├── package.json          # Dependencies and build scripts
├── tsconfig.json         # TypeScript configuration
└── Dockerfile            # Docker build configuration
```

### Module Responsibilities

- **index.ts**: Server initialization and handler registration
- **types.ts**: Type definitions for Permission, DatabaseState, TransportInfo
- **database.ts**: Connection pooling, URL extraction, database initialization
- **server.ts**: HTTP request handling, SSE transport management, CORS
- **handlers/resources.ts**: Table schema resource endpoints
- **handlers/tools.ts**: Query execution and schema inspection tools
- **utils/permissions.ts**: Permission validation and SQL operation filtering

## Development Commands

### Build the project
```bash
npm run build
```

### Run in development mode
```bash
# With CLI argument
npm run build && node dist/index.js "postgresql://localhost:5432/mydb"

# With environment variable
export DATABASE_URL="postgresql://localhost:5432/mydb"
npm run build && node dist/index.js
```

### Watch mode for development
```bash
npm run watch
```

## Code Architecture

### Configuration System
The server supports multiple configuration methods (in order of precedence):
1. MCP request parameters (experimental)
2. CLI arguments
3. Environment variable (`DATABASE_URL`)

### Security Implementation
- Read-only transactions by default for read permissions (handlers/tools.ts)
- Smart transaction handling based on permission level
- Automatic transaction rollback on errors
- Connection pooling with proper cleanup (database.ts)
- SQL operation validation against granted permissions (utils/permissions.ts)
- No exposed destructive operations without explicit permissions

### Key Functions by Module

**database.ts**:
- `initializeDatabase()` - Sets up database connection pool
- `extractDatabaseUrlFromRequest()` - Extracts DB URL from MCP requests
- `getDatabaseUrl()` - Resolves database URL from various sources

**utils/permissions.ts**:
- `parsePermissions()` - Parses and validates permission parameters
- `validateSqlPermissions()` - Validates SQL queries against granted permissions
- `validateSecret()` - Authenticates HTTP mode requests

**handlers/tools.ts**:
- Query tool handler - Executes SQL with permission validation
- Schema tool handler - Returns database schema information

**server.ts**:
- `handleHttpRequest()` - Main HTTP request router
- `startHttpServer()` - HTTP server initialization

## Testing

Test the server with a PostgreSQL database:

```bash
# Start a test PostgreSQL instance
docker run -d --name test-postgres -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:15

# Build and run the server
npm run build
node dist/index.js "postgresql://postgres:test@localhost:5432/postgres"
```

### Testing the Schema Tool

The server now includes a `schema` tool for database inspection:

```bash
# Test schema tool via MCP (requires MCP client)
# Get all tables and columns:
{"tool": "schema"}

# Get specific table schema:
{"tool": "schema", "arguments": {"table_name": "users"}}
```

This tool enables AI agents to understand database structure before writing queries, improving query accuracy and reducing errors.

### HTTP Mode Testing

Test the HTTP server with authentication:

```bash
# Start a test PostgreSQL instance
docker run -d --name test-postgres -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:15

# Set environment variables for HTTP mode
export DATABASE_URL="postgresql://postgres:test@localhost:5432/postgres"
export MCP_HTTP_MODE=true
export MCP_SECRET=test-secret-123

# Build and run in HTTP mode
npm run build
node dist/index.js

# Test the protected endpoints
curl "http://localhost:3000/health"  # Health check (no secret required)
curl "http://localhost:3000/sse?secret=test-secret-123"  # Read-only permissions (default)
curl "http://localhost:3000/sse?secret=test-secret-123&permissions=read,dml"  # Read + write permissions
curl "http://localhost:3000/sse?secret=wrong-secret"  # Should return 401
curl "http://localhost:3000/sse"  # Should return 401
```

### Permission Testing

Test different permission levels:

```bash
# Read-only (default)
export MCP_SECRET=test-secret-123
export DATABASE_URL="postgresql://postgres:test@localhost:5432/postgres"
export MCP_HTTP_MODE=true
node dist/index.js

# Test with read,dml permissions
curl "http://localhost:3000/sse?secret=test-secret-123&permissions=read,dml"

# Test with all permissions  
curl "http://localhost:3000/sse?secret=test-secret-123&permissions=read,ddl,dml"
```

## Deployment Notes

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `NODE_ENV` - Set to 'production' for production builds
- `MCP_HTTP_MODE` - Set to 'true' to enable HTTP server mode
- `MCP_SECRET` - Required secret token for HTTP mode authentication
- `PORT` - HTTP server port (defaults to 3000)

### Security Considerations
- Database connections use read-only transactions
- Connection strings should be kept secure
- No user input validation needed for SQL as transactions are read-only
- Connection pooling prevents connection exhaustion

#### HTTP Mode Security
- **Mandatory authentication**: `MCP_SECRET` environment variable must be set for HTTP mode
- **Secret validation**: SSE endpoint requires `?secret=<token>` parameter for connection establishment
- **Session-based protection**: Message endpoint is protected by session ID from authenticated SSE connections
- **Permission-based access**: `permissions` parameter controls allowed SQL operations
- **SQL operation validation**: `validateSqlPermissions()` function blocks unauthorized queries (utils/permissions.ts)
- **Access control**: Invalid/missing secrets return 401 Unauthorized
- **Function reference**: `validateSecret()` function handles authentication (utils/permissions.ts)
- **Error handling**: Proper CORS headers on all error responses (server.ts)

## Common Issues

1. **TypeScript build errors**: Run `npm install` to ensure all dependencies are installed
2. **Database connection failures**: Verify PostgreSQL URL format and accessibility
3. **Permission errors**: Ensure database user has SELECT permissions
4. **HTTP mode startup errors**: 
   - Ensure `MCP_SECRET` is set when using `MCP_HTTP_MODE=true`
   - Check that PORT is available (default 3000)
5. **401 Unauthorized in HTTP mode**: 
   - Verify `?secret=<token>` parameter matches `MCP_SECRET` environment variable
   - Ensure secret is URL-encoded if it contains special characters
6. **Permission errors**: 
   - Check that `permissions` parameter contains valid values: `read`, `ddl`, `dml`
   - Verify SQL queries match granted permissions (e.g., no INSERT with read-only permissions)
7. **CORS issues**: Server includes proper CORS headers, but check browser console for errors