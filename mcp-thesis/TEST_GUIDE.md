# Hướng dẫn Test MCP Server

## Tổng quan

Hệ thống MCP này có các công cụ (tools) để quản lý Use Cases với Gemini AI. Có nhiều cách để test:

## 1. Test với MCP Inspector (Recommend ⭐)

**Cách dễ nhất và trực quan nhất**

```bash
# Bước 1: Build project
npm run build

# Bước 2: Chạy inspector
npm run inspector
```

Inspector sẽ:

- Mở giao diện web (thường là http://localhost:6000)
- Hiển thị tất cả tools có sẵn
- Cho phép test từng tool với UI
- Hiển thị request/response real-time
- Debug schema validation

### Các tools có thể test:

- `initProject`: Tạo project mới
- `loadProjectByName`: Load project theo tên
- `findProjectByName`: Tìm project
- `listAllProjects`: Liệt kê tất cả projects
- `getProjectInfo`: Xem thông tin project hiện tại
- `viewProjectUseCases`: Xem use cases trong project
- `extractUseCase`: Extract use case từ text (cần Gemini API)
- `validateUseCase`: Validate use case
- `useCaseToUML`: Convert use case sang PlantUML

## 2. Test với HTTP Client

### Sử dụng cURL:

```bash
# Start server trước
npm run dev

# Test list tools
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'

# Test init project
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "initProject",
      "arguments": {
        "name": "my-test-project",
        "description": "A test project"
      }
    },
    "id": 2
  }'
```

### Sử dụng test script:

```bash
# Test với TypeScript script
npx tsx test-mcp.ts

# Hoặc test với shell script (cần jq)
chmod +x test-simple.sh
./test-simple.sh
```

### Sử dụng Postman:

1. Import collection với các request sau:
   - Method: POST
   - URL: http://localhost:3006/mcp
   - Headers: Content-Type: application/json
   - Body: JSON-RPC format

## 3. Test với MCP Client (Claude Desktop)

### Setup:

1. Start server: `npm run dev`

2. Config Claude Desktop:
   - MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp"
    }
  }
}
```

3. Restart Claude Desktop

4. Test trong chat:
   ```
   "Create a new UML project called 'Online Banking System'"
   "Extract use case: User logs into the banking system..."
   ```

## 4. Test với VSCode Extension

### Setup:

1. Install extension: "Model Context Protocol"
2. Start server: `npm run dev`
3. Configure trong VSCode settings
4. Test tools qua command palette

## Test Workflow Example

### Workflow 1: Tạo project và quản lý

```bash
# 1. List tools
POST /mcp -> tools/list

# 2. Init project
POST /mcp -> tools/call -> initProject
{
  "name": "banking-system",
  "description": "Banking system UML project"
}

# 3. List all projects
POST /mcp -> tools/call -> listAllProjects

# 4. Get project info
POST /mcp -> tools/call -> getProjectInfo
```

### Workflow 2: Extract và validate use case

```bash
# 1. Load project
POST /mcp -> tools/call -> loadProjectByName
{ "name": "banking-system" }

# 2. Extract use case (cần Gemini API key)
POST /mcp -> tools/call -> extractUseCase
{
  "input": "User opens app, enters username/password..."
}

# 3. Validate use case
POST /mcp -> tools/call -> validateUseCase
{ "extractedJsonString": "..." }

# 4. View all use cases
POST /mcp -> tools/call -> viewProjectUseCases
```

## Các lỗi thường gặp

### 1. Server không start

```bash
# Check port đã được sử dụng chưa
lsof -i :3006

# Đổi port trong .env
PORT=3007
```

### 2. Gemini API lỗi

```bash
# Check API key trong .env
GEMINI_API_KEY=your_key_here

# Test Gemini connection riêng
```

### 3. Project không load

```bash
# Check quyền file system
ls -la ~/.mcp-thesis/

# Reset project store nếu cần
```

## Debug Tips

### 1. Enable verbose logging

Sửa trong code để log chi tiết hơn:

```typescript
projectStore.log(`Debug info: ${JSON.stringify(data)}`);
```

### 2. Check request/response

Xem trong terminal khi server chạy

### 3. Validate JSON schema

Use tools như jsonschema.net để validate schema

## Performance Testing

```bash
# Test multiple requests
for i in {1..10}; do
  curl -X POST http://localhost:3006/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":'$i'}'
done
```

## Checklist Test

- [ ] Server starts successfully
- [ ] List tools returns all expected tools
- [ ] Init project creates folder structure
- [ ] Load project switches context
- [ ] Extract use case calls Gemini
- [ ] Validate use case returns score
- [ ] Convert to UML generates PlantUML
- [ ] Error handling works correctly
- [ ] Concurrent requests work
- [ ] Memory usage is reasonable

## Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [JSON-RPC Spec](https://www.jsonrpc.org/specification)
