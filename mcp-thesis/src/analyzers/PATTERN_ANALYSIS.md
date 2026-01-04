# Exception Flow Pattern Analysis

Analysis of missed flows from evaluation results to identify detection patterns.

## Data Source
- HC1 (Insurance Claim): 8 total flows, baseline discovered 1 (12.5%)
- MO1 (Mail Order): 4 total flows, baseline discovered 2 (50%)

## Pattern Categories

### 1. Temporal/Async Exceptions
**Pattern**: Exceptions that can occur at any time, not tied to a specific step

**Example**: `EXT_ANY_SYSTEM_DOWN` (HC1)
- Condition: "At any time, System goes down"
- Characteristics:
  - No `fromStepIndex` specified
  - Condition contains temporal indicators
  - Can interrupt any step in the process

**Keywords**:
- "at any time"
- "anytime"
- "during"
- "while"
- "throughout"
- "at all times"

**Detection**:
- Check original description for temporal keywords
- Look for scenarios not tied to specific steps
- Identify system-wide failure scenarios

---

### 2. Nested Exceptions
**Pattern**: Exceptions that occur within other exception flows

**Example**: `EXT_1a2a_NO_RESPONSE` (HC1)
- Parent flow: `EXT_1a_INCOMPLETE_DATA`
- Condition: "Claimant does not supply information within time period"
- Characteristics:
  - `parentFlow` references another EXCEPTION flow (not MAIN)
  - Represents failure within failure handling

**Keywords**:
- "timeout"
- "does not respond"
- "fails to provide"
- "within time period"
- "after previous exception"

**Detection**:
- Scan detailed descriptions for chained scenarios
- Look for timeout/non-response patterns after requests
- Identify multi-level error handling

---

### 3. Resource Availability
**Pattern**: Workflow blocked due to unavailable resources (people, capacity, slots)

**Example**: `EXT_3a_NO_AGENTS` (HC1)
- Condition: "No agents are available at this time"
- Related step: Assignment/allocation step ("assigns an Adjuster")
- Characteristics:
  - Occurs at resource allocation points
  - May leave process in incomplete state

**Keywords**:
- "no agents"
- "unavailable"
- "not available"
- "insufficient"
- "capacity"
- "no slots"
- "fully booked"
- "overloaded"

**Detection**:
- Look for assignment/allocation steps: "assign", "allocate", "schedule", "reserve"
- Check for capacity/availability scenarios in descriptions
- Identify resource constraint patterns

---

### 4. Post-Completion Scenarios
**Pattern**: Actions that occur after the main flow completes

**Example**: `EXT_8a_REOPEN_CLAIM` (HC1)
- Condition: "Claimant notifies adjuster of new claim activity"
- From step: 8 (close/final step)
- Characteristics:
  - `fromStepIndex` points to closing/completion step
  - Represents reopening or reversal

**Keywords**:
- "reopen"
- "reverse"
- "undo"
- "after close"
- "after completion"
- "reverts to"
- "resume"
- "reactivate"

**Detection**:
- Identify closing/completion steps: "close", "complete", "finish", "terminate"
- Look for scenarios mentioning post-completion actions
- Check for reversal/reopening patterns

---

### 5. Data Quality at Input
**Pattern**: Validation failures at initial data collection steps

**Example**: `EXT_1a_INCOMPLETE_DATA` (HC1)
- Condition: "Submitted data is incomplete"
- From step: 1 (input/reporting step)
- Characteristics:
  - Occurs at steps 1-2 (initial data collection)
  - Triggers request for additional information

**Keywords**:
- "incomplete"
- "missing information"
- "invalid data"
- "malformed"
- "insufficient data"
- "required fields missing"
- "validation error"

**Detection**:
- Focus on first 1-2 steps with input/submit actions
- Look for data submission/collection steps
- Check for validation scenarios in descriptions

---

### 6. Environmental/External Interruptions
**Pattern**: External events that interrupt the process

**Example**: `EXT_4a` (MO1)
- Condition: "Fire alarm goes off and interrupts registration"
- Characteristics:
  - External, uncontrollable event
  - Can occur at any step
  - Forces process suspension

**Keywords**:
- "fire alarm"
- "emergency"
- "evacuation"
- "power outage"
- "natural disaster"
- "interruption"
- "external event"

**Detection**:
- Look for external event keywords in detailed descriptions
- Identify interruption scenarios
- Check for emergency/safety patterns

---

### 7. Technology Variations
**Pattern**: Alternative implementation methods or technology choices

**Example**: `ALT_8_PAYMENT_CHECK` (HC1)
- Condition: "Settlement payment by check"
- Type: ALTERNATIVE (not EXCEPTION)
- Characteristics:
  - Different valid implementation
  - Technology or method choice

**Keywords**:
- "by check"
- "electronic"
- "paper"
- "digital"
- "manual"
- "automated"
- "online"
- "offline"

**Detection**:
- Look for method/technology options in descriptions
- Identify "by X" or "via Y" patterns
- Check for implementation alternatives

---

### 8. System Interactions
**Pattern**: System unavailability or failures during interactions (already exists in current gap analyzer)

**Example**: `EXT_4b` (MO1)
- Condition: "Computer goes down during registration"
- Related to: System interaction steps
- Characteristics:
  - System/database unavailability
  - Service failures

**Keywords** (already in analyzer):
- "system goes down"
- "unavailable"
- "timeout"
- "connection failure"

---

## Detection Priority

1. **High Priority** (missing from many test cases):
   - Data Quality at Input
   - Resource Availability
   - Post-Completion Scenarios

2. **Medium Priority** (occasionally missing):
   - Temporal/Async Exceptions
   - Nested Exceptions
   - Environmental Interruptions

3. **Low Priority** (rarely missing):
   - Technology Variations

## Implementation Notes

- Patterns should be detected by analyzing both:
  1. Use case structure (steps, flows, actors)
  2. Original detailed description text
- Combine structural analysis with keyword matching
- Priority should guide question generation

