# Code Quality Standards

Canonical design principles for **all languages**. Shareable, project-independent
root rule. Language-specific applications: `quality-typescript.md` (TS strictness,
module system), `quality-vite.md` (Vite/VitePress build tooling).

---

## Design Principles

### SOLID

| Principle | Meaning | Violation Signal |
|-----------|---------|------------------|
| **SRP** | One responsibility per module/class | Module with methods spanning unrelated concerns |
| **OCP** | Extend behavior without modifying existing code | Editing existing branches to add new cases |
| **LSP** | Subtypes/implementations honor the parent contract | Implementation that throws where contract promises success |
| **ISP** | Depend on the narrowest interface needed | Requiring capabilities the consumer never uses |
| **DIP** | High-level modules depend on abstractions, not concretions | Constructor takes a concrete implementation instead of an interface |

### DRY

- Extract shared logic only when **2+ genuinely different callers** exist — incidental similarity not duplication
- Prefer the language's zero-cost abstraction (generics, type parameters) over runtime indirection
- Single source of truth for business logic — rule in two places, one goes stale
- **When NOT to DRY** (prefer DAMP — Descriptive And Meaningful Phrases): test code self-contained, readable in isolation, even at cost of repetition. Also: similar error handling for distinct situations, coupling risk outweighs dedup

### KISS (Keep It Simple, Stupid)

Simplicity = prerequisite for reliability. Every line, abstraction, indirection = liability until proven otherwise.

- Prefer straightforward code a newcomer can read over clever code that impresses peers
- Design needs a diagram to explain → too complex for the problem
- Complexity is not a badge of thoroughness — it is a cost that compounds
- In doubt? Write the naive solution first; optimize only when measurement demands

### Choose Boring Technology

Teams have finite "innovation tokens" (Dan McKinley, 2015). Boring tech is mature,
battle-tested, with *known* failure modes — novel tech introduces unknown unknowns
that compound operational cost.

- Default to the established option; save novelty for genuine differentiation
- "Best tool for the job" is a local optimization — the actual job is keeping the system running
- Each novel dependency/framework spends an innovation token; budget ~3 total
- Evaluate alternatives by operational maturity and team familiarity, not just features

### YAGNI

- **Start concrete.** Extract abstractions only when a second genuinely different use case appears
- **No premature generics.** A function handling one type needs no type parameters until called with another
- **Don't over-engineer error types.** Callers distinguish 2 cases? Don't create 20 variants
- **No feature flags or compatibility shims** when you can just change the code
- Three similar lines beat premature abstraction

---

## Anti-Pattern Severity

| Tier | Meaning | Action |
|------|---------|--------|
| **Block** | Correctness or security risk | Must fix before merge |
| **Warn** | Design smell, performance issue, maintainability risk | Should fix, can negotiate |
| **Suggest** | Improvement opportunity | Could fix, optional |

### Universal Block-tier Anti-Patterns
- Hardcoded secrets or credentials
- Unvalidated external input at system boundaries
- Catching/swallowing errors silently (no log, no re-raise)
- God objects/modules with 15+ fields/methods spanning unrelated concerns

### Universal Warn-tier Anti-Patterns
- Boolean parameters where an enum/literal type is clearer
- Stringly-typed APIs where structured types prevent typos at compile/type-check time
- Unnecessary copies in hot paths
- Missing error context (bare re-raise without adding info)

---

## Reusability Assessment

Before writing new code, ask: "Could a second caller use this, or copy-paste?",
"Right layer?" (generic utility vs. domain logic vs. command-specific glue), "Generic
capability dressed up as a specific feature?"

**Signals of misplaced code:** a cross-cutting concern inline (progress, retry,
rate-limiting, path sanitization); platform-specific logic in library code instead
of application layer; a generic utility mixed into command-specific code.

## Don't Own Non-Domain Code

Ask **before** the reusability questions above: *should this code exist in this
repo at all?* Separation of concerns applies across the repo boundary too. Build
what the product **is**; serialization, compression, hashing, HTTP, dates, globbing
are solved elsewhere. A library is tested by every one of its users — code you own
is tested only by the fixtures you thought to write.

**Bar for owning it** (fork / vendor / hand-roll) — narrow, and only one of:

1. **No library implements the requirement**, verified by searching, not assumed.
2. **A library exists but leaks substantial features genuinely needed** — not a disliked API.
3. A few lines with no edge cases (YAGNI — no dep for a one-liner).

