# Codebase Map — mcp-thesis

> Tài liệu này mô tả toàn bộ các cụm chức năng chính, file chứa, trách nhiệm, thứ tự xử lý nội bộ, và nơi lưu output.

---

## Mục lục

1. [Data Model (Kiểu dữ liệu cốt lõi)](#1-data-model)
2. [Entry Point & API Routes](#2-entry-point--api-routes)
3. [Session Management](#3-session-management)
4. [HITL Orchestrator (State Machine)](#4-hitl-orchestrator)
5. [HITL Core Loop](#5-hitl-core-loop)
6. [Iteration Pipeline (1 vòng lặp)](#6-iteration-pipeline)
7. [Services](#7-services)
8. [Analyzers](#8-analyzers)
9. [Validators](#9-validators)
10. [Stores & Persistence](#10-stores--persistence)
11. [Tools (Project & Testing)](#11-tools)
12. [Evaluator](#12-evaluator)
13. [Data Files (Static)](#13-data-files-static)
14. [Luồng dữ liệu tổng thể](#14-luồng-dữ-liệu-tổng-thể)
15. [Output Files — Lưu ở đâu?](#15-output-files)

---

## 1. Data Model

**File:** `src/interfaces/usecase.interface.new.ts`

**Tại sao tồn tại:**
Không có LLM nào tự dưng trả về cùng 1 format — hệ thống cần 1 schema JSON thống nhất để tất cả services (generate, refine, validate, evaluate) có thể trao đổi dữ liệu mà không cần convert. `GenUseCase` là định nghĩa "ngôn ngữ chung" đó. File `.new.ts` là phiên bản mới thay thế `usecase.interface.ts` cũ (schema cũ dùng bởi `projectStore`).

**Ai phụ thuộc vào đây:**
- **Tất cả** — không có module nào không dùng `GenUseCase`/`GenFlow`/`GenStep`
- `usecase.service.ts` → generate và return `GenUseCase`
- `flat.validator.ts`, `llm.validator.ts` → validate input là `GenUseCase`
- `gap.analyzer.ts`, `uncertainty.ranker.ts`, `blueprint.detector.ts` → analyze `GenUseCase`
- `hitl.core.ts`, `hitl.orchestrator.ts` → lưu và truyền `GenUseCase` qua các iterations
- `three-tier.evaluator.ts` → so sánh `GenUseCase` với ground truth
- `schemas/genusecase.schema.ts` → Zod version của interface này, dùng để parse + validate LLM output

Đây là kiểu dữ liệu trung tâm của toàn bộ hệ thống. Mọi thứ đều xoay quanh `GenUseCase`.

```
GenUseCase
├── name: string
├── summary: string
├── mainActor: string
├── actors: string[]
├── preconditions?: string[]
├── postconditions?: string[]
├── flows: GenFlow[]          ← danh sách luồng (MAIN + ALT + EXT)
└── loops?: GenLoop[]

GenFlow
├── id: "MAIN" | "EXT_1a" | "ALT_2b" | ...
├── kind: "MAIN" | "ALTERNATIVE" | "EXCEPTION"
├── parentFlow?: "MAIN"
├── fromStepIndex?: number    ← bước nào ở MAIN nó tách ra
├── condition?: string
└── steps: GenStep[]

GenStep
├── index: number             ← 1-based, trong flow đó
├── actor: string
├── target?: string
└── description: string
```

**Naming convention flow ID:**
- MAIN: luôn là `"MAIN"`
- Exception từ step 2: `EXT_2a`, `EXT_2b`, ...
- Nested exception: `EXT_1a.2a`

**File schema Zod:** `src/schemas/genusecase.schema.ts`

---

## 2. Entry Point & API Routes

**File:** `src/index.ts`

**Tại sao tồn tại:**
Là duy nhất điểm vào của server — nhận HTTP request, xác thực schema đầu vào (Zod `safeParse`), tra cứu session, rồi delegate sang tools/orchestrator. Tập trung validation và error handling ở 1 nơi thay vì rải trong từng service.

**Ai phụ thuộc vào đây:**
- Frontend (`mcp-thesis-fe`) gọi tất cả routes này
- Test scripts (`test-scripts/`) gọi trực tiếp các endpoint `/testing/*`
- Không có module nội bộ nào import `index.ts` — đây là leaf của dependency tree từ phía server

Express server, port mặc định `3006`. Khởi động model embedding ngay lúc boot (`semanticService` singleton tự `init()`).

### Các route chính

| Method | Path | Chức năng |
|--------|------|-----------|
| `POST` | `/sessions` | Tạo session mới → trả `sessionId` |
| `DELETE` | `/sessions/:sessionId` | Xóa session |
| `GET` | `/sessions/:sessionId/state` | Lấy toàn bộ `HITLState` của session |
| `GET` | `/sessions/:sessionId/hitl/stream` | **SSE stream** — lắng nghe event realtime từ orchestrator |
| `POST` | `/sessions/:sessionId/hitl/start` | Bắt đầu vòng lặp HITL |
| `POST` | `/sessions/:sessionId/hitl/submit-answers` | Gửi câu trả lời (interactive mode) |
| `POST` | `/sessions/:sessionId/hitl/cancel` | Hủy vòng lặp |
| `POST` | `/sessions/:sessionId/projects` | Init project |
| `GET` | `/sessions/:sessionId/projects` | List all projects |
| `POST` | `/sessions/:sessionId/projects/load` | Load project by name |
| `PUT` | `/sessions/:sessionId/projects/switch` | Switch active project |
| `DELETE` | `/sessions/:sessionId/projects/:projectId` | Xóa project |
| `POST` | `/sessions/:sessionId/testing/prepare-test-data` | Tạo dataset từ text ground truth |
| `POST` | `/sessions/:sessionId/testing/embed-dataset` | Embed ground truth flows |
| `POST` | `/sessions/:sessionId/testing/run-hitl-comparison` | Chạy thử nghiệm so sánh A/B |
| `POST` | `/sessions/:sessionId/testing/evaluate-results` | Đánh giá kết quả raw |

**SSE Events** (stream từ `/hitl/stream`):
- `state` — snapshot trạng thái đầy đủ
- `status_change` — thay đổi phase (GENERATING_BASELINE → PROBING_BLUEPRINTS → ANALYZING_GAPS → GENERATING_QUESTIONS → WAITING_FOR_ANSWERS → REFINING → DONE)
- `questions` — danh sách câu hỏi mới cho iteration
- `done` — kết thúc
- `error` — lỗi

---

## 3. Session Management

**File:** `src/session/session.manager.ts`

**Tại sao tồn tại:**
Mỗi HTTP request cần tìm đúng orchestrator và store của mình mà không bị cross-contamination giữa các users/clients. `SessionManager` là nơi duy nhất tạo và giữ references đến các object per-session (`HITLOrchestrator`, `JsonProjectStore`, `GeminiOpenRouterFunctions`). Nếu không có layer này, `index.ts` sẽ phải tự quản lý Map này + khởi tạo dependencies — vi phạm SRP.

**Ai phụ thuộc vào đây:**
- `src/index.ts` — duy nhất consumer; gọi `createSession()`, `getSession()`, `deleteSession()` trên mọi request

Quản lý `Map<sessionId, SessionContext>` trong memory (không persist).

```
SessionManager
├── createSession()
│   ├── randomUUID() → sessionId
│   ├── new JsonProjectStore(sessionId)    ← project store
│   ├── new GeminiOpenRouterFunctions(...)  ← LLM client
│   └── new HITLOrchestrator(sessionId, geminiFunctions)
├── getSession(sessionId) → SessionContext | null
└── deleteSession(sessionId) → calls hitl.cancel()
```

**SessionContext** (in-memory):
```ts
{
  sessionId: string,
  projectStore: JsonProjectStore,   // Firebase-backed
  geminiFunctions: GeminiOpenRouterFunctions,
  hitl: HITLOrchestrator,
  createdAt: string
}
```

---

## 4. HITL Orchestrator

**File:** `src/orchestrator/hitl.orchestrator.ts`
**State type:** `src/orchestrator/hitl.state.ts`

**Tại sao tồn tại:**
`runHITLLoop()` trong `hitl.core.ts` là pure logic — nó không biết gì về HTTP, SSE, hay việc có người đang chờ câu trả lời. `HITLOrchestrator` là lớp adapter giữa logic xử lý và thế giới bên ngoài. Nó giải quyết 3 việc mà core loop không thể tự làm:
1. **Async pause/resume** — interactive mode cần tạm dừng loop giữa chừng để chờ human submit answers qua HTTP, cơ chế `Promise` + `waitingResolver` cho phép điều này mà không block event loop
2. **State broadcasting** — push realtime events qua SSE đến tất cả subscribers khi trạng thái thay đổi
3. **Lifecycle guard** — ngăn chạy 2 loop cùng lúc (`this.running`), handle cancel gracefully

**Ai phụ thuộc vào đây:**
- `src/session/session.manager.ts` — tạo 1 instance per session: `new HITLOrchestrator(sessionId, geminiFunctions)`
- `src/index.ts` — gọi `hitl.start()`, `hitl.submitAnswers()`, `hitl.cancel()`, `hitl.subscribe()`, `hitl.getState()` qua `session.hitl`

Orchestrator là lớp **stateful** bao bọc `runHITLLoop`. Nó quản lý:
- State machine (`HITLStatus`)
- Subscriber pattern (SSE event emitter)
- Interactive mode: tạm dừng chờ `submitAnswers()`

### HITLStatus (thứ tự phase)

```
IDLE → GENERATING_BASELINE → PROBING_BLUEPRINTS → ANALYZING_GAPS
     → GENERATING_QUESTIONS → WAITING_FOR_ANSWERS (interactive only)
     → REFINING → (lặp lại từ ANALYZING_GAPS) → DONE | ERROR
```

### Các method chính

| Method | Mô tả |
|--------|-------|
| `start(input)` | Khởi chạy loop async, trả `202` ngay lập tức |
| `submitAnswers(answers)` | Resolve promise đang chờ ở `WAITING_FOR_ANSWERS` |
| `cancel()` | Đặt `this.cancelled = true`, resolve waitingResolver với [] |
| `subscribe(emitter)` | Đăng ký nhận SSE events, trả về unsubscribe fn |
| `getState()` | Trả `HITLState` hiện tại |

### State `HITLState` — các trường quan trọng

| Trường | Ý nghĩa |
|--------|---------|
| `status` | Phase hiện tại |
| `mode` | `"interactive"` hoặc `"automated"` |
| `vague` | Input mô tả mờ nhạt |
| `detailed` | Input chi tiết (automated only hoặc dùng cho expert answering) |
| `currentUseCase` | Use case đang được refine |
| `baselineUseCase` | Use case tạo ra từ vague lúc đầu (không thay đổi) |
| `conversationHistory` | Mảng `InteractionMemory[]` tích lũy qua các iteration |
| `allQuestions` | Tất cả câu hỏi đã hỏi (string[]) |
| `confirmedBlueprintIds` | Blueprints được LLM xác nhận là applicable |
| `droppedBlueprintIds` | Blueprints bị loại bỏ |
| `lastGapAnalysis` | `GapAnalysis` từ iteration cuối |
| `lastUncertaintyAnalysis` | `UncertaintyAnalysis` từ iteration cuối |
| `iterationCount` | Số iteration đã hoàn thành |
| `totalQuestionsAsked` | Tổng câu hỏi đã dùng |

### Flow nội bộ của `runLoop()`

```
start(input)
  → runLoop() [async, non-blocking]
      → runHITLLoop(input, config, answerProvider, callbacks)
          ← callbacks.onPhaseChange → this.transition(phase)
          ← callbacks.onBaseline  → update this.state.currentUseCase/baselineUseCase
          ← callbacks.onProbeComplete → update confirmedBlueprintIds
          ← callbacks.onIterationComplete → update currentUseCase, conversationHistory...
      → this.state.status = "DONE"
      → this.emit({ type: "done" })
```

---

## 5. HITL Core Loop

**File:** `src/orchestrator/hitl.core.ts`

**Tại sao tồn tại:**
Tách logic vòng lặp HITL ra khỏi state management để có thể **reuse** trong 2 context khác nhau mà không duplicate code:
- `HITLOrchestrator` dùng để serve interactive/automated API requests
- `testingTools.ts` dùng để chạy batch evaluation tự động

Nếu nhét hết vào `HITLOrchestrator`, batch testing sẽ phải mock SSE và simulate HTTP — không thực tế. Tách ra còn giúp unit test logic thuần mà không cần mock HTTP layer.

File này cũng chứa các helper functions của iteration: `generateBaseline()`, `probeBlueprints()`, `runIteration()`, `deduplicateFlows()`, `filterUngroundedDeltaFlows()` — tất cả pure async functions không có side effects ngoài LLM calls.

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.orchestrator.ts` — gọi `runHITLLoop()` trong `runLoop()`, và export `probeBlueprints`, `generateBaseline` types
- `src/tools/testingTools.ts` — import `runHITLLoop`, `AnswerProvider`, `HITLLoopResult` trực tiếp

Đây là **logic thuần túy** của vòng lặp — không có state management.
Được dùng bởi cả `HITLOrchestrator` (interactive/automated) và `testingTools.ts` (batch testing).

### Hàm `runHITLLoop(loopInput, config, answerProvider, callbacks?)`

**Thứ tự xử lý:**

```
1. generateBaseline(vague)
   └─ clearGapCentroidsCache()
   └─ generateFlatUseCase({ description: vague, geminiFunctions })
      → LLM tạo GenUseCase từ mô tả mờ nhạt

2. probeBlueprints(baseline, detailed, domain, geminiFunctions)
   ├─ collectStepEmbeddings(useCase)         ← embed tất cả steps
   ├─ classifyUseCaseDomainHybrid(useCase)   ← phân loại domain
   ├─ resolveBlueprintDomainFilter(analysis) ← lọc blueprints theo domain
   ├─ detectActivatedBlueprints(embeddings, filter, ctx)
   │     ← so sánh step embeddings với blueprint role centroids
   └─ probeBlueprintsWithExpert(activations, description, domain, geminiFunctions)
         ← LLM xác nhận từng blueprint có applicable không

3. for iterationIndex = 0..maxIterations-1:
   if totalQuestionsAsked >= maxQuestions: break
   if shouldCancel(): break

   runIteration(...)   ← xem mục 6

   if result.stop == "confidence" | "no_questions": break

   cập nhật: currentUseCase, conversationHistory, allQuestions, totalQuestionsAsked

4. return HITLLoopResult {
     useCase, baseline, iterations, totalQuestionsAsked,
     conversationHistory, probe, lastGapAnalysis, lastUncertaintyAnalysis
   }
```

**Config mặc định:**
- `maxIterations: 5`
- `maxQuestions: 20`
- `perIterationCap: 6` (câu hỏi tối đa mỗi iteration)

---

## 6. Iteration Pipeline

**Hàm:** `runIteration(input)` trong `src/orchestrator/hitl.core.ts`

**Tại sao tồn tại:**
`runHITLLoop` chứa vòng `for` điều phối nhiều iterations — nếu nhét toàn bộ logic 1 iteration vào đó thì function sẽ dài ~500 dòng và không test được độc lập. `runIteration` đóng gói **1 chu kỳ phân tích → hỏi → trả lời → refine** thành 1 unit có input/output rõ ràng. Caller (`runHITLLoop`) chỉ cần biết input là use case hiện tại và output là use case mới + tín hiệu `stop`.

**Ai phụ thuộc vào đây:**
- `runHITLLoop()` trong cùng file — gọi trong mỗi iteration của vòng `for`

Mỗi iteration là một pipeline hoàn chỉnh:

```
Step 1: validateUseCaseWithFeedback(useCase)
   └─ flat.validator.ts → tính UseCaseTermScore (overall 0-100)

Step 2: analyzeGaps(useCase, score, vague, conversationHistory, confirmedBlueprints, ...)
   └─ gap.analyzer.ts
   ├─ chạy tất cả gap detectors (GAP_DETECTORS registry)
   ├─ detectBlueprintGaps (blueprint-specific gaps)
   ├─ classifyUseCaseDomainHybrid (domain detection)
   └─ trả GapAnalysis { gaps, priorityGaps, completenessScore, activatedBlueprints, ... }

Step 3: rankAllUncertainties(useCase, gapAnalysis, score)
   └─ uncertainty.ranker.ts → UncertaintyAnalysis {
        stepUncertainties, flowUncertainties, stepPriorities,
        overallConfidence (0-1), highPriorityCount
      }

Stop check: if overallConfidence >= threshold → stop = "confidence"

Step 4: buildInteractionMemories(questions, answers, iteration)
   └─ memory.builder.ts → embed question + context strings

Step 5: generateAdaptiveQuestions(useCase, gapAnalysis, uncertaintyAnalysis, ...)
   └─ llm.validator.ts → LLM tạo OpenEndedQuestion[] (capped tại perIterationCap)
   Stop check: if no questions → stop = "no_questions"

Step 6: answerProvider(questions, iteration)
   ├─ interactive mode: emit "questions" event → chờ submitAnswers()
   └─ automated mode: expertAnswerOpenEndedQuestions(questions, detailed, domain, geminiFunctions)

Step 7: Phân loại answers:
   ├─ broadAnswers: questionId bắt đầu bằng "global-gap-" hoặc "main-expansion-"
   │                 hoặc steps > BROAD_SCOPE_STEP_THRESHOLD (4)
   └─ stepSpecificAnswers: còn lại

Step 8a: Nếu có broadAnswers:
   refineWithHybridAnswers(useCase, vague, broadAnswers, geminiFunctions)
      → LLM rebuild toàn bộ use case
   filterUngroundedDeltaFlows(deltaFlows, broadAnswers, threshold=0.45)
      → loại bỏ flows không grounded trong answers (chống hallucination)

Step 8b: Nếu có stepSpecificAnswers:
   extractFlowsFromOpenEndedAnswers(answers, useCase, geminiFunctions)
      → LLM extract flows mới
   deduplicateFlows(existingFlows, newFlows, threshold=0.82)
      → loại bỏ flow trùng lặp bằng semantic similarity
   normalizeFlowIds(useCase)
      → chuẩn hóa lại IDs

Step 9: return IterationOutput {
   updatedUseCase, questions, answers, memories,
   gapAnalysis, uncertaintyAnalysis, stop: null
}
```

---

## 7. Services

### 7.1 SemanticService — Embedding

**File:** `src/services/semantic.service.ts`
**Singleton:** `export default semanticService` — load ngay khi import

**Tại sao tồn tại:**
Nhiều nơi trong hệ thống cần so sánh semantic similarity (gap detection, blueprint matching, flow dedup, grounding filter, evaluator) — nếu mỗi nơi tự khởi tạo model riêng thì tốn RAM gấp nhiều lần và có race condition khi load. Singleton pattern đảm bảo model chỉ load **1 lần** vào bộ nhớ và sẵn sàng cho tất cả callers. `waitForReady()` cho phép server chờ model load xong trước khi chấp nhận traffic.

**Ai phụ thuộc vào đây (nhiều nhất trong codebase):**
- `src/analyzers/gap.analyzer.ts` — `collectStepEmbeddings()`, so sánh step vs centroid
- `src/analyzers/blueprint.detector.ts` — embed steps, so sánh với blueprint role centroids
- `src/orchestrator/hitl.core.ts` — `deduplicateFlows()`, `filterUngroundedDeltaFlows()`
- `src/services/domain-classifier.service.ts` — embed actors để classify domain
- `src/evaluators/three-tier.evaluator.ts` — Tier 1 semantic recall
- `src/helpers/memory.builder.ts` — embed question + context strings
- `src/tools/testingTools.ts` — `embedDataset()`

**Model:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (quantized, dim=384)

| Method | Mô tả |
|--------|-------|
| `embed(text)` | Embed 1 string → `number[384]` |
| `embedBatch(texts[])` | Embed nhiều strings cùng lúc → `number[][]` |
| `cosineSimilarity(vecA, vecB)` | Cosine sim (normalized → dot product) |
| `computeCentroid(embeddings[])` | Tính centroid rồi normalize |
| `waitForReady()` | Đợi model load xong (gọi khi khởi động server) |

**Lưu ý:** Model load bất đồng bộ khi import lần đầu. Mọi method đều `await this.readyPromise` trước khi dùng.

---

### 7.2 GeminiOpenRouterFunctions — LLM Client

**File:** `src/services/gemini-openrouter.service.ts`

**Tại sao tồn tại:**
Tất cả LLM calls đều đi qua 1 class duy nhất để dễ swap model/provider mà không sửa logic. `generateStructured` quan trọng hơn `generate` — nó enforce JSON schema response qua OpenRouter API, giúp parse output an toàn mà không cần regex hay try-catch thủ công. Class này cũng là nơi duy nhất cầm API keys, tránh leak ra ngoài.

**Ai phụ thuộc vào đây:**
- `src/session/session.manager.ts` — tạo 1 instance per session: `new GeminiOpenRouterFunctions(geminiKey, openrouterKey)`
- `src/orchestrator/hitl.core.ts` — nhận qua `loopInput.geminiFunctions`, truyền xuống tất cả sub-calls
- `src/services/usecase.service.ts` — `generateFlatUseCase()`, `refineWithHybridAnswers()`, `extractFlowsFromOpenEndedAnswers()`
- `src/validators/llm.validator.ts` — `generateAdaptiveQuestions()`, `expertAnswerOpenEndedQuestions()`, `probeBlueprintsWithExpert()`
- `src/services/domain-classifier.service.ts` — LLM fallback trong hybrid classifier
- `src/evaluators/three-tier.evaluator.ts` — Tier 2 LLM grounding
- `src/tools/testingTools.ts` — `prepareTestData()`, `runHITLComparison()`

Gọi OpenRouter API với model `google/gemini-2.5-flash`.

| Method | Input | Output |
|--------|-------|--------|
| `generate({ prompt })` | string | `string` (raw text) |
| `generateStructured({ prompt, schema })` | string + ZodSchema | `z.infer<T>` — parse JSON response |

`generateStructured` dùng `response_format.json_schema` — OpenRouter enforce output JSON theo Zod schema.

---

### 7.3 UseCaseService — Generate & Refine

**File:** `src/services/usecase.service.ts`

**Tại sao tồn tại:**
Tập trung tất cả **LLM prompts liên quan đến use case** vào 1 file. Lý do tách thành service riêng thay vì để trong `hitl.core.ts`:
- Prompts dài (~100 dòng mỗi cái) — nếu inline vào core thì core khó đọc
- `generateFlatUseCase` được gọi từ nhiều chỗ (`hitl.core.ts` cho baseline, `testingTools.ts` cho prepare test data và detailed baseline) — cần share
- `normalizeFlowIds` là pure function không cần LLM, nhưng liên quan chặt đến flow structure nên đặt ở đây

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — `generateFlatUseCase` (baseline), `refineWithHybridAnswers` (broad answers), `extractFlowsFromOpenEndedAnswers` (step-specific answers), `normalizeFlowIds`
- `src/tools/testingTools.ts` — `generateFlatUseCase` (prepare-test-data ground truth + detailed baseline)

| Hàm | Mô tả |
|-----|-------|
| `generateFlatUseCase({ description, geminiFunctions })` | LLM tạo `GenUseCase` từ text mô tả |
| `refineWithHybridAnswers(useCase, vague, answers, geminiFunctions)` | LLM rebuild use case dựa trên broad answers |
| `extractFlowsFromOpenEndedAnswers(answers, useCase, geminiFunctions)` | LLM extract `GenFlow[]` từ step-specific answers |
| `normalizeFlowIds(useCase)` | Chuẩn hóa flow IDs theo convention (EXT_1a, ALT_2b, ...) |

**Prompt strategy:**
- `generateFlatUseCase`: system prompt phân tích, rules cho cấu trúc JSON, FLOW_ID_CONVENTION
- `refineWithHybridAnswers`: truyền vào use case hiện tại + tất cả broad answers
- `extractFlowsFromOpenEndedAnswers`: per-answer extraction, trả `GenFlow[]`

---

### 7.4 DomainClassifierService — Phân loại Domain

**File:** `src/services/domain-classifier.service.ts`

**Tại sao tồn tại:**
Domain quyết định **blueprint nào được kích hoạt** (human-system blueprints vs system-system blueprints) và ảnh hưởng đến loại questions được generate. Nếu dùng mỗi LLM để classify thì chậm và tốn token — hybrid approach ưu tiên heuristic (nhanh, free) trước, chỉ escalate lên LLM khi thực sự cần. `resolveBlueprintDomainFilter` là bridge quan trọng: convert kết quả phân loại thành filter function mà `blueprint.detector.ts` có thể dùng ngay.

**Ai phụ thuộc vào đây:**
- `src/analyzers/gap.analyzer.ts` — `classifyUseCaseDomainHybrid()` và `resolveBlueprintDomainFilter()` để filter blueprints khi detect gaps
- `src/orchestrator/hitl.core.ts` — `classifyUseCaseDomainHybrid()` trong `probeBlueprints()`
- `src/tools/testingTools.ts` — `classifyUseCaseDomain()` (với LLM) để ghi domain metadata vào raw results

Phân loại use case vào `"human-system"` | `"system-system"` | `"ambiguous"`.
Dùng **hybrid**: heuristic → semantic → LLM fallback.

| Hàm | Mô tả |
|-----|-------|
| `classifyUseCaseDomainHybrid(useCase)` | Multi-phase classifier, trả `UseCaseDomainAnalysis` |
| `classifyUseCaseDomain(useCase, geminiFunctions)` | Full với LLM fallback |
| `resolveBlueprintDomainFilter(analysis)` | Từ domain analysis → filter function dùng trong blueprint detection |

**3 phases:**
1. **Heuristic** (`classifyActorHeuristic`): keyword matching từ `domain-keywords.ts` — compound keywords ưu tiên hơn single
2. **Semantic**: embed actor text → cosine sim với human/system centroids
3. **LLM**: fallback khi heuristic + semantic không đủ confidence

---

### 7.5 BlueprintFamilyService — Family Prediction

**File:** `src/services/blueprint-family.service.ts`

**Tại sao tồn tại:**
`blueprints.json` chứa ~20+ blueprints — nếu chạy semantic matching toàn bộ cho mỗi use case thì tốn thời gian và nhiễu. Family prediction là **pre-filter nhanh bằng keyword**: một use case về insurance claims không cần check blueprint logistics. Đây là optimization layer, không phải core logic — nếu bỏ đi thì hệ thống vẫn chạy đúng nhưng chậm hơn và có nhiều false positive blueprints hơn.

**Ai phụ thuộc vào đây:**
- `src/analyzers/blueprint.detector.ts` — gọi `predictBlueprintFamilies()` và `blueprintMatchesPredictedFamilies()` trong `detectActivatedBlueprints()`

Dự đoán "gia đình" process của use case (claims, purchasing, logistics, web, ...) để lọc blueprints trước khi detect.

| Hàm | Mô tả |
|-----|-------|
| `predictBlueprintFamilies(useCase, originalDescription)` | Keyword scan → `FamilyPrediction { labels: Set<string>, strength: 0-1 }` |
| `blueprintMatchesPredictedFamilies(blueprint, prediction)` | Check blueprint có thuộc predicted families không |

Nếu `strength` thấp → không filter family (full recall).

---

## 8. Analyzers

### 8.1 GapAnalyzer — Phân tích thiếu sót

**File:** `src/analyzers/gap.analyzer.ts`
**Types:** `src/analyzers/gap-detector.types.ts`
**Registry:** `src/analyzers/gap-detectors.registry.ts`

**Tại sao tồn tại:**
Là **não phân tích** của vòng lặp HITL — nếu không có nó, hệ thống không biết use case đang thiếu gì để hỏi. Gap analysis cung cấp 2 thứ quan trọng:
1. `gaps[]` — danh sách các điểm thiếu cụ thể kèm `gapType` → input cho `generateAdaptiveQuestions`
2. `completenessScore` → dùng cùng với `overallConfidence` của UncertaintyRanker để quyết định có tiếp tục hỏi không

`gap-detector.types.ts` tách interface ra để các detectors có thể implement mà không import circular. `gap-detectors.registry.ts` là danh sách các detector instances — thêm loại gap mới chỉ cần thêm vào registry, không sửa `gap.analyzer.ts`.

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — `runIteration()` gọi `analyzeGaps()` ở Step 2 mỗi iteration
- `src/analyzers/uncertainty.ranker.ts` — nhận `GapAnalysis` làm input để tính `relatedGaps` per step
- `src/validators/llm.validator.ts` — nhận `GapAnalysis` để build prompt cho `generateAdaptiveQuestions()`
- `src/orchestrator/hitl.state.ts` — `lastGapAnalysis: GapAnalysis | null` lưu trong state

Phân tích `GenUseCase` → tìm các gaps (luồng thiếu, điều kiện chưa xử lý, actor chưa rõ).

**Hàm chính:** `analyzeGaps(useCase, score, vague, conversationHistory, confirmedBlueprints, droppedBlueprints, phase)`

**Thứ tự xử lý nội bộ:**
```
1. loadGapCentroids()         ← load gap-centroids.json (cached sau lần đầu)
2. collectStepEmbeddings(useCase) ← embed tất cả steps
3. classifyUseCaseDomainHybrid(useCase) ← detect domain
4. resolveBlueprintDomainFilter(analysis) ← domain filter cho blueprints
5. Chạy từng GapDetector trong GAP_DETECTORS registry:
   - Mỗi detector nhận GapDetectionContext { useCase, embeddings, centroids, conversationHistory, ... }
   - Trả Gap[] { gapType, description, severity, stepIndexes, flowId }
6. detectBlueprintGaps(embeddings, blueprintFilter, ctx):
   - detectActivatedBlueprints(...) → BlueprintActivation[]
   - So với confirmedBlueprints → tạo blueprint_XXX gaps
7. Tổng hợp: { missingExceptionFlows, missingAlternativeFlows, incompleteActors,
               uncertainConditions, gaps, priorityGaps, completenessScore,
               activatedBlueprints, classifierDominantDomain, ... }
```

**GapType** (22 loại + `blueprint_*`):
`missing_exception_flows`, `missing_alternative_flows`, `incomplete_actors`, `uncertain_conditions`, `missing_validation_handling`, `missing_search_handling`, `missing_system_failure_handling`, `missing_temporal_exceptions`, `missing_nested_exceptions`, `missing_resource_availability`, `missing_post_completion_scenarios`, `missing_data_quality_handling`, `missing_environmental_interruptions`, `missing_technology_variations`, `missing_save_resume_handling`, `missing_eligibility_failure_handling`, `missing_assignment_unavailability_handling`, `missing_policy_outcome_branching`, `missing_cancellation_handling`, `missing_alternative_path`, `missing_authorization_denial`, `missing_timeout_retry`, `missing_notification_failure`

---

### 8.2 UncertaintyRanker — Rank độ không chắc chắn

**File:** `src/analyzers/uncertainty.ranker.ts`

**Tại sao tồn tại:**
Gap analysis chỉ cho biết **cái gì bị thiếu** — không biết **hỏi chỗ nào trước**. UncertaintyRanker bổ sung chiều `criticality`: bước nào vừa không rõ vừa quan trọng thì hỏi trước. Không có ranker, câu hỏi sẽ random — tốn budget hỏi vào những chỗ ít ảnh hưởng. `overallConfidence` là tín hiệu dừng vòng lặp: nếu confidence đủ cao thì không cần hỏi thêm.

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — `runIteration()` gọi `rankAllUncertainties()` ở Step 3
- `src/validators/llm.validator.ts` — nhận `UncertaintyAnalysis` để prioritize câu hỏi trong `generateAdaptiveQuestions()`
- `src/orchestrator/hitl.state.ts` — `lastUncertaintyAnalysis: UncertaintyAnalysis | null`

**Hàm chính:** `rankAllUncertainties(useCase, gapAnalysis, score)` → `UncertaintyAnalysis`

**Xử lý:**
```
1. Với mỗi step trong mỗi flow → tính StepUncertainty:
   - clarityScore: phân tích độ rõ của description (vague words, passive voice, ...)
   - completeness: có actor/description không
   - exceptionCoverage: step này có exception flow không
   - relatedGaps: gaps liên quan
   - uncertaintyScore = weighted average

2. Với mỗi flow → tính FlowUncertainty:
   - stepsClarityAvg, stepsCompletenessAvg
   - conditionSpecificity: condition rõ không
   - hasCondition, hasResolution, hasValidAnchor, ...

3. StepCriticality (per step):
   - structuralImportance: vị trí trong flow (đầu/cuối ưu tiên cao hơn)
   - domainImportance: loại action (validation, persistence = quan trọng hơn)
   - impactRadius: có nhiều nhánh exception không

4. StepPriority = uncertaintyScore × criticalityScore → rank CRITICAL/HIGH/MEDIUM/LOW

5. overallConfidence = 1 - weighted_average(uncertaintyScores)
```

---

### 8.3 BlueprintDetector — Phát hiện Blueprint Patterns

**File:** `src/analyzers/blueprint.detector.ts`
**Data:** `src/data/blueprints.json`

**Tại sao tồn tại:**
Gap detectors generic (exception flow missing, etc.) không đủ để phát hiện các pattern **domain-specific** phức tạp như "2-way approval", "resource locking with timeout", "async notification loop". Blueprints encode domain knowledge này dưới dạng role + scenario definitions với pre-computed centroids. Detector so khớp use case với blueprints để:
1. **Probe phase** (trước iterations): LLM xác nhận blueprint có applicable không → lưu vào `confirmedBlueprintIds`
2. **Gap phase** (trong iteration): nếu blueprint confirmed nhưng use case thiếu scenario → tạo `blueprint_XXX` gap

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — `probeBlueprints()` gọi `detectActivatedBlueprints()` + `collectStepEmbeddings()`
- `src/analyzers/gap.analyzer.ts` — `detectBlueprintGaps()` gọi `detectActivatedBlueprints()` trong mỗi iteration
- `src/services/blueprint-family.service.ts` — được gọi **từ bên trong** `detectActivatedBlueprints()` để pre-filter

Blueprints là các **process patterns** đã biết trước. Xem chi tiết tại `src/data/BLUEPRINT_DOMAINS.md`.

**Hàm:** `detectActivatedBlueprints(stepEmbeddings, domainFilter, options)`

```
1. Load blueprints.json (có sẵn embedding centroids cho mỗi role)
2. Filter blueprints theo domain (human-system / system-system)
3. Filter theo predicted families (blueprintMatchesPredictedFamilies)
4. Với mỗi blueprint:
   - Với mỗi role trong blueprint:
     - So sánh role centroid với từng step embedding (cosine sim)
     - Nếu sim >= role.threshold → role được match
   - Nếu đủ minRolesMatched và requireDifferentActors → blueprint activated
5. Return BlueprintActivation[] { blueprintId, blueprintName, probeQuestion, confidence, assignments }
```

**`collectStepEmbeddings(useCase)`:** Embed tất cả steps của use case (dùng `SemanticService.embedBatch`). Kết quả `EmbeddedStep[]` được dùng bởi cả `detectActivatedBlueprints` và `detectBlueprintGaps` trong `gap.analyzer.ts`.

---

## 9. Validators

### 9.1 FlatValidator — Structural & Quality Score

**File:** `src/validators/flat.validator.ts`

**Tại sao tồn tại:**
Trước khi phân tích gap, cần biết use case có hợp lệ về **cấu trúc** không (IDs trùng? MAIN flow có không?) và **chất lượng** không (có verb-noun name? có actors tham gia không?). Score này là input cho gap analyzer và uncertainty ranker — gap analyzer dùng score để điều chỉnh severity, uncertainty ranker dùng score để tính `processPatternCoverage`. Đây là validator hoàn toàn rule-based (không LLM) nên nhanh và deterministic.

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — `runIteration()` gọi `validateUseCaseWithFeedback()` ở Step 1
- `src/analyzers/gap.analyzer.ts` — nhận `UseCaseTermScore` để tính `completenessScore`
- `src/analyzers/uncertainty.ranker.ts` — nhận `UseCaseTermScore` để tính `processPatternCoverage` và `structuralPenalty`
- `src/stores/projectStore.ts` — import type `JsonProjectStore` (dùng để check `hasUniqueName` trong project context)

**Hàm chính:** `validateUseCaseWithFeedback(useCase)` → `UseCaseValidationResult { valid, score, errors, warnings, suggestions }`

Tính **UseCaseTermScore** (0-100 overall):

| Nhóm | Tiêu chí |
|------|---------|
| Structural | duplicate step IDs, orphaned flows, missing MAIN flow |
| Name | hasVerbNounPattern, hasUniqueName |
| Coverage | summaryCoverage, preCoverage, postCoverage |
| Actors | actorParticipation, hasMainActorSteps, hasSystemActor |
| Process | processPatternCoverage (input/validate/persist/feedback verbs) |
| Flows | hasTriggerEvent, hasDefiniteEnding, hasValidStepNumbering |
| Branch | hasAlternativeFlow, hasExceptionFlow, branchAnchoringCoverage, branchConditionCoverage |
| Loop | hasLoop, loopConditionCoverage, loopSpanCoverage |
| Quality | fluffPenalty (fluff words detected) |

---

### 9.2 LLMValidator — Question Generation & Expert Answering

**File:** `src/validators/llm.validator.ts`

**Tại sao tồn tại:**
Tập trung mọi thứ liên quan đến **"hỏi và trả lời" bằng LLM** vào 1 file. Tên "validator" có thể gây nhầm lẫn — thực ra file này là hub của 4 concerns:
1. `generateAdaptiveQuestions` — convert gap+uncertainty analysis → câu hỏi tự nhiên không trùng lặp
2. `expertAnswerOpenEndedQuestions` — simulate human expert trong automated mode
3. `normalizeHumanAnswers` — chuẩn hóa raw human input thành `OpenEndedAnswer[]`
4. `probeBlueprintsWithExpert` — LLM xác nhận blueprint applicability

Việc tách khỏi `usecase.service.ts` là do đây không generate use case — đây generate **metadata** (questions, answers) để feed vào use case generation.

**Ai phụ thuộc vào đây:**
- `src/orchestrator/hitl.core.ts` — import `generateAdaptiveQuestions`, `expertAnswerOpenEndedQuestions`, `OpenEndedQuestion`, `OpenEndedAnswer`
- `src/orchestrator/hitl.orchestrator.ts` — import `expertAnswerOpenEndedQuestions`, `normalizeHumanAnswers`
- `src/orchestrator/hitl.state.ts` — `lastQuestions: OpenEndedQuestion[] | null`
- `src/helpers/memory.builder.ts` — import `OpenEndedQuestion`, `OpenEndedAnswer` types

| Hàm | Mô tả |
|-----|-------|
| `generateAdaptiveQuestions(useCase, gapAnalysis, uncertaintyAnalysis, history, allQuestions, confirmedBlueprints, geminiFunctions, cap)` | LLM tạo `OpenEndedQuestion[]` có structured context |
| `expertAnswerOpenEndedQuestions(questions, detailedDescription, domain, geminiFunctions)` | LLM trả lời câu hỏi, dùng trong automated mode |
| `normalizeHumanAnswers(answers)` | Convert `AnswerInput[]` → `OpenEndedAnswer[]` |
| `probeBlueprintsWithExpert(activations, description, domain, geminiFunctions)` | LLM xác nhận blueprint nào applicable → `string[]` (confirmed IDs) |

**OpenEndedQuestion structure:**
```ts
{
  id: string,           // consolidated ID (e.g., "global-gap-missing_exception_flows")
  question: string,
  context: {
    step?: string,
    steps?: Array<{index, actor, description, flowId}>,
    whyAsking: string,
    gapType?: GapType,
    patternType?: string,   // "incomplete_actors" | "clarification" | "uncertain_conditions" | ...
    flowId?: string,
  }
}
```

**CONSOLIDATION_GROUPS:** Các gaps cùng loại trên nhiều steps được gộp thành 1 câu hỏi (ví dụ: hỏi tất cả steps thiếu exception cùng 1 lần). Định nghĩa trong `gap.analyzer.ts` và re-export để `llm.validator.ts` dùng khi build câu hỏi consolidated. ID câu hỏi consolidated được parse bởi `helpers/consolidated-id.ts` để recover metadata (stepIndexes, gapType) khi classify answer scope.

---

## 10. Stores & Persistence

### JsonProjectStore

**File:** `src/stores/projectStore.ts`
**Backend:** Firebase Firestore (qua `firebase.service.ts`)
**Collection:** `stores` — mỗi document là 1 session (key = `sessionId`)

**Tại sao tồn tại:**
HITL state (use case đang refine) chỉ sống trong memory — mất khi server restart. `JsonProjectStore` cung cấp **persistence layer** cho project metadata và use cases đã được lưu. Dùng Firebase để không cần quản lý DB riêng, và document-per-session giúp tự nhiên isolate data giữa các users. Constructor chủ động load Firestore async ngay lúc tạo (`loadPromise`) thay vì lazy-load để minimize latency trên first write.

**Ai phụ thuộc vào đây:**
- `src/session/session.manager.ts` — tạo 1 instance per session
- `src/tools/projectTools.ts` — tất cả 7 functions đều nhận `JsonProjectStore` làm tham số đầu tiên
- `src/validators/flat.validator.ts` — import type để check `hasUniqueName` (check tên use case không trùng trong project)

**Store schema:**
```
Store
├── id: sessionId
├── projects: { [projectId: string]: Project }
└── currentProjectId: string | null

Project
├── id, name, description, createdAt, updatedAt
├── actors: Actor[]
└── useCases: UseCase[]   ← đây là UseCase schema cũ (interface.ts), KHÔNG phải GenUseCase
```

**Lưu ý:** `JsonProjectStore` lưu project metadata + use cases qua Firebase. `currentUseCase` trong HITL state KHÔNG tự động lưu vào Firestore — chỉ lưu khi có explicit save action.

**Các method:**
| Method | Mô tả |
|--------|-------|
| `initProject(name, description)` | Tạo project mới, set làm current, lưu lên Firestore |
| `loadProjectByName(name)` | Tìm project theo name qua Firestore |
| `switchToProject(projectId)` | Đổi `currentProjectId` |
| `deleteProject(projectId)` | Xóa project khỏi store + Firestore |
| `getAllUseCases()` | Lấy tất cả use cases của current project |
| `getProjectSummary()` | Thống kê ngắn |
| `listAllProjects()` | Tất cả projects trong session |

---

## 11. Tools

### 11.1 ProjectTools

**File:** `src/tools/projectTools.ts`

**Tại sao tồn tại:**
Tách layer HTTP (index.ts) khỏi logic store. Nếu `index.ts` gọi thẳng `projectStore.initProject()`, thì handler phải biết return format trông như thế nào — mixing concerns. `projectTools.ts` định nghĩa **return shape** cho từng operation, giúp `index.ts` chỉ cần `res.json(result)`. Cũng giúp test tools mà không cần spin up Express.

**Ai phụ thuộc vào đây:**
- `src/index.ts` — tất cả project-related route handlers đều import từ đây

Thin wrappers gọi `JsonProjectStore`. Đây là layer được gọi từ API handlers trong `index.ts`.

```
initProject(store, name, description)
loadProjectByName(store, name)
listAllProjects(store)
getProjectInfo(store)
viewProjectUseCases(store)
switchToProject(store, projectId)
deleteProject(store, projectId)
```

---

### 11.2 TestingTools

**File:** `src/tools/testingTools.ts`

**Tại sao tồn tại:**
Hệ thống cần evaluate HITL pipeline một cách **có hệ thống và lặp lại được** — không thể test thủ công từng use case. `testingTools.ts` cung cấp pipeline automation:
- `prepareTestData` → tái tạo dataset từ text gốc (reproducible ground truth)
- `embedDataset` → precompute embeddings một lần, tiết kiệm thời gian lúc eval
- `runHITLComparison` → so sánh Condition A (baseline / detailed baseline) vs Condition B (HITL enhanced) — đây là **thí nghiệm so sánh** của luận văn
- `evaluateResults` → đo chất lượng 3-tier cho từng condition

File này dùng `runHITLLoop` trực tiếp (không qua orchestrator) vì không cần SSE hay interactive pause.

**Ai phụ thuộc vào đây:**
- `src/index.ts` — tất cả `/testing/*` route handlers import từ đây
- `test-scripts/*.js` — gọi endpoints `/testing/*` qua HTTP

Pipeline cho batch evaluation:

#### `prepareTestData(geminiFunctions, { textBasedGroundTruth, testCaseId? })`
```
1. LLM extractedMetadata: testCaseId, name, domain, complexity, notes
2. LLM vagueSummary: tóm tắt chỉ happy path (2-3 câu)
3. generateFlatUseCase(textBasedGroundTruth) → GenUseCase làm ground truth
4. Validate với genUseCaseSchema.parse()
5. Ghi file: test-data/dataset-{testCaseId}.json
```

**Output format** (`test-data/dataset-{ID}.json`):
```json
{
  "version": "1.0",
  "createdAt": "...",
  "testCases": [{
    "id": "...",
    "domain": "...",
    "metadata": { "complexity": "...", "expectedFlows": N, "notes": "..." },
    "inputs": { "vague": "...", "detailed": "..." },
    "groundTruth": { /* GenUseCase */ }
  }]
}
```

#### `embedDataset({ datasetPath, testCaseIds?, forceReembed? })`
```
1. Đọc dataset JSON
2. Với mỗi flow trong groundTruth:
   - flowToText(flow) → string
   - semanticService.embed(text) → number[384]
   - Ghi vào flow.embedding
3. Ghi lại file tại chỗ (overwrite)
```

#### `runHITLComparison(geminiFunctions, { datasetPath, testCaseIds? })`
```
Với mỗi test case:
1. Chạy runHITLLoop (automated mode, expert answers)
2. Lấy conditionA_Baseline (loopResult.baseline)
3. Tạo conditionA_DetailedBaseline: generateFlatUseCase(detailed)
4. Classify domain cho cả baseline và detailedBaseline
5. conditionB_EnhancedHITL = loopResult.useCase

Ghi file: test-data/results/raw/enhanced-hitl-{timestamp}.json
```

**Raw result structure:**
```json
{
  "testCaseId": "...",
  "conditionA_Baseline": { /* GenUseCase */ },
  "conditionA_BaselineDomain": { /* domain classification */ },
  "conditionA_DetailedBaseline": { /* GenUseCase */ },
  "conditionA_DetailedDomain": { /* domain classification */ },
  "conditionB_EnhancedHITL": { /* GenUseCase */ },
  "iterativeRefinement": {
    "totalIterations": N,
    "totalQuestionsAsked": N,
    "iterations": [...]
  },
  "groundTruth": { /* GenUseCase */ }
}
```

#### `evaluateResults(geminiFunctions, { resultsPath, datasetPath })`
```
1. Với mỗi result, với mỗi condition (conditionA_Baseline, conditionA_DetailedBaseline, conditionB_EnhancedHITL):
   evaluateUseCase(useCase, { vagueSummary, detailedDescription, groundTruth, domain }, geminiFunctions)
2. Tính averages

Ghi file: test-data/results/evaluated/evaluated-{timestamp}.json
```

#### `classifyUseCaseDomainTool(geminiFunctions, { useCase })`
```
→ classifyUseCaseDomain(useCase, geminiFunctions) → UseCaseDomainAnalysis
```

---

## 12. Evaluator

**File:** `src/evaluators/three-tier.evaluator.ts`

**Tại sao tồn tại:**
Đánh giá chất lượng use case là bài toán khó vì không có ground truth hoàn hảo — use case được generate từ mô tả mờ nhạt có thể "đúng" theo nhiều cách khác nhau. 3-tier approach giải quyết bằng cách nhìn từ 3 góc độ độc lập:
1. **Semantic recall** — có capture đủ flows quan trọng của ground truth không? (tự động, dựa trên embeddings)
2. **LLM grounding** — mỗi flow có nguồn gốc hợp lệ không (grounded in description) hay LLM tự bịa (hallucination)? (LLM làm trọng tài)
3. **Structural completeness** — có đúng cấu trúc use case chuẩn không? (rule-based)

`inferBranchStepIndex()` tồn tại vì generated use cases đôi khi thiếu `fromStepIndex` — cần suy ra để match đúng với ground truth.

**Ai phụ thuộc vào đây:**
- `src/tools/testingTools.ts` — `evaluateResults()` gọi `evaluateUseCase()` cho từng condition của từng test case

**Hàm:** `evaluateUseCase(useCase, context, geminiFunctions)` → scores object

**3-tier evaluation:**

| Tier | Tên | Phương pháp | Trọng số |
|------|-----|-------------|---------|
| Tier 1 | **Semantic Recall** | Cosine sim của từng flow vs ground truth embeddings → recall @ threshold | ~40% |
| Tier 2 | **LLM Grounding** | LLM phân loại từng flow: `grounded` / `logical` / `hallucination` | ~35% |
| Tier 3 | **Structural Completeness** | Heuristic: đủ MAIN + ALT + EXT, actors rõ ràng, conditions, ... | ~25% |

**Tier 1 chi tiết:**
- Dùng ground truth embeddings (đã được embed trước bởi `embedDataset`)
- Với mỗi generated flow: tìm best-match ground truth flow bằng cosine sim
- `inferBranchStepIndex()`: nếu generated flow không có `fromStepIndex` → tự suy từ semantic similarity với MAIN steps
- Recall = proportion of ground truth flows matched ≥ threshold

**Tier 2 chi tiết:**
- LLM nhận `vagueSummary`, `detailedDescription`, từng flow → classify + score
- `inVagueSummary: boolean` — flow có được ngầm định trong mô tả mờ nhạt không
- `inDetailedDescription: boolean` — flow có trong mô tả chi tiết không

---

## 13. Data Files (Static)

**Tại sao tồn tại (chung):**
Tách **knowledge** (centroids, keywords, blueprint definitions) ra khỏi **code** để có thể cập nhật mà không cần rebuild. Thay đổi threshold của 1 gap type chỉ cần sửa JSON, không cần sửa TypeScript. Centroids được precompute offline từ embedding model — nếu compute realtime mỗi lần thì tốn thời gian.

| File | Mô tả | Ai đọc |
|------|-------|--------|
| `src/data/blueprints.json` | Định nghĩa tất cả blueprint patterns (roles, scenarios, pre-computed centroids, families) | `blueprint.detector.ts` |
| `src/data/gap-centroids.json` | Centroids cho 22+ loại gap | `gap-centroids.loader.ts` → `gap.analyzer.ts` |
| `src/data/domain-keywords.ts` | HUMAN_KEYWORDS, SYSTEM_KEYWORDS, HUMAN_ACTION_KEYWORDS, SYSTEM_ACTION_KEYWORDS | `domain-classifier.service.ts` |
| `src/data/BLUEPRINT_DOMAINS.md` | Tài liệu mô tả các blueprint domains | (documentation only) |

**Gap centroids loader:** `src/data/gap-centroids.loader.ts`

**Tại sao tồn tại:**
JSON không tự parse — loader wrap việc đọc file, deserialize, và **cache** kết quả. Không cache thì mỗi iteration sẽ đọc file disk nhiều lần. `clearGapCentroidsCache()` được gọi ở đầu mỗi baseline generation để đảm bảo fresh data nếu file JSON thay đổi giữa các requests.

**Ai phụ thuộc vào loader:**
- `src/analyzers/gap.analyzer.ts` — `loadGapCentroids()`, `clearGapCentroidsCache()`, `getCentroidByName()`

---

## 14. Luồng dữ liệu tổng thể

### Interactive Mode (API caller chờ questions)

```
POST /sessions                     → sessionId
POST /sessions/:id/hitl/start      → 202 Accepted
GET  /sessions/:id/hitl/stream     → SSE stream (mở trước khi start)

Server side:
  HITLOrchestrator.start()
    → runHITLLoop() [async]
        → generateBaseline(vague) [LLM]
        → probeBlueprints() [semantic + LLM]
        → for each iteration:
            analyzeGaps() [semantic]
            rankUncertainties()
            generateAdaptiveQuestions() [LLM]
            → emit "questions" event → SSE → client nhận

POST /sessions/:id/hitl/submit-answers  ← client gửi answers
  → orchestrator.submitAnswers()
  → promise resolved
  → refineWithHybridAnswers() [LLM] hoặc extractFlows() [LLM]
  → tiếp tục iteration hoặc break

→ emit "done" → SSE done
GET /sessions/:id/state → lấy currentUseCase cuối cùng
```

### Automated Mode (batch testing)

```
POST /sessions/:id/hitl/start { mode: "automated", detailed: "..." }
  → answerProvider = expertAnswerOpenEndedQuestions() [LLM]
  → không cần submit-answers

hoặc trực tiếp:
POST /sessions/:id/testing/run-hitl-comparison
  → runHITLComparison() → ghi test-data/results/raw/*.json

POST /sessions/:id/testing/evaluate-results
  → evaluateResults() → ghi test-data/results/evaluated/*.json
```

---

## 15. Output Files

| Output | Path | Khi nào tạo |
|--------|------|------------|
| Dataset file | `test-data/dataset-{ID}.json` | `prepareTestData()` |
| Raw HITL results | `test-data/results/raw/enhanced-hitl-{timestamp}.json` | `runHITLComparison()` |
| Evaluated results | `test-data/results/evaluated/evaluated-{timestamp}.json` | `evaluateResults()` |
| **Session state** | **In-memory** (không persist) | Session lifetime |
| **Project/UseCase** | **Firestore** `stores/{sessionId}` | `JsonProjectStore` write ops |

---

## Quick Reference — Cái gì gọi cái gì

```
index.ts (API)
  ├── SessionManager → HITLOrchestrator → runHITLLoop
  │                                         ├── generateBaseline
  │                                         │     └── generateFlatUseCase (usecase.service)
  │                                         ├── probeBlueprints
  │                                         │     ├── collectStepEmbeddings → semanticService.embedBatch
  │                                         │     ├── classifyUseCaseDomainHybrid (domain-classifier)
  │                                         │     ├── detectActivatedBlueprints (blueprint.detector)
  │                                         │     └── probeBlueprintsWithExpert (llm.validator → gemini)
  │                                         └── runIteration (×N)
  │                                               ├── validateUseCaseWithFeedback (flat.validator)
  │                                               ├── analyzeGaps (gap.analyzer)
  │                                               │     ├── GAP_DETECTORS registry
  │                                               │     ├── detectBlueprintGaps (blueprint.detector)
  │                                               │     └── classifyUseCaseDomainHybrid
  │                                               ├── rankAllUncertainties (uncertainty.ranker)
  │                                               ├── generateAdaptiveQuestions (llm.validator → gemini)
  │                                               ├── answerProvider
  │                                               │     ├── [interactive] wait for submitAnswers()
  │                                               │     └── [automated] expertAnswerOpenEndedQuestions → gemini
  │                                               ├── refineWithHybridAnswers → gemini (broad answers)
  │                                               ├── filterUngroundedDeltaFlows → semanticService
  │                                               ├── extractFlowsFromOpenEndedAnswers → gemini (step-specific)
  │                                               └── deduplicateFlows → semanticService
  │
  ├── JsonProjectStore → FirebaseService → Firestore
  │
  └── TestingTools
        ├── prepareTestData → gemini + generateFlatUseCase
        ├── embedDataset → semanticService.embed
        ├── runHITLComparison → runHITLLoop + classifyUseCaseDomain
        └── evaluateResults → three-tier.evaluator
```
