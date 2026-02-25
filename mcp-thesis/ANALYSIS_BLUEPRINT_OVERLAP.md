# Blueprint Overlap Problem Analysis

## 🔴 **Current Problem: Blueprint Overlap & Collision**

### **Issue 1: Multiple Blueprints Can Activate on Same Steps**

**Current Code Behavior** (trong `detectBlueprintGaps`):

```typescript
for (const blueprint of blueprints) {
  const assignments = assignRolesOrdered(blueprint, candidatesMap);
  if (!assignments) continue; // Skip if can't assign roles

  // ⚠️ NO CHECK if another blueprint already used these steps!
  // Multiple blueprints can claim the same steps

  for (const assignment of assignments) {
    coveredStepKeys.add(`${assignment.flowId}|${assignment.stepIndex}`);
  }
}
```

**Problem**:

- Blueprint A matches steps 1, 2, 3 → Generates gaps for scenario X
- Blueprint B ALSO matches steps 1, 2, 3 → Generates DUPLICATE gaps for similar scenario Y
- **Result**: Redundant questions, user confusion

---

### **Issue 2: Nested Blueprint Detection**

**Scenario**: User has a complex use case with both patterns:

```
Step 1: Manager receives approval request (APPROVAL_CHAIN role: receiver)
Step 2: Manager validates request details (INFORMATION_COMPLETENESS role: data_validator)
Step 3: Manager approves request (APPROVAL_CHAIN role: approver)
Step 4: System sends notification (APPROVAL_CHAIN role: notifier)
```

**Current Behavior**:

1. `approval_chain` blueprint activates:
   - Matches steps 1, 3, 4
   - Generates gap: "What if manager rejects?"

2. `information_completeness` blueprint ALSO activates:
   - Matches step 2 (data validation)
   - Generates gap: "What if required data is missing?"

**Problem**:

- Step 2 được claim bởi CẢ HAI blueprints
- Có thể sinh ra duplicate/conflicting questions
- Không rõ priority: Approval chain quan trọng hơn hay Information completeness?

---

### **Issue 3: Domain Overlap**

**Current Domain Definition**:

- `human-system`: approval_chain, request_lifecycle, multi_party_selection, information_completeness
- `system-system`: api_integration, data_synchronization, event_driven_processing, batch_processing

**Potential Overlap Scenarios**:

**Scenario A: Human initiates, System executes**

```
Step 1: User submits API request (human-system?)
Step 2: API Gateway validates token (system-system?)
Step 3: System processes request (system-system?)
Step 4: System returns result to user (human-system?)
```

**Questions**:

- Is this human-system or system-system?
- Should BOTH domain blueprints activate?
- If yes, which takes priority?

**Scenario B: Hybrid Use Case**

```
Main Flow: User requests data export (human-system)
Extension: System automatically syncs data to backup (system-system)
```

**Current Code**:

```typescript
const detectedDomains = new Set<DomainType>();
// ⚠️ Tracks WHICH domains detected, but doesn't handle conflicts
detectedDomains.add(blueprint.domainType);
```

---

## 🔍 **Evidence from Current Code**

### **No Overlap Prevention**:

```typescript
// From detectBlueprintGaps():
for (const blueprint of blueprints) {
  const assignments = assignRolesOrdered(blueprint, candidatesMap);
  if (!assignments) continue;

  // ❌ No check: "Are these steps already claimed by another blueprint?"
  // ❌ No priority system between blueprints
  // ❌ No conflict resolution

  for (const assignment of assignments) {
    coveredStepKeys.add(`${assignment.flowId}|${assignment.stepIndex}`);
    // ⚠️ Just marks as "covered", but multiple blueprints can mark same step
  }
}
```

### **Role Assignment Logic**:

```typescript
function assignRolesOrdered(
  blueprint: BlueprintDefinition,
  candidatesMap: Map<string, RoleCandidate[]>,
): RoleAssignment[] | null {
  const assignments: RoleAssignment[] = [];
  let lastAssignedStepIndex = -1;

  for (const role of blueprint.roles) {
    const candidates = candidatesMap.get(role.id) ?? [];
    // Filter: Only steps AFTER previous assignment (sequential ordering)
    const filteredCandidates = candidates.filter(
      (candidate) => candidate.stepIndex > lastAssignedStepIndex,
    );

    // ❌ No filter: "Is this step already claimed by another blueprint?"
  }
}
```

