# --- STAGE 1: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy dependency files
COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate DB schema (if needed at runtime) and compile the application into a binary
RUN bun run db:generate
RUN bun build ./src/index.ts --compile --outfile multiflow-ai-gateway

# Create data directory
RUN mkdir -p data

# --- STAGE 2: Production ---
# Use Distroless with a pinned SHA for strict reproducibility
FROM gcr.io/distroless/cc-debian12@sha256:847433844c7e04bcf07a3a0f0f5a8de554c6df6fa9e3e3ab14d3f6b73d780235
WORKDIR /app

# Copy the binary from the build stage
COPY --from=builder --chown=nonroot:nonroot /app/multiflow-ai-gateway ./multiflow-ai-gateway

# Copy directories required at runtime
COPY --from=builder --chown=nonroot:nonroot /app/drizzle ./drizzle

# Copy empty data directory and ensure proper ownership
COPY --from=builder --chown=nonroot:nonroot /app/data ./data

# Set the non-privileged user (UID 65532 included in distroless)
USER nonroot

EXPOSE 13000

# Start the binary
CMD ["./multiflow-ai-gateway"]