"Our format is slightly non-standard" does **not** qualify: delegate everything
standard, own only the deviation as a named, tested seam.

**Warn-tier**, escalating to **Block** for anything parsing/emitting an external
wire format (serializers, codecs, escaping) — those fail silently, past local
fixtures.

> Worked example: a hand-written JSON emitter used escape boundary `> 0x7F` instead
> of `>= 0x7F`; its unit test *and* doc comment both affirmed the wrong rule, and no
> golden fixture contained the offending byte.

**Review implication.** Invisible to diff-scoped review — when the file already
exists, no reviewer of the *change* is prompted to question the *file*. Ask it
whenever a diff touches a module whose subject is not the product's domain.

## Code Review Checklist (All Languages)

- [ ] Errors propagated with context, not swallowed; logged once at the boundary
- [ ] No god objects — each module/class single responsibility
- [ ] Follows existing codebase patterns (grep before inventing)
- [ ] Nothing non-domain is hand-owned — no hand-rolled serializer/codec/escaping where a maintained library fits; applies to files the diff merely *touches*, not only files it adds
- [ ] Generic logic in library layer, command-specific in application layer
- [ ] No premature abstractions — extraction justified by real duplication
- [ ] External input validated at system boundaries

## Performance Checklist

- N+1 query/fetch patterns (loops making network or DB calls)
- Blocking I/O in async paths (e.g., sync `fs` calls inside an async handler)
- Excessive memory allocations (copies in hot loops, intermediate collections)
- Missing pagination
- Inefficient algorithms (O(n²) when O(n) possible)
- Cache opportunities missed
- Unbounded queues/channels without backpressure

## Refactoring Tooling

Before refactoring, check available tools via `ToolSearch` — capabilities like LSP
may be deferred tools not loaded by default. Prefer semantic tooling (LSP
`findReferences`, `workspaceSymbol`, `goToDefinition`) over text search (Grep) for
symbol-level ops like renames and reference lookups. Fall back to Grep for
non-code searches (comments, docs, config).

## Refactoring Discipline

**Two Hats Rule**: Never mix refactoring and optimization in the same session.

- **Hat 1: Refactoring** — Change structure, NOT behavior. Tests pass unchanged.
- **Hat 2: Optimization** — Improve performance, NOT behavior. Benchmarks required.

Switching hats? Commit first, then switch context.

| Rationalization | Red flag | Correct action |
|---|---|---|
| "I'll optimize this loop while I refactor it" | Hat 1 and Hat 2 mixed in one pass | Commit the refactor first. Then put on Hat 2. |
| "The benchmark runs fine locally, I'll skip it" | No benchmark output in the commit | Hat 2 = benchmarks are required. Record the before/after. |
| "This refactor is small, I don't need a test" | No tests cover the changed code | If no safety net exists, write characterization tests first — that's Hat 1 prep, not optional. |

## Verification Honesty

Verification claims must be evidence-backed. Hedging in review verdicts, commit
messages, completion reports masks uncertainty and degrades trust in quality gates.

### Banned Phrases

| Phrase | Replace With |
|--------|-------------|
| "should work" | "verified by [test name / command output]" |
| "probably", "likely" | state what was checked and what the result was |
| "seems to" | "confirmed that [X] by [method]" |
| "Great!", "Perfect!", "Done!" | evidence of completion (test pass, clean diff, gate output) |

**Classification:**
- Hedging in a review verdict or completion report: **Warn-tier**
- Premature celebration before verification evidence: **Warn-tier**
- Stating "verified" without citing evidence: **Block-tier** (false verification)

### Unchecked Green

A green result is evidence only if a red one was reachable. The structural sibling
of unevidenced "verified": a check whose passing state is indistinguishable from
the check never having run.

**The test**: demonstrate **both** outcomes. Show it red, show it green, on inputs
you control. Either one alone is half a proof. If you cannot produce both, you do
not have a check — you have a habit. Applies to any config whose failure mode is
"quietly does less" (unmatched globs, `paths:` on rule files) as much as to tests.

Corollary: a mutation that *fails* to turn the check red means "I have not found
every guard yet", not "the check is weak". Two independent guards defending one
property both pass when either alone is deleted — keep mutating until one reds.

- Claiming a check works without having seen it red: **Warn-tier**
- Shipping a check whose red state was never reachable: **Block-tier**
