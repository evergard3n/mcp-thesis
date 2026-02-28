# Domain-scoped blueprints and centroids: detect human-machine vs machine-machine and activate only matching patterns

## Problem

Today, gap detection treats all use cases the same. Blueprints (approval chain, request lifecycle, multi-party selection, information completeness) and centroid categories (validation, data input, save/resume, etc.) are written for **human–machine** flows: users filling forms, approvers, requesters, providers of information. When the use case is actually **machine–machine** (e.g. a resource-locking protocol between services), those patterns still run. That causes:

- **Wrong questions**: e.g. “What if the actor doesn’t know all required information at step 3?” for a step like “Service Client uses the resource,” leading to hallucinations about missing form fields and save-as-draft.
- **Missed questions**: machine–machine concerns (concurrent access, timers, nested operations) have no dedicated blueprints/centroids, so they are never asked.

So we need a way to **know which “world” the use case belongs to** and **only run the gap patterns that apply to that world**.

## Idea: two domains and domain-scoped activation

Introduce two **domains**:

1. **Human–machine**: primary interaction is between human actors and the system (forms, approvals, requests, selection, data entry, drafts). Current blueprints and most centroid categories fit here.
2. **Machine–machine**: primary interaction is between system/service actors (protocols, APIs, resource locking, timers, concurrency). Different patterns apply; human-centric ones (e.g. “missing information,” “fill later”) do not.

The desired behavior:

- **Domain is decided from the vague input** at the same time we do baseline generation (the first extraction from the user’s vague description). So the “domain signal” lives in the baseline-generation step: we add a dedicated way to classify the vague description as human–machine vs machine–machine (e.g. a small prompt or classifier that outputs one of the two labels). That result is then attached to the generated use case so the rest of the pipeline can use it.
- **Blueprints and centroid categories are tagged by domain.** Each blueprint is marked as human_machine or machine_machine (current four are all human_machine). Each centroid category is marked with which domain(s) it applies to (some may apply to both, e.g. system failure handling).
- **At gap analysis time, only activate blueprints and centroids that match the use case’s domain.** If the use case is machine_machine, we don’t run human_machine-only blueprints (so no “information completeness” on a protocol step). If it’s human_machine, we run the existing blueprints and human_machine centroids. Shared categories run in both.

So: **one domain label per use case, derived from vague input at baseline; blueprints and centroids separated by domain; activation only for the detected domain.** No code edits in this issue—just the idea and behavior above for someone to implement.

## Domain detection (concept)

- **Input**: The same vague description used to generate the baseline use case.
- **When**: As part of “baseline generation”—i.e. right after (or as part of) the step that produces the initial use case from vague input. The detector runs on the vague text and its output is stored on the use case.
- **Output**: A single value: `human_machine` or `machine_machine`.
- **How**: Some form of prompt or lightweight classification that looks at the description and decides whether the scenario is primarily about human users interacting with the system (forms, approvals, requests, selection) or about system-to-system / protocol behavior (services, resources, timers, locking, APIs). The exact prompt or method is left to the implementer; the important part is that the result is stable and derived only from the vague input, and that it is attached to the use case so gap analysis can read it.

## Blueprints and centroids by domain (concept)

- **Blueprints**: Each blueprint definition has a domain. Today’s four (approval_chain, request_lifecycle, multi_party_selection, information_completeness) are human_machine. When we add machine_machine patterns later, they get domain machine_machine. When running gap analysis, only blueprints whose domain matches the use case’s domain are considered.
- **Centroids**: Each centroid category has a set of domains it applies to (e.g. human_machine only, machine_machine only, or both). Only categories that include the use case’s domain are used for step/condition analysis. This avoids applying “data entry / missing info / save-resume” style centroids in machine_machine use cases where they cause hallucinations, while still allowing shared or machine_machine-specific categories (e.g. system failure, or future concurrent_access / timer_lifecycle) to run when appropriate.

## Backward compatibility

- Use cases that don’t have a domain set (e.g. from older runs or tools that don’t set it) should still work. A reasonable default is to treat “no domain” as “run all patterns” (current behavior), so existing tests and flows don’t change until domain detection is wired in where baselines are created.

## Success criteria (behavior)

- For a human–machine test case (e.g. BOS): detected domain is human_machine; all four current blueprints and human_machine centroid categories are active.
- For a machine–machine test case (e.g. CC1): detected domain is machine_machine; no human_machine-only blueprints run (so no information_completeness on “uses the resource”); only machine_machine and shared centroid categories run.
- When domain is missing: behavior unchanged (all blueprints and centroids active, or an agreed default).

## Out of scope for this issue

- Adding new machine_machine blueprints or centroid categories (e.g. concurrent_access, timer_lifecycle). This issue is about the domain signal, tagging existing (and future) blueprints/centroids by domain, and activating only the ones that match the detected domain.
