# 📖 TÓM TẮT: Validation & Scoring System

## 🎯 Hệ Thống Là Gì?

MCP Use Case Validation System đánh giá **chất lượng** của use case dựa trên **nhiều tiêu chí** và cho điểm từ **0-100**.

```
Threshold: Score ≥ 80 = PASS ✅
          Score < 80 = FAIL ❌ (cần improve)
```

---

## 📊 Ý Nghĩa Điểm Số

### **Cách Hiểu "35/100" và "88/100"**

Có 2 cách hiểu:

#### **Cách 1: Điểm của 1 use case**

- **35/100** = Use case chất lượng thấp (thiếu thông tin)
- **88/100** = Use case chất lượng cao (đầy đủ thông tin)

#### **Cách 2: Tỷ lệ pass trong 100 test cases** ⭐

Nếu chạy **100 use cases** khác nhau:

**Scenario A: Input chất lượng thấp**

```
100 use cases → 35 pass (≥80 điểm) = 35% pass rate
```

**Scenario B: Input chất lượng cao (sau improve)**

```
100 use cases → 88 pass (≥80 điểm) = 88% pass rate
```

**Improvement: 35% → 88% (tăng 2.5×)**

---

## ⚙️ Công Thức Tính Điểm

```typescript
Overall Score = (WeightedSum × 100) - StructuralPenalty
```

### **Weighted Components:**

| Component            | Weight     | Description                         |
| -------------------- | ---------- | ----------------------------------- |
| Name Quality         | 5%         | Verb-noun pattern, uniqueness       |
| Summary Coverage     | 12%        | Meaningful words ratio              |
| Pre/Post Conditions  | 8%         | Has preconditions/postconditions    |
| Actor Participation  | 16%        | Steps mention actors (12% + 4%)     |
| **Process Patterns** | **20%** ⭐ | **Input/Validate/Persist/Feedback** |
| Flow Level Checks    | 8%         | Trigger, ending, numbering          |
| **Branch Flows**     | **18%**    | **Alt/Exception flows**             |
| Loop Handling        | 5%         | Loop conditions and spans           |
| No Fluff Terms       | 8%         | Avoid "etc.", "something"           |
| **Total**            | **100%**   |                                     |

### **Structural Penalties:**

- Duplicate step IDs: **-15 points**
- Orphaned flows: **-20 points** each
- Invalid resume steps: **-10 points**
- Missing conditions: **-8 points** each

---

## 🔍 Ví Dụ Cụ Thể

### **Example 1: Poor Use Case → 35/100 ❌**

**Input:**

```
"User login"
```

**Problems:**

```
❌ No preconditions
❌ No postconditions
❌ No alternative flows
❌ No exception flows
❌ Missing validation steps
❌ Missing persistence steps
❌ Missing feedback steps
❌ Vague descriptions
```

**Score Calculation:**

```
Name:           0.05 × 0.0  = 0.00  (no verb-noun)
Summary:        0.12 × 0.33 = 0.04  (33% coverage)
Pre/Post:       0.08 × 0.0  = 0.00  (missing)
Actor:          0.16 × 0.67 = 0.11  (67% participation)
Process:        0.20 × 0.25 = 0.05  (only input, 25%)
Flow:           0.08 × 0.67 = 0.05  (no trigger/ending)
Branch:         0.18 × 0.0  = 0.00  (no alt/exception)
Loop:           0.05 × 0.0  = 0.00  (no loops)
Fluff:          0.08 × 1.0  = 0.08  (no fluff)
                            ─────
Total:                        0.33
Score:          0.33 × 100  = 33/100
Penalty:        0
Final:          33/100 ❌ FAIL
```

---

### **Example 2: Good Use Case → 88/100 ✅**

**Input:**

```yaml
Use case: Login to Banking System

Description: Detailed description...

Preconditions:
  - Customer has valid account
  - System is operational
  - Database connection active

Postconditions:
  - Customer authenticated
  - Session created
  - Dashboard displayed

Main Flow: (12 steps)
  1. Customer navigates to page (INPUT)
  2. System displays form (FEEDBACK)
  3. Customer enters username (INPUT)
  4. Customer enters password (INPUT)
  5. Customer clicks Login (INPUT)
  6. System validates format (VALIDATION)
  7. System checks credentials (VALIDATION)
  8. System creates session (PERSISTENCE)
  9. System logs event (PERSISTENCE)
  10. System loads dashboard (VALIDATION)
  11. System displays welcome (FEEDBACK)
  12. Use case ends

Alternative Flow 1: Invalid Username
  Condition: Format invalid
  Resume: step 3

Alternative Flow 2: Invalid Password
  Condition: Password incorrect
  Resume: step 4

Exception Flow 1: Account Locked
  Condition: Failed attempts ≥ 3
  End: Use case ends
```

