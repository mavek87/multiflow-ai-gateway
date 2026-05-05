# AGENTS.md - Multiflow AI Gateway

This file provides guidance to AI agents when working with this repository.

## Project Overview

The project is an **AI Gateway written in TypeScript/Bun** with:

- **Modular Architecture (Folder-by-Feature)**
- Multi-domain RAG orchestration (LightRAG + RAG-Anything)
- MCP support
- Multi-tenancy
- Intelligent routing (UCB1) and circuit breakers.

## Tech Stack

- Bun (https://bun.com/docs)
- Elyisia (https://elysiajs.com/table-of-content.html)
- Drizzle (https://orm.drizzle.team/docs/overview)
- Sqlite (https://sqlite.org/docs.html)

## Project details

If you need details about the project, always refer to: [README.md](README.md)

## General Agentic Rules

### Agent Behavior & Mindset

- **Honesty over Helpfulness:** Don't be complacent when you disagree! This would harm the user! Be honest: if
  you think something is wrong, always state your opposing view clearly and explain why.
- **Clarification First:** Do not guess or act when you have doubts. Always ask questions to clarify ambiguous points before
  proceeding. Acting while in a state of high uncertainty without discussing a plan with the user would harm him!
- **Plan before action:** Act only once you have a plan that has been accepted by the user.
- **No Hallucinations:** Never assume the existence of code, comments, or documentation that has not been explicitly shared with you or that
  you didn't read anywhere.

### File Operations
- **Use English:** All content written into files MUST be in English.

## Agent code rules

If you have to write code always refer to: [AGENTS_CODE_RULES.md](AGENTS_CODE_RULES.md)

## Project management rules

All the commands are available in [package.json](package.json)

### How to check tests and Typescript warnings at the same time?

```bash
bun run check
```

### How to run the app in dev?

```bash
bun run dev
```

### How to inspect the database?

**Use sqlite3**