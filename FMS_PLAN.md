# File Management Service (FMS) — Implementation Plan

**Version:** 1.0  
**Port:** 3009  
**Language:** TypeScript (Node.js 22 LTS)  
**Framework:** Express.js 5.x (matches existing IACMS services)  
**Target OS:** Ubuntu Server 24.04 LTS  
**Deployment:** Docker Compose v2 on dedicated server

---

## Table of Contents

1. [Overview & Fit Inside IACMS](#1-overview--fit-inside-iacms)
2. [Technology Decisions](#2-technology-decisions)
3. [Infrastructure Changes](#3-infrastructure-changes)
4. [Database Schema](#4-database-schema)
5. [Project Structure](#5-project-structure)
6. [API Contract](#6-api-contract)
7. [Core Modules Deep-Dive](#7-core-modules-deep-dive)
8. [File Lifecycle Pipeline](#8-file-lifecycle-pipeline)
9. [Security Strategy](#9-security-strategy)
10. [Event System (Kafka)](#10-event-system-kafka)
11. [Background Workers](#11-background-workers)
12. [Configuration](#12-configuration)
13. [Build Phases](#13-build-phases)
14. [Environment Variables](#14-environment-variables)
15. [Docker Compose Integration](#15-docker-compose-integration)
16. [API Gateway Routing](#16-api-gateway-routing)
17. [Testing Strategy](#17-testing-strategy)
18. [Open Decisions / Future Work](#18-open-decisions--future-work)

---

## 1. Overview & Fit Inside IACMS

The FMS is a **dedicated microservice** that owns all binary file concerns for the entire IACMS platform. No other service stores file bytes, paths, or storage credentials. They only ever hold a `fileId` (UUID) and call FMS APIs.

```
Client
  │
  ▼
API Gateway (port 3000)  ──► /api/v1/files/*  ──►  File Management Service (port 3009)
                                                             │
                                          ┌──────────────────┼──────────────────┐
                                          ▼                  ▼                  ▼
                                     PostgreSQL           MinIO             Redis
                                    (metadata)          (binaries)     (upload state)
                                          │
                                          ▼
                                       Kafka
                                  (FILE_UPLOADED, etc.)
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                       Case Service          Notification Service
                     (trigger OCR)          (notify upload done)
```

### What other services do

| Service | Before FMS | After FMS |
|---------|-----------|-----------|
| Case Service | stores `filename`, `path`, `size` in its DB | stores only `fileId` UUID |
| Chat/Messaging | manages its own upload folder | stores only `fileId` UUID |
| Any future service | duplicates upload logic | calls `POST /api/v1/files` |

---

## 2. Technology Decisions

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | **TypeScript** | Type-safe, aligns with FMS spec, better DX for complex domain |
| Framework | **Express.js 5.x** | Matches all existing IACMS services |
| ORM | **Prisma 6.x** | Already used project-wide; single migration pipeline |
| Object Storage | **MinIO** | Self-hosted S3-compatible on dedicated server; Azure/GCS adapters intentionally excluded |
| Metadata DB | **PostgreSQL 16+** | Dedicated IACMS DB server (separate host), new `fms` schema |
| Cache / Upload State | **Redis 7** | Already running in IACMS infra |
| Message Broker | **Apache Kafka** | Already running; **not** RabbitMQ (spec listed it as optional) |
| Image Processing | **Sharp** | Fast native bindings, thumbnail + compress |
| Video Processing | **FFmpeg** (via `fluent-ffmpeg`) | H264/H265 compression, metadata extraction |
| Virus Scanning | **ClamAV** (optional, feature-flagged) | Docker sidecar, toggled via `VIRUS_SCAN_ENABLED` |
| Multipart Parsing | **Busboy** | Streaming parser, avoids buffering whole file in memory |
| Validation | **Zod** | Runtime schema validation for all DTOs |
| Testing | **Vitest** | Matches existing IACMS services |

---

## 3. Infrastructure Changes

### New Docker containers needed

| Container | Image | Purpose |
|-----------|-------|---------|
| `iacms-minio` | `minio/minio:latest` | Object storage (S3-compatible) |
| `iacms-minio-init` | `minio/mc:latest` | One-shot bucket creation |
| `iacms-clamav` | `clamav/clamav:stable` | Virus scanning (optional) |
| `iacms-file-service` | Built from `services/file-service/Dockerfile` | The FMS itself |

### Existing containers reused (no change)

- `iacms-postgres` — new `fms` Prisma schema added
- `iacms-redis` — new key namespace `fms:upload:*`
- `iacms-kafka` — new topics `file.uploaded`, `file.deleted`, `file.processed`

### New ports

| Service | Port |
|---------|------|
| File Management Service | **3009** |
| MinIO API | **9000** |
| MinIO Console | **9001** |

### Docker Network Placement

Following the server's recommended 4-network architecture:

| Container | Network(s) |
|-----------|-----------|
| `iacms-file-service` | `backend-network` |
| `iacms-minio` | `data-network` |
| `iacms-minio-init` | `data-network` |
| `iacms-clamav` | `data-network` |

> **Important:** MinIO is **never** attached to `backend-network` or `frontend-network`. Clients have zero direct access to MinIO. All file delivery goes through the FMS HTTP layer.

### Resource Allocation (Production Server)

| Component | CPU | Memory | Notes |
|-----------|-----|--------|-------|
| `file-service` (HTTP) | 2 cores | 2–3 GB | Upload/download/stream handling |
| `file-service-workers` | 2–4 cores | 2–4 GB | Separate container for background workers |
| `minio` | 1–2 cores | 2–4 GB | Object storage |
| `clamav` | 1–2 cores | 1–2 GB | Virus signature DB loaded in memory (~600 MB) |

### ⚠️ Storage Gap — MinIO File Storage Not Accounted For

The current server spec (Section 6 of server spec) allocates storage for Docker images, volumes, PostgreSQL, Kafka, and logs — but **does not include MinIO file storage**.

Recommended additional allocation:

| Purpose | Size |
|---------|------|
| MinIO file storage (documents, images, videos) | **1–2 TB** (separate volume or disk) |
| MinIO temp storage (chunked upload staging) | 100 GB |

**Action required:** Mount a dedicated volume for MinIO data rather than storing on the same NVMe as the OS and app containers. Example in docker-compose:
```yaml
volumes:
  minio_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/storage/minio   # mount point for dedicated disk
```

---

## 4. Database Schema

FMS uses its own **Prisma schema** (`prisma/schema-fms.prisma`) or an additional model block in the shared schema. We will add models under the `fms` PostgreSQL schema for isolation.

### `files` table

```prisma
model File {
  id              String      @id @default(uuid())
  service         String      // "case-management", "chat", "hr"
  module          String      // "evidence", "conversation"
  ownerId         String      // userId who uploaded
  referenceId     String?     // CASE-123, ROOM-45, etc.
  originalName    String      // original filename from client
  storedName      String      // UUID-based name in storage
  mimeType        String
  size            BigInt
  checksum        String      // SHA-256 of original bytes
  storagePath     String      // service/module/YYYY/MM/uuid.bin (never exposed to client)
  storageProvider String      @default("minio") // minio | s3 | azure | local
  compressed      Boolean     @default(false)
  compressionType String?     // jpeg | webp | h264 | zip
  thumbnails      Json?       // { "100x100": "path", "250x250": "path", "500x500": "path" }
  metadata        Json?       // extracted: width, height, duration, pages, GPS, etc.
  retentionDays   Int?        // null = keep forever; set per service policy
  scheduledDeleteAt DateTime? // computed on soft-delete: deletedAt + retentionDays
  status          FileStatus  @default(PENDING)
  deleted         Boolean     @default(false)
  deletedAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([service, module])
  @@index([ownerId])
  @@index([referenceId])
  @@index([checksum])
  @@index([status])
  @@map("files")
}

enum FileStatus {
  PENDING         // just received, not yet processed
  SCANNING        // virus scan in progress
  PROCESSING      // compression / thumbnail in progress
  AVAILABLE       // ready to serve
  FAILED          // processing failed, kept for retry
  DELETED         // soft deleted
}
```

### `chunk_uploads` table

Tracks resumable multi-chunk uploads.

```prisma
model ChunkUpload {
  id              String            @id @default(uuid()) // uploadId
  service         String
  module          String
  ownerId         String
  referenceId     String?
  originalName    String
  mimeType        String
  totalSize       BigInt
  totalChunks     Int
  receivedChunks  Int               @default(0)
  chunkSize       Int               // bytes per chunk
  status          ChunkUploadStatus @default(IN_PROGRESS)
  tempPath        String            // staging area in MinIO/local
  expiresAt       DateTime          // TTL for abandoned uploads
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  chunks          Chunk[]

  @@map("chunk_uploads")
}

model Chunk {
  id            String      @id @default(uuid())
  uploadId      String
  chunkNumber   Int
  size          Int
  checksum      String      // SHA-256 of this chunk
  storedPath    String
  createdAt     DateTime    @default(now())

  upload        ChunkUpload @relation(fields: [uploadId], references: [id], onDelete: Cascade)

  @@unique([uploadId, chunkNumber])
  @@map("chunks")
}

enum ChunkUploadStatus {
  IN_PROGRESS
  MERGING
  COMPLETE
  FAILED
  EXPIRED
}
```

### `service_retention_policies` table

Defines how long files belonging to each service are kept after soft-delete. Managed by an admin, not by uploading clients.

```prisma
model ServiceRetentionPolicy {
  id            String    @id @default(uuid())
  service       String    @unique  // "case-management", "chat", "hr", etc.
  retentionDays Int?               // null = keep forever (never permanently deleted)
  description   String?            // human-readable note e.g. "Legal hold — indefinite"
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("service_retention_policies")
}
```

**Seeded defaults:**

| service | retentionDays | reason |
|---------|--------------|--------|
| `case-management` | `null` | Legal evidence — keep forever |
| `chat` | `90` | Chat attachments — 90 days |
| `hr` | `2555` | HR docs — 7 years (legal compliance) |
| `*` (fallback) | `30` | Default for any unregistered service |

When a file is soft-deleted (`DELETE /files/:id`):
1. CleanupWorker looks up `ServiceRetentionPolicy` for the file's `service`
2. If `retentionDays` is `null` → sets `scheduledDeleteAt = null` (never auto-delete)
3. If `retentionDays` is a number → sets `scheduledDeleteAt = deletedAt + retentionDays`
4. If no policy row exists for the service → falls back to `SOFT_DELETE_DAYS` env var

The `CleanupWorker` only permanently deletes files where `scheduledDeleteAt IS NOT NULL AND scheduledDeleteAt < NOW()`.

---

## 5. Project Structure

```
services/file-service/
├── src/
│   │
│   ├── api/                          # HTTP layer only — no business logic
│   │   ├── controllers/
│   │   │   ├── FileController.ts     # upload, download, view, stream, delete, list
│   │   │   └── ChunkController.ts    # init, upload-chunk, complete
│   │   ├── routes/
│   │   │   ├── file.routes.ts
│   │   │   └── chunk.routes.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts    # JWT validation (calls Auth Service)
│   │   │   ├── scope.middleware.ts   # checks file.upload / file.read / file.delete scopes
│   │   │   ├── rateLimit.middleware.ts
│   │   │   ├── multipart.middleware.ts  # busboy streaming parser
│   │   │   └── requestId.middleware.ts
│   │   └── validators/
│   │       ├── upload.validator.ts   # Zod: service, module, referenceId, compress
│   │       └── query.validator.ts    # Zod: list/search params
│   │
│   ├── application/                  # Use-cases / orchestration
│   │   ├── commands/
│   │   │   ├── UploadFileCommand.ts
│   │   │   ├── UploadBatchCommand.ts
│   │   │   ├── InitChunkUploadCommand.ts
│   │   │   ├── UploadChunkCommand.ts
│   │   │   ├── CompleteChunkUploadCommand.ts
│   │   │   └── DeleteFileCommand.ts
│   │   ├── queries/
│   │   │   ├── GetFileQuery.ts
│   │   │   ├── ListFilesQuery.ts
│   │   │   └── GetSignedUrlQuery.ts
│   │   ├── dto/
│   │   │   ├── UploadFileDto.ts
│   │   │   ├── FileResponseDto.ts
│   │   │   └── ChunkUploadDto.ts
│   │   └── services/
│   │       ├── FileService.ts        # main orchestrator
│   │       ├── ChunkService.ts       # chunked upload orchestrator
│   │       ├── MetadataService.ts    # extract image/video/doc metadata
│   │       └── DeduplicationService.ts  # SHA-256 content-addressable check
│   │
│   ├── domain/                       # Pure business rules, no I/O
│   │   ├── entities/
│   │   │   ├── File.ts
│   │   │   └── ChunkUpload.ts
│   │   ├── repositories/
│   │   │   ├── IFileRepository.ts
│   │   │   └── IChunkRepository.ts
│   │   ├── events/
│   │   │   ├── FileUploadedEvent.ts
│   │   │   ├── FileDeletedEvent.ts
│   │   │   └── FileProcessedEvent.ts
│   │   ├── value-objects/
│   │   │   ├── StoragePath.ts        # constructs service/module/YYYY/MM/uuid
│   │   │   ├── FileChecksum.ts
│   │   │   └── MimeTypeGuard.ts
│   │   └── interfaces/
│   │       ├── IStorageProvider.ts
│   │       ├── ICompressionProvider.ts
│   │       ├── IVirusScanProvider.ts
│   │       └── IThumbnailProvider.ts
│   │
│   ├── infrastructure/               # Adapters — all I/O lives here
│   │   ├── storage/
│   │   │   ├── StorageFactory.ts     # returns correct provider from config
│   │   │   ├── minio/
│   │   │   │   └── MinIOStorage.ts   # primary — used in both dev and production
│   │   │   ├── s3/
│   │   │   │   └── S3Storage.ts      # future option only
│   │   │   └── local/
│   │   │       └── LocalStorage.ts   # dev/test only, no MinIO needed
│   │   ├── compression/
│   │   │   ├── CompressionFactory.ts
│   │   │   ├── ImageCompressor.ts    # Sharp
│   │   │   ├── VideoCompressor.ts    # FFmpeg
│   │   │   └── ZipCompressor.ts     # archiver
│   │   ├── thumbnail/
│   │   │   └── SharpThumbnail.ts
│   │   ├── virusScan/
│   │   │   └── ClamAVScanner.ts
│   │   ├── streaming/
│   │   │   └── RangeStream.ts        # HTTP Range / 206 Partial Content
│   │   ├── metadata/
│   │   │   ├── ExifExtractor.ts      # exifr for images
│   │   │   ├── FFprobeExtractor.ts   # ffprobe for video/audio
│   │   │   └── PdfExtractor.ts       # pdf-parse for PDFs
│   │   ├── persistence/
│   │   │   ├── PrismaFileRepository.ts
│   │   │   └── PrismaChunkRepository.ts
│   │   ├── cache/
│   │   │   └── RedisUploadState.ts   # chunk progress, signed-url cache
│   │   ├── queue/
│   │   │   ├── KafkaPublisher.ts
│   │   │   └── KafkaConsumer.ts
│   │   └── auth/
│   │       └── JwtValidator.ts       # validates JWT from Auth Service public key / secret
│   │
│   ├── workers/                      # Long-running background processors
│   │   ├── VirusScanWorker.ts
│   │   ├── CompressionWorker.ts
│   │   ├── ThumbnailWorker.ts
│   │   ├── MetadataWorker.ts
│   │   ├── CleanupWorker.ts          # permanent delete after 30d
│   │   └── RetryWorker.ts            # retry FAILED files
│   │
│   ├── config/
│   │   ├── index.ts                  # central config object from env
│   │   └── minio.ts                  # MinIO client singleton
│   │
│   ├── shared/
│   │   ├── logger.ts                 # structured JSON logger (pino)
│   │   ├── errors.ts                 # AppError, NotFoundError, ForbiddenError
│   │   └── utils/
│   │       ├── checksum.ts           # SHA-256 stream hashing
│   │       ├── pathBuilder.ts        # builds service/module/YYYY/MM/uuid
│   │       └── mime.ts               # safe MIME detection from bytes (magic bytes)
│   │
│   └── server.ts                     # Express app bootstrap
│
├── tests/
│   ├── unit/
│   │   ├── domain/
│   │   └── application/
│   ├── integration/
│   │   ├── upload.test.ts
│   │   ├── download.test.ts
│   │   └── chunk.test.ts
│   └── e2e/
│       └── fileLifecycle.test.ts
│
├── docker/
│   └── Dockerfile
│
├── docs/
│   └── FMS_API.md
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

---

## 6. API Contract

All routes go through the API Gateway at `/api/v1/files/*`.

### 6.1 Single Upload

```
POST /api/v1/files
Content-Type: multipart/form-data

Fields:
  file        (binary)
  service     (string, required)   e.g. "case-management"
  module      (string, required)   e.g. "evidence"
  referenceId (string, optional)   e.g. "CASE-123"
  compress    (boolean, default: false)
  visibility  (enum: private | internal | public, default: private)

Response 201:
{
  "id": "uuid",
  "originalName": "report.pdf",
  "mimeType": "application/pdf",
  "size": 1250000,
  "checksum": "sha256:abc123...",
  "status": "PENDING",
  "url": "/api/v1/files/uuid/view",
  "downloadUrl": "/api/v1/files/uuid/download"
}
```

### 6.2 Batch Upload

```
POST /api/v1/files/batch
Content-Type: multipart/form-data
(up to 100 files, same metadata fields)

Response 201:
{
  "uploaded": [ { "id": "...", ... }, ... ],
  "failed":   [ { "originalName": "bad.exe", "reason": "blocked mime" } ]
}
```

### 6.3 Chunked Upload — Initialize

```
POST /api/v1/uploads/init
Content-Type: application/json

{
  "service": "case-management",
  "module": "evidence",
  "originalName": "bigvideo.mp4",
  "mimeType": "video/mp4",
  "totalSize": 5368709120,
  "totalChunks": 512,
  "chunkSize": 10485760
}

Response 200:
{
  "uploadId": "uuid",
  "expiresAt": "2026-08-01T12:00:00Z"
}
```

### 6.4 Chunked Upload — Send Chunk

```
PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber
Content-Type: application/octet-stream
X-Chunk-Checksum: sha256:...

Body: raw chunk bytes

Response 200:
{
  "uploadId": "uuid",
  "chunkNumber": 14,
  "received": 14,
  "total": 512
}
```

### 6.5 Chunked Upload — Complete

```
POST /api/v1/uploads/:uploadId/complete

Response 200:
{
  "fileId": "uuid",
  "status": "PENDING"
}
```

### 6.6 Download

```
GET /api/v1/files/:id/download

Response 200:
Content-Disposition: attachment; filename="original-name.pdf"
Content-Type: application/pdf
Body: file bytes
```

### 6.7 Stream (Video / Audio)

```
GET /api/v1/files/:id/stream
Range: bytes=0-1048575

Response 206:
Content-Range: bytes 0-1048575/104857600
Content-Type: video/mp4
Body: partial content
```

### 6.8 Inline View

```
GET /api/v1/files/:id/view

Response 200:
Content-Disposition: inline; filename="report.pdf"
Body: file bytes
```

### 6.9 Signed URL (temporary access)

```
GET /api/v1/files/:id/signed-url?expires=600

Response 200:
{
  "url": "https://minio.internal/bucket/path?X-Amz-Signature=...&X-Amz-Expires=600",
  "expiresAt": "2026-07-10T12:10:00Z"
}
```

### 6.10 Delete (soft)

```
DELETE /api/v1/files/:id

Response 200:
{ "id": "uuid", "deleted": true, "willBeRemovedAt": "2026-08-10T..." }
```

### 6.11 List / Search

```
GET /api/v1/files
  ?service=case-management
  &module=evidence
  &referenceId=CASE-123
  &ownerId=USER001
  &mimeType=application/pdf
  &status=AVAILABLE
  &from=2026-01-01
  &to=2026-12-31
  &page=1
  &limit=20

Response 200:
{
  "data": [ { FileResponseDto }, ... ],
  "total": 145,
  "page": 1,
  "limit": 20
}
```

### 6.12 Get Single File Metadata

```
GET /api/v1/files/:id

Response 200:
{
  "id": "uuid",
  "service": "case-management",
  "module": "evidence",
  "originalName": "report.pdf",
  "mimeType": "application/pdf",
  "size": 1250000,
  "checksum": "sha256:...",
  "status": "AVAILABLE",
  "thumbnails": { "100x100": "/api/v1/files/thumb-uuid-1/view", ... },
  "metadata": { "pages": 24, "author": "John Doe" },
  "createdAt": "2026-07-10T10:00:00Z"
}
```

### 6.13 Health / Observability

```
GET /health     → { status: "ok", uptime: 123 }
GET /ready      → checks DB + MinIO + Redis connections
GET /metrics    → Prometheus-format counters
```

---

## 7. Core Modules Deep-Dive

### 7.1 Storage Provider Interface

```typescript
// domain/interfaces/IStorageProvider.ts
interface IStorageProvider {
  upload(path: string, stream: Readable, size: number, mime: string): Promise<void>;
  download(path: string): Promise<Readable>;
  stream(path: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  copy(sourcePath: string, destPath: string): Promise<void>;
  move(sourcePath: string, destPath: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
}
```

All storage adapters (`MinIOStorage`, `S3Storage`, `AzureStorage`, `LocalStorage`) implement this interface. `StorageFactory` reads `STORAGE_PROVIDER` from config and returns the correct instance. No business logic ever touches a concrete storage class directly.

### 7.2 Storage Path Builder

```
StoragePath.build({ service, module, fileUUID })
  → "case-management/evidence/2026/07/550e8400-e29b-41d4-a716-446655440000.bin"
```

- Always a UUID filename, never the original name
- Year/month partitioning prevents single-directory overload
- `.bin` extension on storage; MIME tracked in DB only

### 7.3 Compression Module

```typescript
interface ICompressionProvider {
  compress(inputPath: string, outputPath: string, options: CompressOptions): Promise<CompressResult>;
  decompress(inputPath: string, outputPath: string): Promise<void>;
}
```

| MIME group | Provider | Output format |
|-----------|----------|--------------|
| image/* | Sharp | webp (default) or jpeg / avif |
| video/* | FFmpeg | H264 (default) or H265 |
| application/zip, etc. | archiver | zip |
| Everything else | passthrough | unchanged |

Compression is always done **asynchronously** by `CompressionWorker`, never in the request path.

### 7.4 Thumbnail Generation

Only for images (`image/*` MIME). Uses **Sharp**. Generates three sizes: `100x100`, `250x250`, `500x500`. Each thumbnail is stored as a separate file in storage and its path is written to `files.thumbnails` JSON column.

Triggered by `ThumbnailWorker` after file reaches `AVAILABLE` status.

### 7.5 Metadata Extraction

| File type | Library | Fields extracted |
|-----------|---------|-----------------|
| Images | `exifr` | width, height, GPS lat/lng, camera model, ISO, f-stop |
| Video / Audio | `ffprobe` | duration, resolution, codec, bitrate, fps |
| PDF | `pdf-parse` | page count, author, title, creation date |
| All others | — | none (empty `{}`) |

Stored in `files.metadata` JSONB column.

### 7.6 Chunk Upload — Resume Logic

```
Redis key: fms:upload:{uploadId}:chunks → Set of received chunk numbers
```

When a client resumes after disconnect:

1. `GET /api/v1/uploads/:uploadId/status` → returns `{ received: [1,2,3,...,13], missing: [14,...,512] }`
2. Client resumes from chunk 14
3. Each chunk is stored in MinIO temp path: `tmp/uploads/{uploadId}/{chunkNumber}.bin`
4. On `complete` → `ChunkService` merges all chunks in order using MinIO compose or a stream merge, moves to permanent path, deletes temp chunks

### 7.7 Virus Scan (ClamAV)

- Feature-flagged via `VIRUS_SCAN_ENABLED=true`
- File enters `SCANNING` status, a TCP connection is made to `clamd` daemon
- On `FOUND` → file status set to `FAILED`, Kafka event `FILE_VIRUS_FOUND` published, file bytes deleted from storage
- On `OK` → proceeds to next pipeline step
- On ClamAV timeout → configurable: fail-open (proceed) or fail-closed (reject)

### 7.8 Deduplication

Optional, feature-flagged via `DEDUPLICATION_ENABLED=true`:

1. Compute SHA-256 of uploaded bytes
2. Query `files` table: `WHERE checksum = $1 AND service = $2 AND deleted = false`
3. If match found → reuse existing `storagePath`, create new metadata record pointing to same physical file
4. Different ownership, same bytes → one physical file, two metadata rows

---

## 8. File Lifecycle Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  HTTP Request (multipart/upload)                                │
│    │                                                            │
│    ▼                                                            │
│  [Auth Middleware]  ← validates JWT, checks file.upload scope  │
│    │                                                            │
│    ▼                                                            │
│  [Multipart Parser] ← streams file, never buffers entirely     │
│    │                                                            │
│    ▼                                                            │
│  [Validator]        ← MIME from magic bytes, size limit, ext   │
│    │                                                            │
│    ▼                                                            │
│  [SHA-256 streaming checksum computed]                         │
│    │                                                            │
│    ▼                                                            │
│  [Deduplication check] (optional)                              │
│    │                                                            │
│    ▼                                                            │
│  [Write to temp storage] ← MinIO tmp/uploads/{uuid}.bin        │
│    │                                                            │
│    ▼                                                            │
│  [DB record created] ← status: PENDING                         │
│    │                                                            │
│    └──────────────────────────────────────────────────────────►│
│                                                                 │
│  Response 201 returned to client immediately                    │
└─────────────────────────────────────────────────────────────────┘

Background (workers pick up PENDING files from DB):

  PENDING → [VirusScanWorker]    → status: SCANNING
           → pass: PROCESSING
           → fail: FAILED + Kafka FILE_VIRUS_FOUND

  PROCESSING → [CompressionWorker]  (if compress=true)
  PROCESSING → [ThumbnailWorker]    (if image MIME)
  PROCESSING → [MetadataWorker]     (always)

  All workers done → [Move from tmp/ to permanent path]
                   → status: AVAILABLE
                   → Kafka: FILE_UPLOADED

  AVAILABLE → client can download/stream

  DELETE (soft) → status: DELETED, deleted=true, deletedAt=now()
  CleanupWorker (runs daily) → permanent delete after 30 days
```

---

## 9. Security Strategy

| Threat | Mitigation |
|--------|-----------|
| Unauthorized access | JWT validation on every request via Auth Service public key |
| Wrong service accessing files | `service` claim in JWT compared to `files.service` column |
| Path traversal | Never use original filename in storage path; UUID only |
| Malware | ClamAV scan before `AVAILABLE` (feature-flagged) |
| Oversized uploads | `MAX_UPLOAD_SIZE` env var, checked during multipart streaming |
| MIME spoofing | Detect MIME from magic bytes using `file-type` library, ignore client-provided header |
| Extension spoofing | Allowed extensions configurable, magic bytes take precedence |
| SHA-256 integrity | Checksum stored and can be verified on download |
| Rate limiting | Per-IP + per-user rate limits via Redis (existing API Gateway rate limiter + FMS own) |
| Storage path exposure | `storagePath` is **never** returned to client in any response |
| Signed URL abuse | TTL-limited, single-use tokens via MinIO presigned URLs |
| Mass enumeration | `GET /api/v1/files` always scoped to caller's `service` from JWT; no cross-service listing |

### Authorization Scopes

| Scope | Actions |
|-------|---------|
| `file.upload` | POST /files, POST /files/batch, POST /uploads/* |
| `file.read` | GET /files/:id, GET /files/:id/download, /stream, /view |
| `file.delete` | DELETE /files/:id |
| `file.admin` | List all files across services, force delete, restore |

---

## 10. Event System (Kafka)

### Topics published by FMS

| Topic | Trigger | Payload |
|-------|---------|---------|
| `file.uploaded` | File reaches AVAILABLE | `{ fileId, service, module, referenceId, mimeType, size, ownerId }` |
| `file.deleted` | Soft delete | `{ fileId, service, module, referenceId, deletedBy }` |
| `file.processed` | Worker pipeline complete | `{ fileId, service, thumbnails, metadata }` |
| `file.virus.found` | ClamAV scan positive | `{ fileId, service, module, originalName, threat }` |
| `file.permanently.deleted` | CleanupWorker removes after 30d | `{ fileId, service, module }` |

### Topics consumed by FMS

| Topic | Action |
|-------|--------|
| `case.deleted` | Mark all files for that `referenceId` as pending permanent deletion |

### Consumers in other services

| Consumer | Topic | Action |
|----------|-------|--------|
| Case Service | `file.uploaded` | Trigger OCR pipeline if PDF |
| Notification Service | `file.uploaded` | Notify case assignees |
| Audit Service | `file.uploaded`, `file.deleted` | Append to audit trail |

---

## 11. Background Workers

Workers run in a **separate Docker container** (`file-service-workers`) on the production server. This prevents heavy operations (video compression, virus scanning, thumbnail generation) from competing with the upload/download HTTP server for CPU time on the 8-core production machine.

In local development, workers run in the same Node.js process as the HTTP server for simplicity (controlled by `WORKER_MODE=embedded` vs `WORKER_MODE=standalone` env var).

| Worker | Trigger | Interval / Event |
|--------|---------|-----------------|
| `VirusScanWorker` | File with status PENDING | Polls DB every 5s or Kafka event |
| `CompressionWorker` | File with status PROCESSING, compress=true | Polls DB or Kafka |
| `ThumbnailWorker` | File with status PROCESSING, mimeType image/* | Polls DB or Kafka |
| `MetadataWorker` | File with status PROCESSING | Always runs |
| `CleanupWorker` | Files where `scheduledDeleteAt IS NOT NULL AND scheduledDeleteAt < now()` | Runs every 24h (cron) |
| `RetryWorker` | Files with status FAILED, retryCount < MAX | Runs every 1h |
| `ExpiredChunkWorker` | ChunkUploads with expiresAt < now() | Runs every 1h |

Worker pipeline coordination:

- Workers use Redis distributed lock (`fms:lock:worker:{fileId}`) to prevent concurrent processing of the same file
- Each worker transitions status atomically: `UPDATE files SET status = 'SCANNING' WHERE id = $1 AND status = 'PENDING'`
- On failure, increment `retryCount`, set next `retryAt`, set status back to `FAILED`
- CleanupWorker respects `service_retention_policies`: files with `retentionDays = null` are **never** permanently deleted regardless of how long ago they were soft-deleted

---

## 12. Configuration

`config/index.ts` reads from environment and exports a typed config object:

```typescript
const config = {
  port: 3009,
  storage: {
    provider: 'minio' | 's3' | 'azure' | 'local',
    minio: { endpoint, port, accessKey, secretKey, bucket, useSSL },
    s3: { region, bucket, accessKeyId, secretAccessKey },
    local: { basePath },
  },
  compression: {
    image: { enabled: true, format: 'webp', quality: 80 },
    video: { enabled: false, codec: 'h264', crf: 23 },
    document: { enabled: false },
  },
  thumbnail: { enabled: true, sizes: [100, 250, 500] },
  virusScan: { enabled: false, host: 'clamav', port: 3310, timeout: 30000 },
  deduplication: { enabled: false },
  upload: {
    maxSizeMb: 102400,          // 100 GB
    streamThresholdMb: 20,
    allowedExtensions: [],       // empty = allow all
    blockedExtensions: ['.exe', '.sh', '.bat', '.cmd', '.ps1'],
  },
  chunk: {
    maxChunkSizeMb: 10,
    chunkTtlHours: 24,
  },
  retention: {
    defaultSoftDeleteDays: 30,  // fallback for services with no policy row in DB
    // Per-service rules are stored in service_retention_policies table, not config
  },
  kafka: {
    brokers: ['kafka:29092'],
    groupId: 'file-service',
  },
  redis: { url: 'redis://redis:6379' },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    authServiceUrl: process.env.AUTH_SERVICE_URL,
  },
  workerMode: 'embedded' | 'standalone',  // embedded = same process (dev), standalone = separate container (prod)
};
```

---

## 13. Build Phases

### Phase 1 — Foundation (Week 1)

**Goal:** Service boots, uploads single files, stores in MinIO, metadata in Postgres.

Deliverables:
- [ ] Project scaffold (TypeScript **4.x / 5.x**, Node.js **22 LTS**, Express, Prisma, pino logger)
- [ ] MinIO + ClamAV added to `docker-compose.yml`
- [ ] Prisma models: `File`, `ChunkUpload`, `Chunk`
- [ ] `StorageFactory` + `MinIOStorage` adapter
- [ ] `LocalStorage` adapter (for testing without MinIO)
- [ ] `POST /api/v1/files` — single upload, streaming multipart, SHA-256, write to MinIO, create DB record
- [ ] `StoragePath` value object
- [ ] `GET /api/v1/files/:id` — metadata only
- [ ] `GET /health`, `GET /ready`
- [ ] Auth middleware (JWT validate)
- [ ] API Gateway route forwarding to `file-service:3009`
- [ ] Basic Zod validators
- [ ] Seed `service_retention_policies` table with defaults (case-management=forever, chat=90d, hr=7yr)

### Phase 2 — Download, Stream, View (Week 2)

Deliverables:
- [ ] `GET /api/v1/files/:id/download` — full download
- [ ] `GET /api/v1/files/:id/view` — inline view
- [ ] `GET /api/v1/files/:id/stream` — Range header + 206 response
- [ ] `DELETE /api/v1/files/:id` — soft delete
- [ ] `GET /api/v1/files` — list/search with filters
- [ ] `GET /api/v1/files/:id/signed-url`
- [ ] Scope middleware (`file.read`, `file.delete`)
- [ ] Unit tests for domain layer

### Phase 3 — Batch Upload + Chunked Upload (Week 3)

Deliverables:
- [ ] `POST /api/v1/files/batch` — up to 100 files
- [ ] `POST /api/v1/uploads/init`
- [ ] `PUT /api/v1/uploads/:id/chunks/:number`
- [ ] `POST /api/v1/uploads/:id/complete`
- [ ] `GET /api/v1/uploads/:id/status` (resume support)
- [ ] Redis chunk state tracking
- [ ] `ExpiredChunkWorker`
- [ ] Integration tests for chunked upload

### Phase 4 — Worker Pipeline (Week 4)

Deliverables:
- [ ] Worker framework (poll loop + Redis distributed lock)
- [ ] `VirusScanWorker` + ClamAV integration
- [ ] `CompressionWorker` + `ImageCompressor` (Sharp)
- [ ] `ThumbnailWorker` (Sharp, 3 sizes)
- [ ] `MetadataWorker` (exifr, ffprobe, pdf-parse)
- [ ] `CleanupWorker` (permanent delete after 30d)
- [ ] `RetryWorker`
- [ ] File lifecycle status transitions
- [ ] Kafka publisher: `file.uploaded`, `file.processed`, `file.deleted`

### Phase 5 — Events, Security Hardening, Observability (Week 5)

Deliverables:
- [ ] Kafka consumer: `case.deleted` → cascade soft delete
- [ ] `CompressionWorker` + `VideoCompressor` (FFmpeg — toggled off by default)
- [ ] `ZipCompressor`
- [ ] Magic-byte MIME detection (`file-type` library)
- [ ] Deduplication service (feature-flagged)
- [ ] Signed URL generation + caching in Redis
- [ ] `GET /metrics` Prometheus counters (uploads/s, error rate, processing queue depth)
- [ ] Rate limiting middleware (per-user upload rate)
- [ ] Full E2E test suite
- [ ] Postman collection for FMS

### Phase 6 — Polish & Production Readiness (Week 6)

Deliverables:
- [ ] S3 storage adapter
- [ ] File versioning (optional, `versionOf` FK on `files` table)
- [ ] Configurable retention policies per `service` (extend `files` schema)
- [ ] Structured audit events → Audit Service
- [ ] `file.admin` scope — cross-service listing
- [ ] Load test (k6) — 100 concurrent uploads, 10GB file chunked
- [ ] Docker multi-stage build optimization
- [ ] Documentation: `docs/FMS_API.md`

---

## 14. Environment Variables

```env
# Service
PORT=3009
# Worker mode: 'embedded' (dev - same process) | 'standalone' (prod - separate container)
WORKER_MODE=embedded
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/iacms?schema=public

# Auth
JWT_SECRET=change-this-secret-key
AUTH_SERVICE_URL=http://auth-service:3001

# Storage
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=iacms-files
MINIO_USE_SSL=false

# Redis
REDIS_URL=redis://redis:6379

# Kafka
KAFKA_BROKERS=kafka:29092
KAFKA_GROUP_ID=file-service

# Upload limits
MAX_UPLOAD_SIZE_MB=102400
STREAM_THRESHOLD_MB=20
BLOCKED_EXTENSIONS=.exe,.sh,.bat,.cmd,.ps1

# Features
VIRUS_SCAN_ENABLED=false
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
THUMBNAIL_ENABLED=true
THUMBNAIL_SIZES=100,250,500
COMPRESSION_IMAGE_ENABLED=true
COMPRESSION_IMAGE_FORMAT=webp
COMPRESSION_IMAGE_QUALITY=80
COMPRESSION_VIDEO_ENABLED=false
DEDUPLICATION_ENABLED=false

# Retention
# Per-service retention is stored in the service_retention_policies DB table.
# This is the fallback for any service that has no policy row.
DEFAULT_SOFT_DELETE_DAYS=30

# Chunk uploads
MAX_CHUNK_SIZE_MB=10
CHUNK_TTL_HOURS=24
```

---

## 15. Docker Compose Integration

The following blocks will be added to `infrastructure/docker-compose.yml`:

```yaml
  # MinIO — S3-compatible object storage (data-network only, never exposed to clients)
  minio:
    image: minio/minio:latest
    container_name: iacms-minio
    command: server /data --console-address ":9001"
    ports:
      - "127.0.0.1:9000:9000"    # API — localhost only, NOT public
      - "127.0.0.1:9001:9001"    # Console UI — localhost only
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - data-network

  # MinIO init — creates bucket on first boot
  minio-init:
    image: minio/mc:latest
    container_name: iacms-minio-init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 minioadmin minioadmin;
        mc mb --ignore-existing local/iacms-files;
        mc anonymous set none local/iacms-files;
        exit 0;
      "
    networks:
      - data-network

  # ClamAV — virus scanning (data-network only)
  clamav:
    image: clamav/clamav:stable
    container_name: iacms-clamav
    volumes:
      - clamav_data:/var/lib/clamav
    healthcheck:
      test: ["CMD", "clamdcheck.sh"]
      interval: 60s
      timeout: 30s
      retries: 3
      start_period: 120s
    networks:
      - data-network

  # File Management Service — HTTP server only
  file-service:
    build:
      context: ..
      dockerfile: services/file-service/Dockerfile
    container_name: iacms-file-service
    ports:
      - "3009:3009"
    environment:
      PORT: 3009
      WORKER_MODE: embedded          # change to 'standalone' on production when worker container is running
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/iacms?schema=public
      KAFKA_BROKERS: kafka:29092
      JWT_SECRET: change-this-secret-key
      AUTH_SERVICE_URL: http://auth-service:3001
      REDIS_URL: redis://redis:6379
      STORAGE_PROVIDER: minio
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
      MINIO_BUCKET: iacms-files
      MINIO_USE_SSL: "false"
      VIRUS_SCAN_ENABLED: "false"    # true on production server
      CLAMAV_HOST: clamav
      THUMBNAIL_ENABLED: "true"
      COMPRESSION_IMAGE_ENABLED: "true"
      COMPRESSION_VIDEO_ENABLED: "false"   # true on production server
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks:
      - backend-network
      - data-network

  # File Management Workers — separate container (production)
  # In development, set WORKER_MODE=embedded on file-service and disable this container
  file-service-workers:
    build:
      context: ..
      dockerfile: services/file-service/Dockerfile.workers
    container_name: iacms-file-workers
    environment:
      WORKER_MODE: standalone
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/iacms?schema=public
      KAFKA_BROKERS: kafka:29092
      REDIS_URL: redis://redis:6379
      STORAGE_PROVIDER: minio
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
      MINIO_BUCKET: iacms-files
      VIRUS_SCAN_ENABLED: "true"
      CLAMAV_HOST: clamav
      THUMBNAIL_ENABLED: "true"
      COMPRESSION_IMAGE_ENABLED: "true"
      COMPRESSION_VIDEO_ENABLED: "true"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka:
        condition: service_healthy
      minio:
        condition: service_healthy
      clamav:
        condition: service_healthy
    networks:
      - data-network

# Add to volumes section:
# minio_data:
# clamav_data:
```

---

## 16. API Gateway Routing

Add the following proxy rule to `services/api-gateway/src/`:

```
/api/v1/files/*     → http://file-service:3009
/api/v1/uploads/*   → http://file-service:3009
```

Also add to the gateway's `docker-compose.yml` environment:

```yaml
FILE_SERVICE_URL: http://file-service:3009
```

And update gateway's service table in `README.md`:

| File Service | 3009 | File upload, download, stream, chunk, metadata |

---

## 17. Testing Strategy

### Unit Tests (`tests/unit/`)

- Domain entities and value objects (pure functions, no I/O)
- `StoragePath.build()` — correct path format
- `MimeTypeGuard` — blocked/allowed detection
- `FileChecksum` — SHA-256 correctness
- `CompressionFactory` — correct provider selection by MIME

### Integration Tests (`tests/integration/`)

- Upload a real file → verify it lands in MinIO + metadata in DB
- Download the uploaded file → verify bytes match
- Chunked upload (5 chunks) → complete → verify merged file
- Resume after simulated failure (skip chunk 3, retry chunk 3)
- Soft delete → verify `deleted=true` in DB, storage still present
- `CleanupWorker` — move `deletedAt` back 31 days → run worker → verify storage deleted

### E2E Tests (`tests/e2e/`)

- Full lifecycle: upload PDF → wait for AVAILABLE status → download → compare checksum
- Video stream with Range header → verify 206 response + correct byte range
- Batch upload 10 images → verify all 10 in DB
- Cross-service isolation: upload as `service: chat`, attempt to list as `service: case-management` → verify 0 results
- Virus scan mock: inject EICAR test string → verify file status = FAILED

### Monitoring Integration

The service exposes `GET /metrics` in Prometheus exposition format. In the production monitoring stack (Prometheus + Grafana + Loki):

- **Prometheus** scrapes `/metrics` every 15s
- **Grafana** dashboard tracks: upload rate, processing queue depth, worker error rate, MinIO storage bytes used
- **Loki** receives structured JSON logs from pino (via Docker log driver or Promtail agent)
- **Alertmanager** fires on: worker error rate > 5%, upload failure rate > 1%, MinIO unreachable

---

## 18. Open Decisions / Resolved

### Resolved by server specification

| Item | Resolution |
|------|-----------|
| Azure / GCS adapters | ❌ **Removed entirely.** Dedicated server uses MinIO. No cloud blob storage needed. |
| ClamAV in dev | **OFF locally** (`VIRUS_SCAN_ENABLED=false` in dev `.env`). **ON on server** (`VIRUS_SCAN_ENABLED=true` in production `.env`). 32 GB RAM on server handles ClamAV signature DB comfortably. |
| Video compression (FFmpeg) | **OFF locally** (dev PC can't spare the CPU). **ON on server** (`COMPRESSION_VIDEO_ENABLED=true`). 8 vCPU dedicated server handles FFmpeg without impacting HTTP throughput. |
| Separate worker process | **Confirmed: separate container in production.** `file-service-workers` container on `data-network` with access to MinIO and ClamAV. Dev runs workers embedded in same process (`WORKER_MODE=embedded`). |
| Signed URLs / MinIO exposure | **MinIO is never exposed to clients.** Ports bound to `127.0.0.1` only on production server. All file access goes through FMS HTTP layer. Signed URLs are generated internally and the FMS proxies the actual bytes — client never sees a MinIO URL. |
| Node.js version | **Node.js 22 LTS** — matches server specification. |
| PostgreSQL version | **PostgreSQL 16+** on dedicated DB server. FMS metadata goes to the same dedicated DB host. |
| Per-service retention | **Implemented via `service_retention_policies` table.** Each service has its own `retentionDays` (null = forever). `case-management` = forever, `chat` = 90d, `hr` = 7yr. CleanupWorker respects per-row `scheduledDeleteAt`. Global `DEFAULT_SOFT_DELETE_DAYS` is fallback only. |
| OCR pipeline ownership | **FMS has zero OCR code.** FMS emits `file.uploaded` on Kafka when a file becomes AVAILABLE. Case Service listens and runs its own OCR worker. Other services ignore the event or handle it as they see fit. |

### Still open (needs future decision)

| Item | Decision Needed | Default for Now |
|------|----------------|------------------|
| File versioning | If a document is re-uploaded as a new version, keep old version or overwrite? | Every upload is independent; caller manages which `fileId` is "current" |
| Content-addressable dedup | Same bytes from different services → one physical copy? Risk of cross-tenant data entanglement. | Feature-flagged off (`DEDUPLICATION_ENABLED=false`) |
| OIDC / OAuth2 auth | Keycloak / OIDC upgrade path | JWT from existing IACMS Auth Service; `JwtValidator` is behind interface for easy swap |
| Signed URL Redis caching | Cache presigned URL in Redis for TTL duration to avoid duplicate MinIO calls | No cache in Phase 1–4; added in Phase 5 |
| MinIO dedicated storage volume | MinIO file storage is NOT included in current server spec storage budget | ⚠️ Needs additional disk/volume — recommend 1–2 TB separate mount at `/mnt/storage/minio` |
| S3 storage adapter | Only needed if deployment ever migrates to cloud | Stub present in codebase, not built out |

---

*Document maintained by: IACMS Platform Team*  
*Last updated: Phase planning — pre-implementation*
