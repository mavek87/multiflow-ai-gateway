# Agents code rules
This document contains the code writing rules for AI agents.

## Behaviour

### STRICT
- Analyze the problem from multiple perspectives (bottom-up, top-down) to identify multiple implementation strategies with trade-offs.
- Understand the big picture and the real need before proposing a solution.
- Be concise and precise in responses.
- No unrequested preambles nor summaries.
- After completing new code verify it's working running tests/linting/build/run.
- 
## Programming principles:

### STRICT

- **Clean code principles**: Readable code, expressive naming. Code should speak for itself.
- **DRY**: No duplication. Extract reusable logic.
- **Principle of Least Astonishment**: No side effects in getters or simple calculators.

### FLEXIBLE (Architectural Guidance)

- **KISS & YAGNI**: Avoid over-engineering and "just in case" code. Build only what is needed now.
- **SOLID**: Apply all 5 principles. Pay special attention to SRP (avoid God classes/functions) and Dependency Inversion (for testability),
  while carefully balancing the Open/Closed Principle with YAGNI to avoid premature abstractions.
- **DDD (Domain Driven Design)**: Focus on the business domain logic. Apply DDD only when complexity justifies it (avoid boilerplate for
  simple tasks).
- **Composition over Inheritance**: Prefer modularity and interfaces over deep class hierarchies.
- **Design Patterns**: Use standard solutions for standard problems. Apply them only when they genuinely simplify the solution.

## Code style & Execution:

### STRICT

- **Read before writing**: Always read existing related code before adding new logic to avoid duplication.
- **Strict Typing**: Always use explicit type hints/signatures for functions, arguments, and return values.
- **Naming Conventions**: Method and variable names must always be human-readable, context-bounded, non-ambiguous, and self-explanatory.
- **Small Functions**: Keep methods short. Strictly split long methods into smaller, single-purpose functions.
- **Meaningful Comments**: Code should speak for itself. Comments explain the *WHY*, never the *WHAT*. If you need a comment to explain what
  the code does, rewrite the code instead.
- **Fail-Fast & Error Handling**: Validate inputs early, never swallow exceptions silently
- **Observability**: Meaningful logging for every logical branch and error state.
- **Dependency Control**: Do not introduce new libraries without asking the user.

### FLEXIBLE

- **Minimal Dependencies**: Do not propose to add third-party libraries if you can simply write a few lines of equivalent code.

## Refactoring

### STRICT
- When deleting a parameter, clean up all remaining code that referenced it.
- Delete unused classes and methods - no dead code.

## Tests

### FLEXIBLE
- Prefer end-to-end tests and integration tests over unit tests whenever possible.
- Apply TDD if possible

## Architecture

### STRICT
- **Modular Architecture (Folder-by-Feature)**: Each business feature must have its own directory containing its routes, services, schemas, and tests (e.g., `src/chat/`, `src/auth/`).
- **File Naming**: Use the `[feature].[type].ts` convention (e.g., `chat.routes.ts`, `auth.middleware.ts`, `tenant.store.ts`).
- **Type Placement**: Exported types (`export type`) must be defined in a dedicated `<module-name>.types.ts` sibling file. Non-exported (internal) types can stay inline in the implementation file.
- Don't mix the logic with UI.
### FLEXIBLE
- Fail fast: validate at system boundaries, trust data inside the domain.
- Keep a clear layer separation within the module (route → service → store/resolver).
- Shared infrastructure belongs to `src/engine/` or `src/utils/`.