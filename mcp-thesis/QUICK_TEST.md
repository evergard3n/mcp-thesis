# Quick Test Guide - MCP Server

## 🚀 Cách test nhanh nhất

### Bước 1: Start server

```bash
cd mcp-thesis
npm run dev
```

Server sẽ chạy tại `http://localhost:3006/mcp`

### Bước 2: Chọn một trong các cách test

## ✅ Cách 1: MCP Inspector (RECOMMEND)

**Dễ nhất, có UI**

```bash
# Terminal mới (giữ server chạy ở terminal cũ)
npm run inspector
```

- Tự động mở browser
- Click vào tools để test
- Xem response ngay

## ✅ Cách 2: Shell Script (Nhanh)

```bash
# Terminal mới
./test-simple.sh
```

Sẽ test tuần tự:

1. List tools
2. Init project
3. List projects
4. Get project info

## ✅ Cách 3: TypeScript Script (Chi tiết)

```bash
# Terminal mới
npx tsx test-mcp.ts
```

Có thể customize test cases trong file này.

## ✅ Cách 4: Manual với cURL

```bash
# Test 1: List tools
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq

# Test 2: Init project
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"initProject",
      "arguments":{"name":"test1","description":"Test project"}
    },
    "id":2
  }' | jq
```

## 🔍 Test với Gemini (Extract Use Case)

### Cần: GEMINI_API_KEY trong .env

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"extractUseCase",
      "arguments":{
        "input":"User logs into the system. System validates credentials. If valid, redirect to dashboard. If invalid, show error."
      }
    },
    "id":3
  }' | jq
```

## 📊 Test Results Example

### Success Response:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "✅ Project initialized successfully"
      }
    ]
  },
  "id": 2
}
```

### Error Response:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid request"
  },
  "id": 1
}
```

## 🐛 Troubleshooting

### Server không start

```bash
# Check port
lsof -i :3006

# Kill process nếu cần
kill -9 <PID>
```

### jq not found (cho shell script)

```bash
# Ubuntu/Debian
sudo apt install jq

# MacOS
brew install jq

# Hoặc bỏ | jq trong command
```

### Gemini API error

```bash
# Check .env file
cat .env | grep GEMINI

# Nếu chưa có, tạo file .env
cp env.example .env
# Sau đó edit GEMINI_API_KEY
```

## 📝 Available Tools

Sau khi `tools/list`, bạn sẽ thấy:

### Project Tools:

- `initProject` - Tạo project mới
- `loadProjectByName` - Load project
- `findProjectByName` - Tìm project
- `listAllProjects` - List tất cả projects
- `getProjectInfo` - Info project hiện tại
- `viewProjectUseCases` - Xem use cases

### Use Case Tools:

- `extractUseCase` - Extract từ text (dùng Gemini)
- `validateUseCase` - Validate use case
- `useCaseToUML` - Convert sang PlantUML

## 🎯 Test Workflow Hoàn chỉnh

```bash
# 1. Init project
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initProject","arguments":{"name":"banking","description":"Banking system"}},"id":1}'

# 2. Extract use case
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"extractUseCase","arguments":{"input":"User login use case"}},"id":2}'

# 3. View use cases
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"viewProjectUseCases","arguments":{}},"id":3}'
```

## 💡 Tips

1. **Inspector là tốt nhất** cho development/debugging
2. **Shell script** tốt cho CI/CD hoặc quick test
3. **TypeScript script** tốt cho integration test
4. **cURL** tốt cho manual test/debug cụ thể

## 📚 Đọc thêm

- Full guide: `TEST_GUIDE.md`
- MCP docs: https://modelcontextprotocol.io/
- Inspector: https://github.com/modelcontextprotocol/inspector
