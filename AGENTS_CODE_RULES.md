# Agents code rules
This document contains the code writing rules for AI agents.

## Agent Behaviour
### STRICT
- Analyze the problem from multiple perspectives (bottom-up, top-down) to identify multiple implementation strategies with trade-offs.
- Understand the big picture and the real need before proposing a solution.
- Be concise and precise in responses.
- No unrequested preambles nor summaries.
- After completing new code verify it's working running tests/linting/build/run.

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

## Programming principles:
### STRICT:
- DRY
- Clean Code
### FLEXIBLE:
- SOLID
- KISS
- YAGNI
- Design patterns

## Code style:
### STRICT
- Read existing code before adding logic to avoid duplication.
- Keep methods pretty short - split long methods into smaller functions or classes.
- Code should speak for itself - minimize comments.
- Comments explain *why*, never *what*. If you need a comment to explain what the code does, rewrite the code instead.
- Method names and variable names must be human-readable and context-bounded.
- Do not introduce new libraries without asking the user.
### FLEXIBLE
- Do not add libraries if you can simply write a few lines of equivalent code.

## Refactoring
### STRICT
- When deleting a parameter, clean up all remaining code that referenced it.
- Delete unused classes and methods - no dead code.

## Tests
### FLEXIBLE
- Prefer end-to-end tests and integration tests over unit tests whenever possible.