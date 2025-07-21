# PostgreSQL MCP Server

A Model Context Protocol server that provides read-only access to PostgreSQL databases. This server enables LLMs to inspect database schemas and execute read-only queries.

## Components

### Tools

- **query**
  - Execute SQL queries against the connected database based on configured permissions
  - Input: `sql` (string): The SQL query to execute
  - Permissions control which operations are allowed:
    - `read`: SELECT queries only (default, uses READ ONLY transactions)
    - `ddl`: Data Definition Language (CREATE, DROP, ALTER, etc.)
    - `dml`: Data Manipulation Language (INSERT, UPDATE, DELETE, etc.)
  - Multiple permissions can be combined (e.g., `read,dml`)

### Resources

The server provides schema information for each table in the database:

- **Table Schemas** (`postgres://<host>/<table>/schema`)
  - JSON schema information for each table
  - Includes column names and data types
  - Automatically discovered from database metadata

## Configuration

The server supports multiple ways to specify the database connection and permissions:

1. **Environment Variable** (recommended for hosting): Set `DATABASE_URL`
2. **Command Line Argument**: Pass the PostgreSQL URL as the first argument
3. **URL Parameters**: For web deployment with custom permissions

### Permission System

Control SQL operations using the `permissions` parameter:

- **`read`** (default): Only SELECT queries allowed, uses READ ONLY transactions
- **`ddl`**: Data Definition Language - CREATE, DROP, ALTER, TRUNCATE, COMMENT
- **`dml`**: Data Manipulation Language - INSERT, UPDATE, DELETE, MERGE, UPSERT

Examples:
- `permissions=read` - Read-only access (default)
- `permissions=read,dml` - Read and modify data
- `permissions=read,ddl,dml` - Full database access

### Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

### Docker

* when running docker on macos, use host.docker.internal if the server is running on the host network (eg localhost)
* username/password can be added to the postgresql url with `postgresql://user:password@host:port/db-name`

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", 
        "-i", 
        "--rm", 
        "mcp/postgres", 
        "postgresql://host.docker.internal:5432/mydb"]
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://localhost/mydb"
      ]
    }
  }
}
```

Replace `/mydb` with your database name.

### Environment Variable Configuration

For hosting or deployment scenarios, you can set the database URL via environment variable:

```bash
# Set the environment variable
export DATABASE_URL="postgresql://user:password@host:port/database"

# Run the server (no CLI argument needed)
node dist/index.js
```

This method is particularly useful for:
- **Web hosting**: Deploy the server and configure `DATABASE_URL` in your hosting platform
- **Claude Web Custom Connectors**: Host the server with environment-based configuration
- **Production deployments**: Keep sensitive connection strings out of command lines

#### Docker with Environment Variable

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", 
        "-i", 
        "--rm",
        "-e", "DATABASE_URL=postgresql://host.docker.internal:5432/mydb",
        "mcp/postgres"
      ]
    }
  }
}
```

### Usage with VS Code

For quick installation, use one of the one-click install buttons below...

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-NPM-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=postgres&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22pg_url%22%2C%22description%22%3A%22PostgreSQL%20URL%20(e.g.%20postgresql%3A%2F%2Fuser%3Apass%40localhost%3A5432%2Fmydb)%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40modelcontextprotocol%2Fserver-postgres%22%2C%22%24%7Binput%3Apg_url%7D%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-NPM-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=postgres&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22pg_url%22%2C%22description%22%3A%22PostgreSQL%20URL%20(e.g.%20postgresql%3A%2F%2Fuser%3Apass%40localhost%3A5432%2Fmydb)%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40modelcontextprotocol%2Fserver-postgres%22%2C%22%24%7Binput%3Apg_url%7D%22%5D%7D&quality=insiders)

