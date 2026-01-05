# 📊 Use Case Scoring System - Chi Tiết

## 🎯 Tổng Quan

Hệ thống scoring đánh giá **chất lượng** của một use case từ **0-100 điểm**.

```
Threshold: ≥80 điểm = PASS ✅
          <80 điểm = FAIL ❌ (cần improve)
```

---

## 📐 Công Thức Tính Điểm

### **Overall Score Formula:**

```typescript
Overall Score = (WeightedSum × 100) - StructuralPenalty

WeightedSum =
  0.05 × nameScore              // 5%  - Name quality
  + 0.12 × summaryCoverage      // 12% - Summary coverage
  + 0.08 × prePostScore         // 8%  - Pre/Post conditions
  + 0.12 × actorParticipation   // 12% - Actor participation
  + 0.04 × hasMainActorSteps    // 4%  - Main actor in steps
  + 0.20 × processPatternCoverage // 20% - Process patterns ⭐ HIGHEST
  + 0.08 × flowLevelScore       // 8%  - Flow level checks
  + 0.18 × branchScore          // 18% - Branch flows
  + 0.05 × loopScore            // 5%  - Loop handling
  + 0.08 × fluffPenalty         // 8%  - No fluff terms

StructuralPenalty = Sum of structural errors (0-100)
```

---

## 🔍 Chi Tiết Từng Thành Phần

### **1. Name Score (5%)**

```typescript
nameScore =
  0.5 × hasUniqueName        // Tên unique trong project?
  + 0.5 × hasVerbNounPattern // Có format "Verb + Noun"?

✅ Good Examples:
  - "Login to System"
  - "Create Order"
  - "Update Profile"
  - "Delete Account"

❌ Bad Examples:
  - "Login" (duplicate)
  - "System Login" (noun first)
  - "The user logs in" (not verb-noun)
```

### **2. Summary Coverage (12%)**

```typescript
summaryCoverage =
  (meaningfulWords in summary) / (total meaningful words)

Meaningful = words NOT in stopwords list
Stopwords: the, and, for, with, that, this, from, etc.

Example:
Input: "This is a system for user login authentication"
- Total words: 8
- Stopwords: "This", "is", "a", "for" = 4
- Meaningful: "system", "user", "login", "authentication" = 4
- Coverage: 4/8 = 0.5 = 50%

✅ Good: Detailed summary with specific terms
❌ Bad: Short, vague summary
```

### **3. Pre/Post Score (8%)**

```typescript
prePostScore =
  0.5 × (hasPreconditions ? 1 : 0)
  + 0.25 × preCoverage
  + 0.25 × postCoverage

preCoverage = meaningfulWords(preconditions) / totalWords
postCoverage = meaningfulWords(postconditions) / totalWords

✅ Good:
Preconditions:
  - User must have a valid account
  - System is operational
  - Database connection is active

Postconditions:
  - User session is created
  - Login event is logged
  - Dashboard is displayed

❌ Bad:
Preconditions: (empty or "None")
Postconditions: (empty or "Success")
```

### **4. Actor Participation (12%)**

```typescript
actorParticipation =
  (steps with actor mentions) / (total steps)

Example Main Flow with 10 steps:
Step 1: Customer enters username    ← "Customer" mentioned
Step 2: System validates input       ← "System" mentioned
Step 3: Customer enters password     ← "Customer" mentioned
...
Step 10: System displays dashboard   ← "System" mentioned

If 8/10 steps mention actors → 0.8 = 80%
```

### **5. Process Pattern Coverage (20%)** ⭐ **MOST IMPORTANT**

```typescript
processPatternCoverage =
  0.25 × inputCoverage      // User provides data
  + 0.25 × validationCoverage // System checks data
  + 0.25 × persistenceCoverage // Save to database
  + 0.25 × feedbackCoverage   // Show result to user

Each coverage = (steps with pattern verbs) / (total steps)

Verb Categories:
• Input: enter, fill, type, select, choose, upload, provide
• Validation: validate, check, verify, ensure
• Persistence: save, store, update, create, persist, record
• Feedback: display, show, inform, return, respond, notify, confirm

✅ Complete Flow Example (100% coverage):
Step 1: User enters email (INPUT)
Step 2: User enters password (INPUT)
Step 3: System validates credentials (VALIDATION)
Step 4: System saves login event (PERSISTENCE)
Step 5: System displays dashboard (FEEDBACK)

❌ Incomplete Example (25% coverage):
Step 1: User enters email (INPUT only)
Step 2: System processes request (vague - no pattern)
```

### **6. Flow Level Score (8%)**

```typescript
flowLevelScore =
  0.3 × (hasTriggerEvent ? 1 : 0)
  + 0.3 × (hasDefiniteEnding ? 1 : 0)
  + 0.4 × (hasValidStepNumbering ? 1 : 0)

✅ Good:
- Trigger: "User clicks Login button" (clear trigger)
- Ending: "System displays dashboard" or "Use case ends" (clear ending)
- Numbering: 1, 2, 3, 4... (no gaps, no duplicates)

❌ Bad:
- No trigger mentioned
- Ends abruptly without clear state
- Numbering: 1, 2, 2, 5... (duplicate or gaps)
```