---

## 📊 **Impact Analysis**

### **Low-Risk Overlaps** (Acceptable):

1. **Complementary Blueprints**:
   - `approval_chain` focuses on approval flow
   - `information_completeness` focuses on data validation
   - **Can coexist** if they detect different aspects (approval vs data)

2. **Different Flows**:
   - Blueprint A on MAIN flow
   - Blueprint B on ALT_1a flow
   - **No conflict** if steps don't overlap

### **High-Risk Overlaps** (Problematic):

1. **Competing Blueprints**:
   - `approval_chain` vs `request_lifecycle` on same request flow
   - Both want steps 1-5, generate similar questions
   - **Duplicate/redundant gaps**

2. **Domain Confusion**:
   - User request (human-system) triggers API call (system-system)
   - Unclear which domain's blueprints should activate
   - **May activate BOTH, causing irrelevant questions**

3. **Same Steps, Different Interpretation**:
   - Step 3: "System validates data"
   - `information_completeness` sees it as "data validation"
   - `api_integration` sees it as "API validation step"
   - **Both blueprints claim same step, generate different questions**

---

## 💡 **Proposed Solutions**

### **Solution 1: Blueprint Priority System** ⭐ (Recommended)

Add priority field to blueprints:

```typescript
interface BlueprintDefinition {
  id: string;
  name: string;
  domainType: DomainType;
  priority: number; // 1 = highest, 10 = lowest
  activation: BlueprintActivationRules;
  roles: BlueprintRoleDefinition[];
  expectedScenarios: BlueprintScenarioDefinition[];
}
```

**Detection Logic**:

```typescript
// Sort blueprints by priority
const sortedBlueprints = blueprints.sort((a, b) => a.priority - b.priority);

const claimedSteps = new Set<string>(); // Track which steps are already used

for (const blueprint of sortedBlueprints) {
  // Filter out candidates that are already claimed
  const candidatesMap = new Map<string, RoleCandidate[]>();
  for (const role of blueprint.roles) {
    const allCandidates = await buildCandidatesForRole(role, mainSteps);
    const availableCandidates = allCandidates.filter(
      (c) => !claimedSteps.has(`${c.flowId}|${c.stepIndex}`),
    );
    candidatesMap.set(role.id, availableCandidates);
  }

  const assignments = assignRolesOrdered(blueprint, candidatesMap);
  if (!assignments) continue;

  // Mark steps as claimed
  for (const assignment of assignments) {
    claimedSteps.add(`${assignment.flowId}|${assignment.stepIndex}`);
  }
}
```

**Benefits**:

- ✅ High-priority blueprints claim steps first
- ✅ Low-priority blueprints only get leftover steps
- ✅ No duplicate questions on same steps

**Priority Ranking** (suggestion):

```json
{
  "approval_chain": 1, // Most specific
  "request_lifecycle": 2,
  "multi_party_selection": 3,
  "information_completeness": 4, // Most general

  "api_integration": 1,
  "data_synchronization": 2,
  "event_driven_processing": 3,
  "batch_processing": 4
}
```

---

### **Solution 2: Domain-First Filtering** ⭐⭐ (Best for Domain Separation)

Filter blueprints by detected domain BEFORE running detection:

```typescript
export async function detectBlueprintGaps(
  useCase: GenUseCase,
  embeddedSteps: EmbeddedStep[],
  detectedDomain?: DomainType, // NEW: Pass in from domain classifier
): Promise<BlueprintGapResult> {
  let blueprints = await loadBlueprints();

  // Filter by domain if provided
  if (detectedDomain) {
    blueprints = blueprints.filter((bp) => bp.domainType === detectedDomain);
    console.log(
      `Filtered to ${blueprints.length} blueprints for domain: ${detectedDomain}`,
    );
  }

  // Rest of detection logic...
}
```

**Benefits**:

