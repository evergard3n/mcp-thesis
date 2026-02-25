# Blueprint Domain Classification

## Overview

Blueprints are organized by **domain type** to reflect the fundamental interaction patterns in use cases. Each blueprint is classified as either **human-system** or **system-system**, enabling domain-aware gap detection and question generation.

---

## Domain Types

### 1. Human-System Domain (`human-system`)

**Characteristics:**

- At least one human actor initiates or makes decisions
- May involve system automation, but key control points are human-driven
- Focus on user experience, error recovery, and human judgment

**Typical Patterns:**

- User submits → System validates → Human approves
- Human inputs data → System processes → Human reviews
- Human initiates request → System fulfills → Human confirms

**Example Use Cases:**

- Approval workflows (expense reports, purchase requests)
- Order placement and fulfillment
- Data entry with validation
- User-driven search and selection

---

### 2. System-System Domain (`system-system`)

**Characteristics:**

- Fully automated interactions between systems
- No human intervention in core flow (humans only monitor/configure)
- Focus on reliability, idempotency, fault tolerance, and eventual consistency

**Typical Patterns:**

- Service calls API → Receives response → Processes data
- Publisher emits event → Subscriber consumes event
- Scheduled job runs → Processes batch → Logs results

**Example Use Cases:**

- Microservice API integrations
- Event-driven architectures (Kafka, RabbitMQ)
- Data synchronization across databases
- Batch processing jobs

---

## Blueprint Design Principles

### Human-System Blueprints

**Focus on:**

- What if human makes a mistake?
- What if human changes their mind?
- What if human is unavailable?
- What if system cannot fulfill human request?

**Example Scenarios:**

- `reject`: Approver rejects request
- `cancel_midprocess`: User cancels after submission
- `missing_info`: Human doesn't know required field
- `no_match`: System cannot find suitable option

---

### System-System Blueprints

**Focus on:**

- What if network fails?
- What if response is malformed?
- What if event is lost or duplicated?
- What if system is overloaded?

**Example Scenarios:**

- `timeout`: API call exceeds timeout
- `service_unavailable`: Target system is down
- `duplicate_event`: Same event processed twice
- `partial_batch_failure`: Some records fail in batch

---

## Current Blueprints

### Human-System (4 blueprints)

| ID                         | Name                     | Key Roles            | Top Scenarios                                             |
| -------------------------- | ------------------------ | -------------------- | --------------------------------------------------------- |
| `approval_chain`           | Approval Chain           | submitter, approver  | reject, conditional_approval, delegate_approval           |
| `request_lifecycle`        | Request Fulfillment      | initiator, fulfiller | cancel_midprocess, modify_midprocess, partial_fulfillment |
| `multi_party_selection`    | Multi-Party Selection    | selector             | split_request, merge_requests, no_match                   |
| `information_completeness` | Information Completeness | provider             | missing_info, fill_later                                  |

### System-System (4 blueprints)

| ID                        | Name                    | Key Roles                    | Top Scenarios                                                 |
| ------------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------- |
| `api_integration`         | API Integration         | caller, responder            | timeout, service_unavailable, malformed_response, rate_limit  |
| `data_synchronization`    | Data Synchronization    | source_system, target_system | sync_conflict, sync_failure, partial_sync, stale_data         |
| `event_driven_processing` | Event-Driven Processing | publisher, subscriber        | event_loss, duplicate_event, out_of_order, processing_failure |
| `batch_processing`        | Batch Processing        | batch_processor              | partial_batch_failure, batch_timeout, duplicate_batch_run     |

---

## Usage in Code

### Detecting Domain

```typescript
const blueprintResult = await detectBlueprintGaps(useCase, stepEmbeddings);

// Get detected domains
console.log(blueprintResult.detectedDomains);
// → Set { "human-system", "system-system" }

// Determine dominant domain
if (blueprintResult.detectedDomains.size === 1) {
  const domain = Array.from(blueprintResult.detectedDomains)[0];
  console.log(`Dominant domain: ${domain}`);
} else {
  console.log("Mixed domain use case");
}
```

### Filtering by Domain

```typescript
import { getBlueprintsByDomain } from "./blueprint.detector.js";

// Get only human-system blueprints
const humanBlueprints = await getBlueprintsByDomain("human-system");

// Get all blueprints
const allBlueprints = await getBlueprintsByDomain();
```

### Adding New Blueprints

When adding to `blueprints.json`:

```json
{
  "id": "new_pattern",
  "name": "New Pattern Name",
  "domainType": "human-system",  // ✅ REQUIRED
  "domainDescription": "Brief explanation of the pattern",  // ✅ RECOMMENDED
  "activation": { ... },
  "roles": [ ... ],
  "expectedScenarios": [ ... ]
}
```

---

## Research Implications

### Domain-Specific Question Templates

**Human-System Questions:**

- Emphasize user intent, error recovery, and decision points
- Use language like "Can the user...", "What if they change their mind?"

**System-System Questions:**

- Emphasize reliability, idempotency, and failure modes
- Use language like "What if the service fails?", "Is there retry logic?"

### Evaluation Metrics

Domain classification enables:

- **Domain-specific precision/recall**: Measure how well the framework handles each domain
- **Gap coverage analysis**: Track which domain has better/worse discovery rates
- **Blueprint activation rates**: Identify which patterns are most/least detected

---

## Future Extensions

### Potential New Domains

1. **Human-Human** (`human-human`)
   - Collaborative workflows between multiple humans
   - Example: Multi-stage approvals, peer reviews

2. **IoT-System** (`iot-system`)
   - IoT devices communicating with backend systems
   - Example: Sensor data ingestion, device command-control

3. **AI-Human** (`ai-human`)
   - AI agent interacting with human (HITL for AI)
   - Example: AI recommendations with human override

---

## Maintenance Guidelines

### When to Create a New Blueprint

**DO create a new blueprint if:**

- The pattern is domain-general (applies across industries)
- The pattern has 3+ common exception scenarios
- Existing blueprints don't cover the interaction style

**DON'T create a new blueprint if:**

- The pattern is domain-specific (only for one industry)
- It's a minor variation of an existing blueprint
- It has fewer than 2 distinct scenarios

### How to Choose Domain Type

**Human-System if:**

- Any role has keywords like "user", "clerk", "manager", "customer"
- Scenarios involve human decisions, mistakes, or unavailability

**System-System if:**

- All roles have keywords like "system", "service", "API", "database"
- Scenarios involve network failures, timeouts, or data consistency

**If Uncertain:**

- Default to `human-system` (more common in BA elicitation)
- Ask: "Could this run without human intervention?" → If yes, `system-system`

---

## Version History

- **2026-02-25**: Initial domain classification implementation
  - Split 8 blueprints into 4 human-system + 4 system-system
  - Added `domainType` field to all blueprints
  - Updated `detectBlueprintGaps()` to track detected domains
