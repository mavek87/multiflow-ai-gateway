#!/bin/bash
set -e

docker compose pull
docker compose up -d
docker compose logs --tail=50 -f
