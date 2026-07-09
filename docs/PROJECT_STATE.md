# Project State

Last check-in: 2026-07-09

## Known Good Baseline

- Local development app works at `http://127.0.0.1:5173/`.
- ZimaOS Docker deployment works.
- ZimaOS app can import data successfully.
- SQLite-backed persistence is active.
- Current container image: `ghcr.io/skrems/health-tracker:v1.0.2`.
- ZimaOS SQLite database path: `/DATA/AppData/health-tracker/data/health-tracker.sqlite`.

## Import Status

- Rhythm bloodwork CSV imports work.
- BodySpec DEXA CSV imports work.
- Wyze scale XLSX imports work.
- Duplicate measurements are skipped by SQLite unique keys during import.

## Current Architecture

- React/Vite frontend for upload, charting, overlays, trends, and overview panels.
- Express API for import and measurement retrieval.
- SQLite storage via `better-sqlite3`.
- Docker image published through GitHub Actions to GHCR.
- ZimaOS compose file pins explicit image tags instead of relying on `latest`.

## Recent Fixes

- `v1.0.1`: made silent/zero-row Rhythm-style imports visible and inferred labs for raw Rhythm rows in warehouse imports.
- `v1.0.2`: replaced direct frontend `crypto.randomUUID()` usage with a browser-safe ID helper so imports work in ZimaOS/browser contexts without `randomUUID`.

## Next Useful Work

- Add a lightweight in-app import history view from SQLite batches.
- Add backup/export guidance for the ZimaOS SQLite database.
- Improve health overview grouping for bloodwork, DEXA, and scale signals.
