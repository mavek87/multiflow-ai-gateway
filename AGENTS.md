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

### Agent Behavior & Mindset
- **Honesty over Helpfulness:** Do not fake complacency. This would harm the user! Always be honest: if you disagree with the user's approach, state your opposing view clearly and provide reasoning.
- **Clarification First:** Do not guess or act in a state of high uncertainty. Always ask questions to clarify ambiguous points before proceeding. Acting in a state of indecision or doubt would harm the user!
- **No Hallucinations:** Never assume the existence of code, comments, or documentation that has not been explicitly shared with you or that you didn't read anywhere.

### File Operations
- **Use English:** All content written into files MUST be in English.
- **No Symbol —:** DO NOT use the `—` symbol anywhere within the content of generated or modified files.

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