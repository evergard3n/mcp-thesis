# 🚀 BẮT ĐẦU - Docker + Cloudflare

## 📋 Các bước (3 bước đơn giản)

### Bước 1: Chuẩn bị .env file

```bash
cd /home/bao/Downloads/mcp-thesis/mcp-thesis

# Nếu chưa có .env, tạo từ template
cp .env.docker .env

# Edit và thêm GEMINI_API_KEY
nano .env
```

Trong file `.env`, thêm API key:

```
GEMINI_API_KEY=your_actual_api_key_here
PORT=3000
NODE_ENV=production
```

Lưu và thoát (Ctrl+X, Y, Enter)

### Bước 2: Start Docker containers

```bash
# Start với quick tunnel (không cần Cloudflare token)
./docker-start.sh
```

Hoặc manual:

```bash
docker-compose -f docker-compose.quick.yml up -d --build
```

### Bước 3: Lấy Cloudflare URL

```bash
# Xem logs để lấy public URL
docker-compose -f docker-compose.quick.yml logs cloudflared
```

Hoặc:

```bash
docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
```

Output sẽ có dạng:

```
https://random-words-1234.trycloudflare.com
```

## ✅ Kiểm tra

### 1. Check containers đang chạy

```bash
docker-compose -f docker-compose.quick.yml ps
```

Should see:

```
mcp-thesis-server        running (healthy)
mcp-cloudflare-tunnel    running
```

### 2. Test local

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq
```

### 3. Test public URL

```bash
# Replace với URL thật từ logs
curl -X POST https://your-tunnel-url.trycloudflare.com \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq
```

## 🛠️ Commands thường dùng

```bash
# Start
docker-compose -f docker-compose.quick.yml up -d

# Stop
docker-compose -f docker-compose.quick.yml down

# View logs
docker-compose -f docker-compose.quick.yml logs -f

# View specific service
docker-compose -f docker-compose.quick.yml logs -f mcp-server
docker-compose -f docker-compose.quick.yml logs -f cloudflared

# Restart
docker-compose -f docker-compose.quick.yml restart

# Rebuild after code changes
docker-compose -f docker-compose.quick.yml up -d --build

# Stop and remove everything
docker-compose -f docker-compose.quick.yml down -v
```

## 🔧 Scripts có sẵn

```bash
./docker-start.sh   # Auto start và show URL
./docker-test.sh    # Test deployment
./docker-stop.sh    # Stop all services
```

## 🌐 Sử dụng với Claude Desktop

1. **Get tunnel URL:**

   ```bash
   docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
   ```

2. **Copy URL** (ví dụ: `https://abc-123.trycloudflare.com`)

3. **Edit Claude Desktop config:**

   MacOS:

   ```bash
   nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

   Windows:

   ```bash
   notepad %APPDATA%\Claude\claude_desktop_config.json
   ```

4. **Add configuration:**

   ```json
   {
     "mcpServers": {
       "mcp-thesis": {
         "url": "https://your-tunnel-url.trycloudflare.com"
       }
     }
   }
   ```

5. **Restart Claude Desktop**

6. **Test trong chat:** "List all available tools"

## 📊 Architecture

```
Laptop/PC
    ↓
Docker Container (MCP Server)
    ↓
Cloudflare Tunnel
    ↓
Internet (Public HTTPS URL)
```

Bất kỳ ai có URL có thể access MCP server của bạn!

## ⚠️ Lưu ý

1. **GEMINI_API_KEY required**: Không có key thì extractUseCase tool không hoạt động
2. **URL thay đổi**: Mỗi lần restart cloudflared sẽ tạo URL mới
3. **Public access**: URL này public, ai có cũng truy cập được
4. **Data persist**: Files trong `./data` và `./logs` được giữ lại

## 🐛 Troubleshooting

### Container không start

```bash
# Check logs
docker-compose -f docker-compose.quick.yml logs mcp-server

# Common issue: Missing GEMINI_API_KEY
nano .env  # Add key
docker-compose -f docker-compose.quick.yml restart
```

### Port 3000 đã dùng

```bash
# Find process
lsof -i :3000

# Kill it
kill -9 <PID>

# Or change port in .env
echo "PORT=3001" >> .env
```

### Không thấy tunnel URL

```bash
# Wait 10 seconds
sleep 10

# Check logs again
docker-compose -f docker-compose.quick.yml logs cloudflared

# Restart cloudflared
docker-compose -f docker-compose.quick.yml restart cloudflared
```

## 📚 Files quan trọng

- `.env` - Configuration (GEMINI_API_KEY)
- `docker-compose.quick.yml` - Docker config
- `Dockerfile` - Container build instructions
- `./data/` - Project data (persist)
- `./logs/` - Application logs (persist)

## 🎯 Quick Reference

```bash
# Complete workflow
cd /home/bao/Downloads/mcp-thesis/mcp-thesis
cp .env.docker .env && nano .env
./docker-start.sh
docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
```

---

**🎉 Xong! Server đã online và accessible từ internet!**
