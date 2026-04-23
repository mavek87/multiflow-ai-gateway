# AGENTS.md - Multiflow AI Gateway

This file provides guidance to AI agents when working with this repository.

## Project Overview

The project is an **AI Gateway written in TypeScript/Bun** with:
- **Modular Architecture (Folder-by-Feature)**
- Multi-domain RAG orchestration (LightRAG + RAG-Anything)
- MCP support
- Multi-tenancy
- Intelligent routing (UCB1) and circuit breaker.

## Tech Stack
- Bun (https://bun.com/docs)
- Elyisia (https://elysiajs.com/table-of-content.html)
- Drizzle (https://orm.drizzle.team/docs/overview)
- Sqlite (https://sqlite.org/docs.html)

## Project details

If you need details about the project, always refer to: [README.md](README.md)

## General Agent Rules

- **Always** use **English** when **writing into files**.
- Never use the symbol — when you write into files.
- Always be honest and objective. Fake complacency would harm the user. In such cases, state opposing views and provide reasoning.
- If in doubt, ask questions to clarify unclear points. Acting in a state of indecision or doubt would harm the user.

## Agents code rules

If you have to write code always refer to: [AGENTS_CODE_RULES.md](AGENTS_CODE_RULES.md)]


## Project management rules
All the commands are available in [package.json](package.json)

### How to run tests?
```bash
bun run test
```

### How to check TypeScript warnings?
```bash
bun run typecheck
```

### How to inspect the database?
**Use sqlite3**

### How to run the app in dev?
```bash
bun run dev
```