- ✅ Eliminates cross-domain overlap (human-system blueprints won't compete with system-system)
- ✅ Cleaner separation of concerns
- ✅ Fewer blueprints to evaluate → faster

**Drawback**:

- ⚠️ Hybrid use cases (both domains) may miss some patterns
- **Solution**: Allow `domainType: "both"` for blueprints that apply to both domains

---

### **Solution 3: Overlap Tolerance Threshold**

Allow controlled overlap for complementary blueprints:

```typescript
interface BlueprintDefinition {
  id: string;
  allowOverlapWith?: string[]; // IDs of blueprints that can coexist
  maxOverlapSteps?: number; // Max number of shared steps allowed
}
```

**Example**:

```json
{
  "id": "approval_chain",
  "allowOverlapWith": ["information_completeness"],
  "maxOverlapSteps": 2
}
```

**Detection Logic**:

```typescript
// Track which blueprint owns each step
const stepOwners = new Map<string, string>(); // stepKey -> blueprintId

for (const blueprint of blueprints) {
  const assignments = assignRolesOrdered(blueprint, candidatesMap);
  if (!assignments) continue;

  // Check overlap
  const overlappingSteps = assignments.filter((a) =>
    stepOwners.has(`${a.flowId}|${a.stepIndex}`),
  );

  if (overlappingSteps.length > 0) {
    const ownerBlueprintId = stepOwners.get(overlappingSteps[0]);

    // Check if overlap is allowed
    if (!blueprint.allowOverlapWith?.includes(ownerBlueprintId)) {
      console.log(
        `Skipping ${blueprint.id}: conflicts with ${ownerBlueprintId}`,
      );
      continue; // Skip this blueprint
    }

    // Check if overlap exceeds threshold
    if (overlappingSteps.length > (blueprint.maxOverlapSteps || 0)) {
      console.log(`Skipping ${blueprint.id}: too many overlapping steps`);
      continue;
    }
  }

  // Claim steps
  for (const assignment of assignments) {
    stepOwners.set(
      `${assignment.flowId}|${assignment.stepIndex}`,
      blueprint.id,
    );
  }
}
```

---

### **Solution 4: Hierarchical Blueprints** (Long-term)

Create parent-child relationships:

```typescript
{
  "id": "approval_workflow",
  "type": "parent",
  "children": ["approval_chain", "information_completeness"],
  "activation": "any_child_matches"
}
```

**Behavior**:

- If child blueprints activate, parent provides context
- Child blueprints focus on specific aspects
- Parent coordinates gap generation to avoid duplicates

---

## ✅ **Recommended Implementation Strategy**

### **Phase 1: Domain Filtering** (Quick Win)

1. Pass `detectedDomain` from domain classifier to `detectBlueprintGaps()`
2. Filter blueprints by domain before detection
3. Allow `domainType: "both"` for cross-domain blueprints

**Code**:

```typescript
// In gap.analyzer.ts:
const domainResult = await classifyUseCaseDomain(useCase, gemini, "hybrid");

const blueprintResult = await detectBlueprintGaps(
  useCase,
  embeddedSteps,
  domainResult.dominantDomain, // NEW PARAMETER
);
```

### **Phase 2: Priority System** (Medium Term)

1. Add `priority` field to all blueprints
2. Sort by priority before detection
3. Track claimed steps to prevent overlaps

### **Phase 3: Overlap Tolerance** (Optional)

1. Add `allowOverlapWith` for complementary blueprints
2. Implement overlap validation logic

---

## 📊 **Testing Strategy**

Create test cases with known overlaps:

**Test Case 1: Same Domain, Competing Blueprints**

```
Use Case: Purchase approval workflow
Expected: approval_chain activates, request_lifecycle skipped (lower priority)
```

**Test Case 2: Hybrid Domain**

```
Use Case: User triggers automated sync
Expected: human-system blueprints on user action, system-system on sync
```

**Test Case 3: Complementary Blueprints**

```
Use Case: Complex approval with data validation
Expected: Both approval_chain and information_completeness activate on different aspects
```

---

## 🎯 **Summary**

**Current State**: ❌ No overlap handling → Potential duplicate gaps
**Impact**: ⚠️ Medium-High (depends on blueprint similarity and domain overlap)
**Priority**: 🔴 High (should fix before production use)

**Recommended Fix Order**:

1. ✅ Domain filtering (easiest, biggest impact)
2. ✅ Priority system (prevents most duplicates)
3. ⚠️ Overlap tolerance (only if complementary blueprints needed)

**Estimated Effort**:

- Phase 1 (Domain filtering): 2-3 hours
- Phase 2 (Priority system): 4-6 hours
- Phase 3 (Overlap tolerance): 8-10 hours