### **7. Branch Score (18%)** ⭐ **SECOND HIGHEST**

```typescript
branchScore =
  0.2 × (hasAlternativeFlow ? 1 : 0)
  + 0.2 × (hasExceptionFlow ? 1 : 0)
  + 0.2 × branchAnchoringCoverage
  + 0.25 × altFlowConditionCoverage
  + 0.15 × altFlowResumeCoverage

branchAnchoringCoverage =
  (main steps with branches) / (total main steps)

altFlowConditionCoverage =
  (alt flows with condition) / (total alt flows)

✅ Complete Example:
Main Flow (10 steps):
Step 6: System validates password
  └─ Alt Flow 1: Invalid Password (anchored at step 6) ✓
  └─ Exception Flow 1: System Error (anchored at step 6) ✓

Alt Flow 1: Invalid Password
Condition: Password doesn't match ✓
Steps: ... ✓
Resume: Resume at step 4 ✓

Score Calculation:
- hasAlternativeFlow: YES = 1
- hasExceptionFlow: YES = 1
- branchAnchoringCoverage: 1/10 = 0.1
- altFlowConditionCoverage: 1/1 = 1.0
- altFlowResumeCoverage: 1/1 = 1.0

branchScore = 0.2×1 + 0.2×1 + 0.2×0.1 + 0.25×1 + 0.15×1
            = 0.2 + 0.2 + 0.02 + 0.25 + 0.15
            = 0.82 = 82%
```

### **8. Loop Score (5%)**

```typescript
loopScore =
  0.4 × (hasLoop ? 1 : 0)
  + 0.3 × loopConditionCoverage
  + 0.3 × loopSpanCoverage

✅ Good:
Step 5: System attempts connection (max 3 times)
  Loop condition: Retry if connection fails AND attempts < 3
  Loop span: Repeat steps 5-7

❌ Bad: No loop handling mentioned
```

### **9. Fluff Penalty (8%)**

```typescript
fluffPenalty = NO fluff terms found ? 1 : 0

Fluff Terms to Avoid:
- "etc.", "etc"
- "and so on"
- "something"
- "some data"
- "..."

✅ Good: "System validates email format"
❌ Bad: "System validates email, etc."
```

### **10. Structural Penalty (Variable Deduction)**

```typescript
structuralPenalty = Sum of errors:

Errors:
- Duplicate step IDs in main flow: -15 points
- Orphaned flows (no anchor step): -20 points each
- Invalid resume step in alt flow: -10 points
- Alt flow without condition: -8 points each
- Loop without condition: -8 points each

Example:
If use case has:
- 2 orphaned flows: -40
- 1 missing condition: -8
Total penalty: -48 points
```

---

## 📈 Scoring Examples

### **Example 1: Poor Use Case (Score: 35/100)**

```yaml
Name: "Login"
Summary: "User login"
Preconditions: (empty)
Postconditions: (empty)
Actors: [User, System]
Main Flow: 1. User enters credentials
  2. System checks
  3. Success
Alternative Flows: (none)
Exception Flows: (none)
```

**Score Breakdown:**

```
nameScore:              0.0  (duplicate name, no verb-noun)
  → 0.05 × 0.0 =        0.00

summaryCoverage:        0.33 (2 meaningful / 6 total)
  → 0.12 × 0.33 =       0.04

prePostScore:           0.0  (no preconditions/postconditions)
  → 0.08 × 0.0 =        0.00

actorParticipation:     0.67 (2/3 steps mention actors)
  → 0.12 × 0.67 =       0.08

hasMainActorSteps:      1.0  (user appears in steps)
  → 0.04 × 1.0 =        0.04

processPatternCoverage: 0.25 (only input, no validation/persist/feedback)
  → 0.20 × 0.25 =       0.05

flowLevelScore:         0.67 (valid numbering, no trigger/ending)
  → 0.08 × 0.67 =       0.05

branchScore:            0.0  (no alt/exception flows)
  → 0.18 × 0.0 =        0.00

loopScore:              0.0  (no loops)
  → 0.05 × 0.0 =        0.00

fluffPenalty:           1.0  (no fluff)
  → 0.08 × 1.0 =        0.08

WeightedSum:            0.34
Overall0to1:            0.34
Overall:                34 × 100 = 34/100
StructuralPenalty:      0

Final Score: 34/100 ❌ FAIL
```

---

### **Example 2: Good Use Case (Score: 88/100)**

