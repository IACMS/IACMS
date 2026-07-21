# File Management Service (FMS) API

Base URL (via gateway): `/api/v1/files` and `/api/v1/uploads`  
Direct service port: `3009`

Auth: Bearer JWT or gateway identity headers (`x-user-id`, `x-user-roles`, …).  
Scopes: `file.upload`, `file.read`, `file.delete`, `file.admin`.

## Lifecycle

```
PENDING → SCANNING → PROCESSING → AVAILABLE
                  ↘ FAILED (RetryWorker may requeue)
AVAILABLE → DELETED (soft) → permanent delete after retention
```

Uploads return `201` with `status: PENDING`. Clients poll `GET /files/:id` until `AVAILABLE`.

## Files

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| POST | `/files` | upload | Single multipart upload |
| POST | `/files/batch` | upload | Up to 100 files |
| GET | `/files` | read | List/search (`service`, `module`, `referenceId`, …). `crossService=true` requires `file.admin` |
| GET | `/files/:id` | read | Metadata only (`storagePath` never returned) |
| GET | `/files/:id/download` | read | Attachment download |
| GET | `/files/:id/view` | read | Inline view |
| GET | `/files/:id/stream` | read | Range / 206 streaming |
| GET | `/files/:id/signed-url?expires=600` | read | Presigned URL (Redis-cached) |
| DELETE | `/files/:id` | delete | Soft delete |

### Multipart fields (upload)

| Field | Required | Notes |
|-------|----------|-------|
| `service` | yes | e.g. `case-management` |
| `module` | yes | e.g. `evidence` |
| `referenceId` | no | e.g. `CASE-123` |
| `compress` | no | `"true"` / `"false"` |
| `visibility` | no | `private` \| `internal` \| `public` |
| `versionOf` | no | UUID of parent file (versioning) |
| `file` | yes | Binary part |

## Chunked uploads

| Method | Path | Description |
|--------|------|-------------|
| POST | `/uploads/init` | Start session |
| PUT | `/uploads/:id/chunks/:n` | Upload chunk (1-based) |
| POST | `/uploads/:id/complete` | Merge → File `PENDING` |
| GET | `/uploads/:id/status` | Resume info |

## Ops

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/ready` | DB + storage + Redis |
| GET | `/metrics` | Prometheus text exposition |

## Kafka events (published)

| Topic | When |
|-------|------|
| `file.uploaded` | Status → AVAILABLE |
| `file.processed` | Pipeline complete |
| `file.deleted` | Soft delete |
| `file.virus.found` | ClamAV positive |
| `file.permanently.deleted` | CleanupWorker |

## Kafka events (consumed)

| Topic | Action |
|-------|--------|
| `case.deleted` | Soft-delete all files with matching `referenceId` |

## Feature flags

| Env | Default |
|-----|---------|
| `VIRUS_SCAN_ENABLED` | `false` |
| `THUMBNAIL_ENABLED` | `true` |
| `COMPRESSION_IMAGE_ENABLED` | `true` |
| `COMPRESSION_VIDEO_ENABLED` | `false` |
| `DEDUPLICATION_ENABLED` | `false` |
| `WORKER_MODE` | `embedded` (dev) / `standalone` (prod) |
| `STORAGE_PROVIDER` | `minio` \| `local` \| `s3` |
