# MCP Server Connection Guide

## Quick Fix Summary

Your MCP server **IS running correctly** at `http://localhost:3006/mcp`, but it needs proper configuration to accept connections.

## Changes Made

### 1. Updated Cursor MCP Configuration (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "transport": {
        "type": "streamable-http"
      }
    }
  }
}
```

### 2. Updated Server Configuration (`src/index.ts`)

Disabled DNS rebinding protection for local development:

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => newSessionId,
  onsessioninitialized: async (sessionId) => {
    sessions[sessionId] = { server, transport };
  },
  enableDnsRebindingProtection: false,
  allowedHosts: ["*"],
  allowedOrigins: ["*"],
});
```

## How to Connect with MCP Inspector

1. **Open MCP Inspector**: Already open at `localhost:6274`

2. **Set URL**: `http://localhost:3006/mcp` (already set ✓)

3. **Expand Authentication Section**: Click on "Authentication" in the left panel

4. **Select Authentication Type**: Choose "None" (for local development)

   - Or if you see a checkbox for "Disable Authentication", enable it

5. **Click Connect**: The connection should now work

## How to Connect with Cursor

After updating the configuration:

1. **Restart Cursor** (important - it needs to reload the MCP config)

2. **Open a chat** and type: `@mcp-thesis`

3. **You should see your MCP tools** listed

## Testing the Connection Manually

You can test if the server is working with curl:

```bash
# Test server is running
curl http://localhost:3006/ping
# Should return: pong

# Test MCP initialization (with proper headers)
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"initialize",
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{},
      "clientInfo":{"name":"test","version":"1.0.0"}
    },
    "id":1
  }'
```

## Common Issues

### Issue: "Connection Error - Check if your MCP server is running and proxy token is correct"

**Solution**:

- Make sure you've disabled authentication in MCP Inspector
- OR configure proxy authentication (see below)

### Issue: "Not Acceptable: Client must accept both application/json and text/event-stream"

**Solution**:

- The MCP Inspector should automatically send these headers
- If manually testing, always include: `Accept: application/json, text/event-stream`

### Issue: Server not starting

**Solution**:

```bash
cd mcp-thesis
bun run build && bun dev
```

## Production Setup (Optional)

For production, you should enable authentication:

1. **Generate a secure token**:

```bash
openssl rand -base64 32
```

2. **Update Cursor config**:

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "transport": {
        "type": "streamable-http",
        "auth": {
          "type": "proxy",
          "token": "YOUR_SECURE_TOKEN_HERE"
        }
      }
    }
  }
}
```

3. **Update server to validate token** (add middleware to check `MCP_PROXY_AUTH_TOKEN` header)

## Next Steps

1. Rebuild and restart your server:

   ```bash
   cd mcp-thesis
   bun run build && bun dev
   ```

2. In MCP Inspector:

   - Click on "Authentication" section
   - Select "None" or disable authentication
   - Click "Connect"

3. Restart Cursor to load the new MCP configuration

4. Try using `@mcp-thesis` in Cursor chat

## Verification

Your server is working if you see this in the terminal:

```
2026-01-03T15:20:28.727Z Demo MCP Server running on http://localhost:3006/mcp
```

And this curl command returns a success response:

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
```

Should return something like:

```
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{...},"serverInfo":{...}},"jsonrpc":"2.0","id":1}
```