```yaml
Name: "Login to Banking System"
Summary: "This use case allows a registered customer to securely login..."
Preconditions:
  - Customer must have valid account
  - System is operational
  - Database connection active
Postconditions:
  - Customer authenticated
  - Session created
  - Dashboard displayed
Actors: [Customer, System, Database]
Main Flow: (12 steps with all patterns)
  1. Customer navigates to login page (INPUT)
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

Alternative Flows:
  - Alt Flow 1: Invalid Username (at step 6)
    Condition: Username format invalid
    Steps: ...
    Resume: step 3

  - Alt Flow 2: Invalid Password (at step 7)
    Condition: Password incorrect
    Steps: ...
    Resume: step 4

Exception Flows:
  - Exception 1: Account Locked (from Alt 2)
    Condition: Failed attempts >= 3
    Steps: ...
    End: Use case ends
```

**Score Breakdown:**

```
nameScore:              1.0  (unique + verb-noun pattern)
  → 0.05 × 1.0 =        0.05

summaryCoverage:        0.85 (17 meaningful / 20 total)
  → 0.12 × 0.85 =       0.10

prePostScore:           0.90 (has pre/post with good coverage)
  → 0.08 × 0.90 =       0.07

actorParticipation:     1.0  (12/12 steps mention actors)
  → 0.12 × 1.0 =        0.12

hasMainActorSteps:      1.0  (customer appears)
  → 0.04 × 1.0 =        0.04

processPatternCoverage: 0.92 (all 4 patterns well represented)
  → 0.20 × 0.92 =       0.18

flowLevelScore:         1.0  (has trigger, ending, valid numbering)
  → 0.08 × 1.0 =        0.08

branchScore:            0.85 (has alt/exception, conditions, anchors)
  → 0.18 × 0.85 =       0.15

loopScore:              0.0  (no loops needed)
  → 0.05 × 0.0 =        0.00

fluffPenalty:           1.0  (no fluff)
  → 0.08 × 1.0 =        0.08

WeightedSum:            0.87
Overall0to1:            0.87
Overall:                87 × 100 = 87/100
StructuralPenalty:      0

Final Score: 87/100 ✅ PASS
```

---

## 🚀 Cách Áp Dụng Validation

### **Method 1: Via MCP Tools (Recommended)**

```bash
# Step 1: Start server
npm run dev

# Step 2: Extract use case
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"extractUseCase",
      "arguments":{
        "input":"Your use case description here..."
      }
    },
    "id":1
  }'

# Step 3: Validate (get score)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"validateUseCase",
      "arguments":{
        "extractedJsonString":"<extracted_json_from_step2>"
      }
    },
    "id":2
  }'
```

### **Method 2: Via Test Script**

```bash
# Run pre-made test
./test-validation-scoring.sh

# Or create your own test
./my-custom-test.sh
```

### **Method 3: Programmatically**

```typescript
import { scoreUseCaseTerms } from "./src/validators/flat.validator.js";
import { genUseCaseSchema } from "./src/schemas/genusecase.schema.js";

// Parse your use case
const useCase = genUseCaseSchema.parse(yourUseCaseJson);

// Get score
const score = scoreUseCaseTerms(useCase, projectStore);

console.log(`Overall Score: ${score.overall}/100`);
console.log(`Process Pattern Coverage: ${score.processPatternCoverage * 100}%`);
console.log(`Branch Score: ${score.branchScore * 100}%`);

// Check if pass
if (score.overall >= 80) {
  console.log("✅ PASS - High quality use case!");
} else {
  console.log("❌ FAIL - Needs improvement");
  console.log(`Missing: ${80 - score.overall} points`);
}
```

---

## 📚 Tips to Improve Score

### **To reach 80+ score, ensure:**

1. ✅ **Name** (5%):

   - Use unique name
   - Follow "Verb + Noun" pattern
   - Examples: "Create Order", "Update Profile"

2. ✅ **Summary** (12%):

   - Write detailed, specific summary
   - Include key terms and domain concepts
   - Avoid generic words

3. ✅ **Preconditions/Postconditions** (8%):

   - List at least 3 preconditions
   - List at least 3 postconditions
   - Be specific and measurable

4. ✅ **Process Patterns** (20%) ⭐ **CRITICAL**:

   - Include INPUT steps (user enters data)
   - Include VALIDATION steps (system checks)
   - Include PERSISTENCE steps (save to DB)
   - Include FEEDBACK steps (show result)

5. ✅ **Branch Flows** (18%):

   - Add at least 1 alternative flow
   - Add at least 1 exception flow
   - Specify conditions clearly
   - Anchor to main flow steps
   - Specify resume points

6. ✅ **Actors** (16%):

   - Mention actors in EVERY step
   - Include "System" as actor
   - Be consistent with actor names

7. ✅ **Flow Structure** (8%):

   - Define trigger event
   - End with clear state
   - Number steps sequentially (1, 2, 3...)

8. ✅ **Avoid Fluff** (8%):
   - Don't use "etc.", "and so on"
   - Be specific, not vague
   - No "something", "some data"

---

## 🎓 Recommended Reading Order

1. Read this guide (SCORING_GUIDE.md)
2. Run `./test-validation-scoring.sh` to see examples
3. Check `src/validators/flat.validator.ts` for implementation
4. Try creating your own use cases and validate them
5. Iterate based on feedback to reach 80+ score

---

**Last Updated:** December 4, 2025
