# 🚀 BẮT ĐẦU NHANH - 3 BƯỚC

## Cách 1: Dùng Setup Wizard (Recommend ⭐)

```bash
cd /home/bao/Downloads/mcp-thesis/mcp-thesis
./setup.sh
```

Script sẽ:

1. ✅ Check `.env` configuration
2. ✅ Build và start Docker containers
3. ✅ Tự động lấy Cloudflare URL
4. ✅ Hiển thị instructions

## Cách 2: Manual (3 lệnh)

```bash
# 1. Check .env (nếu chưa có GEMINI_API_KEY)
nano .env

# 2. Start Docker
docker-compose -f docker-compose.quick.yml up -d --build

# 3. Get public URL
docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
```

## ✅ Kiểm tra hoạt động

### Test local

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq
```

### Check containers

```bash
docker-compose -f docker-compose.quick.yml ps
```

Should see:

```
mcp-thesis-server        Up (healthy)
mcp-cloudflare-tunnel    Up
```

## 🌐 Cloudflare URL

Mỗi lần start sẽ có URL mới dạng:

```
https://random-words-1234.trycloudflare.com
```

Lấy URL:

```bash
docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
```

## 🛠️ Commands thường dùng

```bash
# Start
docker-compose -f docker-compose.quick.yml up -d

# Stop
docker-compose -f docker-compose.quick.yml down

# Logs (all)
docker-compose -f docker-compose.quick.yml logs -f

# Logs (specific service)
docker-compose -f docker-compose.quick.yml logs -f mcp-server
docker-compose -f docker-compose.quick.yml logs -f cloudflared

# Restart
docker-compose -f docker-compose.quick.yml restart

# Rebuild
docker-compose -f docker-compose.quick.yml up -d --build

# Status
docker-compose -f docker-compose.quick.yml ps
```

## 🔧 Sử dụng với Claude Desktop

1. **Get URL:**

   ```bash
   docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare
   ```

2. **Copy URL** (ví dụ: `https://abc-123.trycloudflare.com`)

3. **Edit config:**

   MacOS:

   ```bash
   nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

4. **Add config:**

   ```json
   {
     "mcpServers": {
       "mcp-thesis": {
         "url": "https://your-tunnel-url-here.trycloudflare.com"
       }
     }
   }
   ```

5. **Restart Claude Desktop**

6. **Test:** "List all available tools"

## 📚 Files quan trọng

- `.env` - Configuration (GEMINI_API_KEY)
- `docker-compose.quick.yml` - Docker config
- `./data/` - Project data (persist)
- `./logs/` - Application logs (persist)

## 🐛 Troubleshooting

### Container không start

```bash
# Check logs
docker-compose -f docker-compose.quick.yml logs mcp-server

# Common: Missing GEMINI_API_KEY
nano .env  # Add key
docker-compose -f docker-compose.quick.yml restart
```

### Port 3000 đã dùng

```bash
lsof -i :3000
kill -9 <PID>
```

### Không thấy tunnel URL

```bash
# Wait 10 seconds
sleep 10

# Check logs
docker-compose -f docker-compose.quick.yml logs cloudflared

# Restart cloudflared
docker-compose -f docker-compose.quick.yml restart cloudflared
```

## 🎯 Complete Example

```bash
# Complete workflow
cd /home/bao/Downloads/mcp-thesis/mcp-thesis

# Setup (if needed)
nano .env  # Add GEMINI_API_KEY

# Start
docker-compose -f docker-compose.quick.yml up -d --build

# Wait 10 seconds
sleep 10

# Get URL
docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare

# Test
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq

# View logs
docker-compose -f docker-compose.quick.yml logs -f
```

## 📖 More Info

- Full guide: `START.md`
- All commands: `docker-compose -f docker-compose.quick.yml help`

---

**🎉 Xong! Server đã online!** 🚀

**Recommended:** Run `./setup.sh` để bắt đầu với wizard!