**Improvements:**

```
✅ Has preconditions (3 items)
✅ Has postconditions (3 items)
✅ Has alternative flows (2 flows)
✅ Has exception flows (1 flow)
✅ All 4 process patterns covered
✅ All steps mention actors
✅ Clear trigger and ending
✅ Conditions specified
```

**Score Calculation:**

```
Name:           0.05 × 1.0  = 0.05  (verb-noun ✓)
Summary:        0.12 × 0.85 = 0.10  (85% coverage)
Pre/Post:       0.08 × 0.90 = 0.07  (complete)
Actor:          0.16 × 1.0  = 0.16  (100% participation)
Process:        0.20 × 0.92 = 0.18  (92% all patterns)
Flow:           0.08 × 1.0  = 0.08  (all checks pass)
Branch:         0.18 × 0.85 = 0.15  (alt+exception)
Loop:           0.05 × 0.0  = 0.00  (not needed)
Fluff:          0.08 × 1.0  = 0.08  (no fluff)
                            ─────
Total:                        0.87
Score:          0.87 × 100  = 87/100
Penalty:        0
Final:          87/100 ✅ PASS
```

---

## 🚀 Cách Test & Check Score

### **Option 1: Automated Test Script**

```bash
# Start server
npm run dev

# Run test (terminal mới)
./check-score.sh
```

### **Option 2: Manual Test**

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
      "arguments":{"input":"YOUR USE CASE HERE"}
    },
    "id":1
  }'

# 2. Validate & get score
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"validateUseCase",
      "arguments":{"extractedJsonString":"<JSON_FROM_STEP1>"}
    },
    "id":2
  }' | jq '.result.content[0].text | fromjson'
```

---

## 📈 Làm Thế Nào Để Đạt 80+ Điểm?

### **Top 3 Priorities (chiếm 54% tổng điểm):**

#### **1. Process Patterns (20%)** ⭐ **QUAN TRỌNG NHẤT**

```
Ensure all 4 patterns:
  ✅ INPUT:       User enters/selects/provides data
  ✅ VALIDATION:  System validates/checks/verifies
  ✅ PERSISTENCE: System saves/stores/updates database
  ✅ FEEDBACK:    System displays/shows/informs result
```

#### **2. Branch Flows (18%)** ⭐

```
Add flows:
  ✅ Alternative Flow: Handle valid alternatives
  ✅ Exception Flow: Handle errors
  ✅ Conditions: Specify when branch triggers
  ✅ Resume/End: Specify where flow continues
```

#### **3. Actor Participation (16%)**

```
  ✅ Mention actor in EVERY step
  ✅ Include "System" as actor
  ✅ Be consistent with names
```

### **Other Important Items:**

- **Summary (12%)**: Detailed, specific descriptions
- **Pre/Post (8%)**: At least 3 items each
- **Flow Checks (8%)**: Trigger, ending, numbering
- **Name (5%)**: Verb-noun pattern
- **No Fluff (8%)**: Avoid vague terms

---

## 🎓 Documentation

| File                         | Purpose                          |
| ---------------------------- | -------------------------------- |
| `SCORING_GUIDE.md`           | Detailed algorithm & examples    |
| `SCORE_CHECKING_GUIDE.md`    | Quick start & troubleshooting    |
| `check-score.sh`             | Interactive score checker script |
| `test-validation-scoring.sh` | Automated test (35→88)           |

---

## 💡 Key Takeaways

1. **Scoring = Completeness Measurement**

   - More details → Higher score

2. **35% vs 88% Pass Rate**

   - Low quality inputs: 35% pass
   - High quality inputs: 88% pass
   - **2.5× improvement**

3. **Focus on Heavy Weights**

   - Process Patterns: 20%
   - Branch Flows: 18%
   - Actor Participation: 16%
   - **Total: 54% of score**

4. **Structural Penalties Hurt**

   - Fix errors before optimizing quality
   - Orphaned flows: -20 each
   - Missing conditions: -8 each

5. **Testing Workflow**
   ```
   Extract → Validate → Check Score → Improve → Re-validate
   ```

---

**Created:** December 4, 2025  
**Version:** 1.0