[![Install with Docker in VS Code](https://img.shields.io/badge/VS_Code-Docker-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=postgres&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22pg_url%22%2C%22description%22%3A%22PostgreSQL%20URL%20(e.g.%20postgresql%3A%2F%2Fuser%3Apass%40host.docker.internal%3A5432%2Fmydb)%22%7D%5D&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22mcp%2Fpostgres%22%2C%22%24%7Binput%3Apg_url%7D%22%5D%7D) [![Install with Docker in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Docker-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=postgres&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22pg_url%22%2C%22description%22%3A%22PostgreSQL%20URL%20(e.g.%20postgresql%3A%2F%2Fuser%3Apass%40host.docker.internal%3A5432%2Fmydb)%22%7D%5D&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22mcp%2Fpostgres%22%2C%22%24%7Binput%3Apg_url%7D%22%5D%7D&quality=insiders)

For manual installation, add the following JSON block to your User Settings (JSON) file in VS Code. You can do this by pressing `Ctrl + Shift + P` and typing `Preferences: Open User Settings (JSON)`.

Optionally, you can add it to a file called `.vscode/mcp.json` in your workspace. This will allow you to share the configuration with others.

> Note that the `mcp` key is not needed in the `.vscode/mcp.json` file.

### Docker

**Note**: When using Docker and connecting to a PostgreSQL server on your host machine, use `host.docker.internal` instead of `localhost` in the connection URL.

```json
{
  "mcp": {
    "inputs": [
      {
        "type": "promptString",
        "id": "pg_url",
        "description": "PostgreSQL URL (e.g. postgresql://user:pass@host.docker.internal:5432/mydb)"
      }
    ],
    "servers": {
      "postgres": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "mcp/postgres",
          "${input:pg_url}"
        ]
      }
    }
  }
}
```

### NPX

```json
{
  "mcp": {
    "inputs": [
      {
        "type": "promptString",
        "id": "pg_url",
        "description": "PostgreSQL URL (e.g. postgresql://user:pass@localhost:5432/mydb)"
      }
    ],
    "servers": {
      "postgres": {
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-postgres",
          "${input:pg_url}"
        ]
      }
    }
  }
}
```

## Building

Docker:

```sh
docker build -t mcp/postgres -f src/postgres/Dockerfile . 
```

## Security Features

This server implements several security measures to prevent data modification and unauthorized access:

### Data Protection
- **Permission-based access**: Configurable SQL operation permissions (read, ddl, dml)
- **Read-only by default**: Only SELECT queries allowed unless explicitly granted higher permissions
- **Smart transaction handling**: READ ONLY transactions for read-only permissions, regular transactions with commit/rollback for write permissions
- **SQL operation validation**: Queries are analyzed and blocked if they exceed granted permissions
- **Connection isolation**: Each request uses isolated database connections

### Access Control (HTTP Mode)
- **Mandatory authentication**: Secret token is required for SSE connection establishment
- **Query parameter validation**: `?secret=<token>` must match `MCP_SECRET` environment variable
- **Session-based protection**: Message endpoint is protected by session ID from established SSE connections
- **401 Unauthorized**: Invalid or missing secrets return proper HTTP error codes
- **CORS support**: Cross-origin requests are properly handled with authentication

### Best Practices
- Use a strong, random secret token (e.g., generated with `openssl rand -base64 32`)
- Store secrets securely in your hosting platform's environment variables
- Rotate secrets regularly for production deployments
- Monitor access logs for unauthorized attempts

## Deployment Options

### Local Development
```bash
# Using CLI argument
node dist/index.js "postgresql://localhost:5432/mydb"

# Using environment variable
export DATABASE_URL="postgresql://localhost:5432/mydb"
node dist/index.js
```

### Web Hosting for Claude Web Custom Connectors

Deploy to any Node.js hosting platform (Railway, Vercel, Heroku, etc.):

1. Set environment variables:
   ```bash
   DATABASE_URL=postgresql://user:pass@host:port/db
   MCP_HTTP_MODE=true
   MCP_SECRET=your-secret-token    # REQUIRED for HTTP mode
   PORT=3000  # Optional, defaults to 3000
   ```

2. Deploy and run: `node dist/index.js`

3. In Claude Web, add custom connector:
   ```
   https://your-deployed-server.com/sse?secret=your-secret-token
   ```

#### Railway Deployment Example
```bash
# Set environment variables in Railway dashboard:
DATABASE_URL=postgresql://user:pass@host:port/db
MCP_HTTP_MODE=true
MCP_SECRET=your-secret-token

# Deploy this repository
# Your connector URL will be: https://your-app.railway.app/sse?secret=your-secret-token
```

#### URL Parameter Methods

**Method 1: Environment variable for database (recommended)**
```
# Read-only access (default)
https://your-deployed-server.com/sse?secret=your-secret-token

# Custom permissions
https://your-deployed-server.com/sse?secret=your-secret-token&permissions=read,dml
```

**Method 2: Database URL via query parameter**
```
# Read-only with custom database
https://your-deployed-server.com/sse?secret=your-secret-token&db=postgresql://user:pass@host:port/db

# Full permissions with custom database
https://your-deployed-server.com/sse?secret=your-secret-token&db=postgresql://user:pass@host:port/db&permissions=read,ddl,dml
```

**Security Notes:**
- The `secret` parameter is **always required** for HTTP mode
- Keep your secret token secure and use a strong, random value
- Environment variable method is more secure for database credentials
- Use `permissions=read` (default) for maximum security - only SELECT queries allowed
- Be cautious with `ddl` and `dml` permissions as they allow data modification

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
