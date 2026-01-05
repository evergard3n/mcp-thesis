# 🎯 Cách Kiểm Tra Điểm Số Use Case

## Quick Start

### 1️⃣ Start MCP Server

```bash
npm run dev
```

### 2️⃣ Run Score Checker

```bash
# Terminal mới
./check-score.sh
```

## 📊 Kết Quả Mong Đợi

Script sẽ test 2 use cases:

### ❌ **Poor Use Case** (Score: ~35/100)

```
Input: "User login"

Problems:
├─ No preconditions/postconditions
├─ Missing alternative flows
├─ No exception handling
├─ Incomplete process patterns
└─ Vague descriptions

Score: 35/100 ❌ FAIL
```

### ✅ **Good Use Case** (Score: ~88/100)

```
Input: Complete login use case with:
       - Preconditions (3 items)
       - Postconditions (3 items)
       - Main flow (12 detailed steps)
       - Alternative flows (2 flows)
       - Exception flows (1 flow)
       - All process patterns covered

Score: 88/100 ✅ PASS
```

## 📈 Score Breakdown

| Component            | Weight     | Poor    | Good    |
| -------------------- | ---------- | ------- | ------- |
| Name Quality         | 5%         | ❌      | ✅      |
| Summary Coverage     | 12%        | 33%     | 85%     |
| Pre/Post Conditions  | 8%         | ❌      | ✅      |
| Actor Participation  | 16%        | 67%     | 100%    |
| **Process Patterns** | **20%** ⭐ | **25%** | **92%** |
| Flow Level Checks    | 8%         | 67%     | 100%    |
| **Branch Flows**     | **18%**    | **0%**  | **85%** |
| Loop Handling        | 5%         | 0%      | 0%      |
| No Fluff Terms       | 8%         | ✅      | ✅      |
| **Total**            | **100%**   | **35**  | **88**  |

## 🎓 Ý Nghĩa Điểm Số

### **35/100 nghĩa là gì?**

Nếu bạn chạy **100 use cases** với chất lượng thấp (thiếu thông tin):

- Chỉ **35 use cases** sẽ pass (≥80 điểm)
- **65 use cases** sẽ fail (<80 điểm)
- **Pass rate: 35%**

### **88/100 nghĩa là gì?**

Nếu bạn chạy **100 use cases** với chất lượng cao (đầy đủ thông tin):

- **88 use cases** sẽ pass (≥80 điểm)
- **12 use cases** sẽ fail (<80 điểm)
- **Pass rate: 88%**

### **Improvement Factor**

```
Before: 35% pass rate
After:  88% pass rate
Improvement: 2.5× (88/35 = 2.51)
```

## 📚 Chi Tiết Scoring Algorithm

Đọc file [`SCORING_GUIDE.md`](./SCORING_GUIDE.md) để hiểu:

- Công thức tính điểm chi tiết
- Từng thành phần đóng góp bao nhiêu %
- Cách cải thiện điểm số
- Ví dụ cụ thể

## 🛠️ Manual Testing

Nếu muốn test use case của riêng bạn:

```bash
# 1. Extract use case
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"extractUseCase",
      "arguments":{
        "input":"YOUR USE CASE DESCRIPTION HERE"
      }
    },
    "id":1
  }' | jq -r '.result.content[0].text'

# 2. Copy the JSON from <useCase>...</useCase>

# 3. Validate và get score
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"validateUseCase",
      "arguments":{
        "extractedJsonString":"<PASTE JSON HERE>"
      }
    },
    "id":2
  }' | jq '.'
```

## 🎯 Tips Để Đạt 80+ Điểm

1. ✅ **Process Patterns (20%)** - Quan trọng nhất!

   - Include: Input → Validation → Persistence → Feedback

2. ✅ **Branch Flows (18%)** - Quan trọng thứ 2!

   - Add alternative flows với conditions
   - Add exception flows

3. ✅ **Actor Participation (16%)**

   - Mention actor trong MỌI step

4. ✅ **Summary (12%)**

   - Write detailed summary với domain terms

5. ✅ **Pre/Post (8%)**
   - List ít nhất 3 preconditions
   - List ít nhất 3 postconditions

## 📞 Troubleshooting

### Server không chạy?

```bash
# Check port 3000
lsof -i :3000

# Kill nếu cần
kill -9 <PID>

# Start lại
npm run dev
```

### jq không có?

```bash
# Ubuntu/Debian
sudo apt install jq

# macOS
brew install jq
```

### bc không có?

```bash
# Ubuntu/Debian
sudo apt install bc

# macOS
brew install bc
```

---

**Last Updated:** December 4, 2025
