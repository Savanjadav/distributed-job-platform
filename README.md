# JobPulse

**Distributed Job Processing & Observability Platform**

JobPulse is a TypeScript-based distributed asynchronous job-processing
platform built to demonstrate production-style backend engineering,
reliable background processing, observability, and operational alerting.

Clients authenticate through a Fastify API and submit jobs. The API
stores durable job metadata in PostgreSQL and enqueues work through
BullMQ/Redis. A separate worker processes jobs concurrently, retries
transient failures with exponential backoff, updates lifecycle state in
PostgreSQL, and moves jobs that exhaust all attempts into a
`DEAD_LETTER` state.

The platform also includes Prometheus instrumentation, Grafana
dashboards, Grafana alerting, Slack incident notifications, Docker
Compose infrastructure, Jest/Supertest integration tests, and GitHub
Actions CI.

------------------------------------------------------------------------

## Table of Contents

-   [Why JobPulse?](#why-jobpulse)
-   [Key Features](#key-features)
-   [Technology Stack](#technology-stack)
-   [Architecture](#architecture)
-   [Repository Structure](#repository-structure)
-   [How the System Works](#how-the-system-works)
-   [Authentication and
    Authorization](#authentication-and-authorization)
-   [API Endpoints](#api-endpoints)
-   [Job Lifecycle](#job-lifecycle)
-   [Retry and Dead-Letter Semantics](#retry-and-dead-letter-semantics)
-   [Worker Processing](#worker-processing)
-   [PostgreSQL vs Redis](#postgresql-vs-redis)
-   [Observability](#observability)
-   [Prometheus Metrics](#prometheus-metrics)
-   [Grafana Dashboard](#grafana-dashboard)
-   [Alerting and Slack
    Notifications](#alerting-and-slack-notifications)
-   [Health and Diagnostics](#health-and-diagnostics)
-   [Local Development](#local-development)
-   [Service Ports](#service-ports)
-   [Testing](#testing)
-   [Continuous Integration](#continuous-integration)
-   [Important Design Decisions](#important-design-decisions)
-   [Known Caveats](#known-caveats)
-   [Future Improvements](#future-improvements)

------------------------------------------------------------------------

## Why JobPulse?

Many backend applications contain work that should not run inside the
original HTTP request. Examples include report generation, email
delivery, data processing, media conversion, notifications, imports, and
other long-running tasks.

Executing this work synchronously can make APIs slow and tightly couple
request handling to background work.

JobPulse separates these responsibilities:

1.  The API accepts and validates requests.
2.  PostgreSQL stores durable application state.
3.  BullMQ/Redis coordinates asynchronous execution.
4.  Workers process jobs independently.
5.  Retry logic handles transient failures.
6.  Dead-letter handling records terminal failures.
7.  Prometheus and Grafana expose system behavior.
8.  Grafana alerts route operational incidents to Slack.

The project therefore focuses not only on *running a background job*,
but on the surrounding engineering required to operate a job-processing
system reliably.

------------------------------------------------------------------------

## Key Features

-   TypeScript/Node.js backend
-   Fastify REST API
-   JWT authentication
-   bcrypt password hashing
-   USER and ADMIN role-based access control
-   Per-user job ownership
-   PostgreSQL durable job state
-   Prisma ORM
-   BullMQ asynchronous queues
-   Redis queue backend
-   Concurrent worker processing
-   Exponential retry/backoff
-   Cancellation requests
-   Dead-letter handling after retry exhaustion
-   ADMIN-only manual dead-letter recovery
-   Prometheus counters, gauges, histograms, and Node.js process metrics
-   Grafana operational dashboards
-   Job-level success/failure KPIs
-   Rolling throughput, retry, and failure-rate monitoring
-   p95 processing latency
-   Grafana alert rules
-   Slack incident notifications
-   Docker Compose infrastructure
-   Persistent PostgreSQL, Prometheus, and Grafana volumes
-   Jest + Supertest integration testing
-   12 passing integration tests
-   GitHub Actions CI with PostgreSQL and Redis services

------------------------------------------------------------------------

## Technology Stack

  Layer                Technology
  -------------------- ------------------------
  Language / Runtime   TypeScript, Node.js
  API                  Fastify
  Authentication       `@fastify/jwt`, bcrypt
  Authorization        JWT + RBAC
  Database             PostgreSQL
  ORM                  Prisma
  Queue                BullMQ
  Queue Backend        Redis
  Metrics              prom-client
  Monitoring           Prometheus
  Visualization        Grafana
  Alerting             Grafana Alerting
  Notifications        Slack
  Testing              Jest, Supertest
  CI                   GitHub Actions
  Infrastructure       Docker Compose
  Workspace            pnpm

------------------------------------------------------------------------

## Architecture

``` text
                         +------------------+
                         |      Client      |
                         +--------+---------+
                                  |
                                  | HTTP / JWT
                                  v
                         +------------------+
                         |   Fastify API    |
                         |      :3000       |
                         +----+---------+---+
                              |         |
                   Prisma     |         | BullMQ producer
                              |         |
                              v         v
                    +-------------+   +-------------+
                    | PostgreSQL  |   |    Redis    |
                    |    :5433    |   |    :6379    |
                    +------+------+   +------+------+
                           ^                 |
                           |                 | queue
                           |                 v
                           |          +-------------+
                           +----------|   Worker    |
                            updates   | concurrency |
                                     |     = 5     |
                                     +------+------+
                                            |
                                            | metrics :3002
                                            v
                                     +-------------+
API /prometheus -------------------->| Prometheus  |
                                     |    :9090    |
                                     +------+------+
                                            |
                                            v
                                     +-------------+
                                     |   Grafana   |
                                     |    :3001    |
                                     +------+------+
                                            |
                                      alert rules
                                            |
                                            v
                                     +-------------+
                                     |    Slack    |
                                     +-------------+
```

### Request and Processing Flow

``` text
User
  |
  | POST /jobs
  v
Fastify API
  |
  +--> Authenticate JWT
  |
  +--> Create job row in PostgreSQL
  |       status = QUEUED
  |
  +--> Add { jobId } to BullMQ
          |
          v
        Redis
          |
          v
        Worker
          |
          +--> Read job from PostgreSQL
          +--> Check cancellation
          +--> Set PROCESSING
          +--> Execute work
          |
          +--> success --> COMPLETED
          |
          +--> failure --> BullMQ retry
                              |
                              +--> later success --> COMPLETED
                              |
                              +--> attempts exhausted --> DEAD_LETTER
```

------------------------------------------------------------------------

## Repository Structure

``` text
distributed-job-platform/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── queue.ts
│   │   │   └── metrics.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── tests/
│   │       └── app.test.ts
│   │
│   └── worker/
│       └── src/
│           ├── worker.ts
│           └── metrics.ts
│
├── infra/
│   └── prometheus/
│       └── prometheus.yml
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── docker-compose.yml
└── pnpm-workspace.yaml
```

------------------------------------------------------------------------

## How the System Works

### 1. A user authenticates

A user registers or logs in through the API. Passwords are hashed with
bcrypt. A successful login returns a JWT containing the authenticated
user's identity and role.

### 2. The user creates a job

The authenticated client sends:

``` http
POST /jobs
Authorization: Bearer <JWT>
Content-Type: application/json
```

The API:

-   generates a job ID,
-   associates the job with the authenticated user,
-   persists the job in PostgreSQL,
-   sets its initial state to `QUEUED`,
-   and adds the job ID to BullMQ.

### 3. BullMQ coordinates execution

Redis stores BullMQ's queue coordination and retry execution state. The
worker consumes jobs independently from the API.

### 4. The worker processes the job

The worker retrieves the corresponding PostgreSQL record, checks
cancellation, marks the job `PROCESSING`, increments the attempt count,
and performs the work.

The development version deliberately uses simulated failures to exercise
retry and dead-letter behavior.

### 5. The job reaches a terminal outcome

A successful job becomes:

``` text
COMPLETED
```

A failed attempt can be retried. If all configured attempts are
exhausted, the job becomes:

``` text
DEAD_LETTER
```

An administrator can manually requeue a dead-letter job.

------------------------------------------------------------------------

## Authentication and Authorization

JobPulse implements JWT-based authentication and role-based
authorization.

### Roles

``` text
USER
ADMIN
```

### USER permissions

A normal user can:

-   authenticate,
-   create jobs,
-   list their own jobs,
-   retrieve their own job,
-   request cancellation of their own job.

A normal user cannot access another user's jobs simply by knowing the
job ID.

### ADMIN permissions

An administrator can:

-   view jobs across users,
-   access the admin job summary,
-   manually retry jobs in `DEAD_LETTER`,
-   perform privileged job operations defined by the API.

### Multi-user ownership

Each database job is associated with a `userId`.

``` text
User A
├── Job A1
├── Job A2
└── Job A3

User B
├── Job B1
└── Job B2
```

Application-level user/job queries belong in PostgreSQL. Operational
Prometheus metrics should remain bounded and should not automatically
use arbitrary user IDs as metric labels because that can create
high-cardinality time series.

------------------------------------------------------------------------

## API Endpoints

  --------------------------------------------------------------------------
  Method            Route                Access            Purpose
  ----------------- -------------------- ----------------- -----------------
  `POST`            `/auth/register`     Public            Register a USER
                                                           or ADMIN account

  `POST`            `/auth/login`        Public            Validate
                                                           credentials and
                                                           issue a JWT

  `GET`             `/`                  Public            Service overview
                                                           / available
                                                           endpoints

  `GET`             `/health`            Public            System and
                                                           database
                                                           diagnostic
                                                           information

  `GET`             `/jobs`              Authenticated     USER sees own
                                                           jobs; ADMIN sees
                                                           all

  `GET`             `/jobs/:id`          Authenticated     Fetch a job with
                                                           ownership/admin
                                                           checks

  `POST`            `/jobs`              Authenticated     Create and
                                                           enqueue a new job

  `POST`            `/jobs/:id/cancel`   Authenticated     Request job
                                                           cancellation

  `POST`            `/jobs/:id/retry`    ADMIN             Manually retry a
                                                           `DEAD_LETTER` job

  `GET`             `/metrics`           ADMIN             JSON job summary

  `GET`             `/prometheus`        Prometheus        API Prometheus
                                                           scrape endpoint
  --------------------------------------------------------------------------

> `POST /auth/login` is not a browser page. Opening `/auth/login`
> directly in a browser sends a `GET` request and therefore does not
> invoke the login endpoint.

### Example Registration

``` bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password"
  }'
```

### Example Login

``` bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password"
  }'
```

Save the returned JWT and use it for protected endpoints:

``` bash
export TOKEN="<your-jwt>"
```

### Create a Job

``` bash
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "example",
    "delayMs": 2000
  }'
```

### List Jobs

``` bash
curl http://localhost:3000/jobs \
  -H "Authorization: Bearer $TOKEN"
```

### Fetch One Job

``` bash
curl http://localhost:3000/jobs/<job-id> \
  -H "Authorization: Bearer $TOKEN"
```

### Request Cancellation

``` bash
curl -X POST http://localhost:3000/jobs/<job-id>/cancel \
  -H "Authorization: Bearer $TOKEN"
```

### Retry a Dead-Letter Job

This operation requires an ADMIN JWT.

``` bash
curl -X POST http://localhost:3000/jobs/<job-id>/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

------------------------------------------------------------------------

## Job Lifecycle

``` text
                   +----------+
                   |  QUEUED  |
                   +----+-----+
                        |
                        v
                 +-------------+
                 | PROCESSING  |
                 +------+------+ 
                        |
             +----------+----------+
             |                     |
          success                failure
             |                     |
             v                     v
       +-----------+         retry available?
       | COMPLETED |           /        \
       +-----------+         yes         no
                              |           |
                              v           v
                         PROCESSING   +-------------+
                                      | DEAD_LETTER |
                                      +------+------+
                                             |
                                      ADMIN manual retry
                                             |
                                             v
                                          QUEUED
```

Cancellation is requested through the database and checked by the worker
before processing. A cancelled job can be transitioned to `CANCELLED`.

------------------------------------------------------------------------

## Retry and Dead-Letter Semantics

One of the most important design rules in JobPulse is:

> **A failed processing attempt is not the same as a permanently failed
> job.**

Consider:

``` text
Attempt 1 -> failed
Attempt 2 -> failed
Attempt 3 -> succeeded
```

The job-level result is:

``` text
COMPLETED
```

Operationally, however, the system experienced:

``` text
Failed attempts: 2
Retries:         2
Dead-letter:     0
```

This distinction is important for both application state and monitoring.

The project commonly uses:

``` text
attempts: 3
backoff:
  type: exponential
  delay: 1000 ms
```

After retry exhaustion:

``` text
DEAD_LETTER
```

represents the terminal job-level failure.

An administrator can manually recover a dead-letter job:

``` text
DEAD_LETTER
     |
     | POST /jobs/:id/retry
     v
Reset attempts/status
     |
     v
QUEUED
     |
     v
BullMQ
     |
     v
Worker
```

------------------------------------------------------------------------

## Worker Processing

The worker consumes the BullMQ queue named `jobs`.

Its responsibilities include:

1.  Receive a BullMQ job.
2.  Extract the durable job ID.
3.  Look up the job in PostgreSQL.
4.  Check whether cancellation was requested.
5.  Mark the job `PROCESSING`.
6.  Increment the durable attempt count.
7.  Execute the workload.
8.  Update successful jobs to `COMPLETED`.
9.  Allow BullMQ to retry failed attempts.
10. Mark retry-exhausted jobs `DEAD_LETTER`.
11. Update Prometheus metrics.

Worker concurrency is currently:

``` text
5
```

This allows multiple jobs to be processed concurrently rather than
forcing the queue to execute one job at a time.

------------------------------------------------------------------------

## PostgreSQL vs Redis

JobPulse deliberately separates durable application state from queue
execution state.

### PostgreSQL

PostgreSQL is the source of truth for durable job information, including
concepts such as:

-   job ID,
-   owner/user ID,
-   payload,
-   job type,
-   priority,
-   status,
-   maximum attempts,
-   attempts made,
-   cancellation state,
-   creation/update timestamps.

### Redis / BullMQ

Redis and BullMQ manage execution concerns such as:

-   queued work,
-   active jobs,
-   retry scheduling,
-   delayed retries,
-   exponential backoff,
-   worker coordination.

In short:

``` text
PostgreSQL = durable application state
Redis      = queue coordination / execution state
```

This separation also matters during debugging: a PostgreSQL row and a
BullMQ queue entry describe related but different aspects of the same
job.

------------------------------------------------------------------------

## Observability

JobPulse instruments both the API and worker with Prometheus-compatible
metrics.

``` text
API -------------------+
                       |
                       v
                  Prometheus
                       ^
                       |
Worker ----------------+
                       |
                       v
                    Grafana
```

The project uses three major Prometheus metric types.

### Counters

Counters represent cumulative events and only increase during the
lifetime of a process.

Examples:

-   jobs created,
-   jobs completed,
-   failed attempts,
-   retries,
-   dead-letter jobs.

### Gauges

Gauges represent current state and can move up or down.

Examples:

-   queue depth,
-   active jobs.

### Histograms

Histograms capture distributions such as job processing duration and
allow percentile calculations such as p95.

------------------------------------------------------------------------

## Prometheus Metrics

Representative metrics used by the platform include:

``` text
jobs_created_total
jobs_queue_total

worker_jobs_completed_total
worker_jobs_failed_total
worker_jobs_retried_total
worker_jobs_dead_letter_total

worker_active_jobs

worker_job_processing_duration_seconds
```

Depending on the current code version, additional instrumentation may
exist. The important part is the metric semantics below.

### Metric Semantics

  ---------------------------------------------------------------------------------------
  Metric / Panel          Type / Query Style                      Meaning
  ----------------------- --------------------------------------- -----------------------
  Jobs Created            Counter                                 Jobs created since API
                                                                  metrics process start

  Jobs Completed          Counter                                 Successful terminal
                                                                  outcomes

  Dead Letter             Counter                                 Permanent job failures

  Queue Depth             Gauge                                   Current queued/backlog
                                                                  state

  Active Jobs             Gauge                                   Current worker
                                                                  concurrency

  Memory Usage            Process metric                          Node.js resident memory

  API Uptime              `time() - process_start_time_seconds`   Current API process
                                                                  uptime

  Processing p95          Histogram + `histogram_quantile`        95th percentile
                                                                  processing latency

  Throughput              `rate(...[5m])`                         Recent successful
                                                                  completions/sec

  Retry Rate              `rate(...[5m])`                         Recent retry activity

  Failed Attempts         Failed-attempt counter/rate             Attempt-level
                                                                  instability

  Overall Success Rate    Completed / terminal outcomes           Stable job-level
                                                                  success KPI

  Recent Failure Rate     Rolling dead-letter / terminal outcomes Current
                                                                  permanent-failure
                                                                  condition
  ---------------------------------------------------------------------------------------

### Processing p95

``` promql
histogram_quantile(
  0.95,
  rate(worker_job_processing_duration_seconds_bucket[5m])
)
```

### Throughput

``` promql
rate(worker_jobs_completed_total[5m])
```

### Retry Rate

``` promql
rate(worker_jobs_retried_total[5m])
```

### Overall Job-Level Success Rate

``` promql
100 *
worker_jobs_completed_total
/
(
  worker_jobs_completed_total
  +
  worker_jobs_dead_letter_total
)
```

### Overall Job-Level Failure Rate

``` promql
100 *
worker_jobs_dead_letter_total
/
(
  worker_jobs_completed_total
  +
  worker_jobs_dead_letter_total
)
```

### Recent Job-Level Failure Rate

``` promql
100 *
rate(worker_jobs_dead_letter_total[5m])
/
(
  rate(worker_jobs_dead_letter_total[5m])
  +
  rate(worker_jobs_completed_total[5m])
)
```

### Why `worker_jobs_failed_total` Is Not the Job Failure Rate

If one job fails twice and succeeds on its third attempt:

``` text
failed attempts = 2
completed jobs  = 1
dead-letter     = 0
```

Using failed attempts as the numerator of a permanent job failure KPI
would incorrectly classify a successful job as a failure.

For job-level reliability:

``` text
COMPLETED vs DEAD_LETTER
```

is the correct terminal-outcome comparison.

------------------------------------------------------------------------

## Grafana Dashboard

The dashboard is organized around different operational questions rather
than treating every metric the same way.

### Ingress / API Health

Typical panels:

-   Jobs Created
-   Queue Depth
-   Memory Usage
-   API Uptime

### Worker / Processing

Typical panels:

-   Jobs Completed
-   Dead-Letter Jobs
-   Active Jobs
-   Processing Duration p95

### Real-Time Performance

Typical panels:

-   Throughput over a rolling 5-minute window
-   Retry Rate over a rolling 5-minute window
-   Recent failure / failed-attempt activity

### Reliability / KPIs

Typical panels:

-   Overall Success Rate
-   Overall Failure Rate
-   Recent Job Failure Rate

### Active Jobs Visualization

Jobs may finish quickly enough that a simple active-job stat frequently
returns to zero before a person sees the load.

A time-series view or smoothed query can preserve the activity shape:

``` promql
avg_over_time(worker_active_jobs[1m])
```

------------------------------------------------------------------------

## Alerting and Slack Notifications

Grafana Alerting monitors operational conditions and sends notifications
through a Slack contact point.

The primary alert developed for the project is a recent high worker/job
failure-rate alert.

A representative local/demo configuration is:

  Setting               Value / Intent
  --------------------- --------------------------------
  Evaluation window     5 minutes
  Evaluation interval   Approximately 10 seconds
  Pending period        Approximately 1 minute
  Example threshold     Recent job failure rate \> 10%
  Severity              Critical
  Service / component   Worker
  Environment           Development

These values serve different purposes:

``` text
[5m]
```

means:

> Calculate using events from the previous five minutes.

An evaluation interval of approximately 10 seconds means:

> Recalculate the rule about every ten seconds.

A one-minute pending period means:

> Require the condition to remain bad for approximately one minute
> before firing.

They are not interchangeable concepts.

### Slack Notification Content

The custom Grafana notification design includes information such as:

-   alert status,
-   service/component,
-   environment,
-   severity,
-   metrics target,
-   evaluation window,
-   threshold,
-   current failure rate,
-   trigger time,
-   summary/description,
-   recommended actions,
-   dashboard/panel/query links,
-   optional runbook URL.

For local development, a worker target may appear as:

``` text
host.docker.internal:3002
```

In human-facing alert text, this is described as the **Metrics Target**
rather than a "Prometheus job" to avoid confusion with application jobs.

### Rolling Window Behavior

A rolling `[5m]` alert may return to normal simply because old failures
aged out of the five-minute window.

That does **not** necessarily mean someone repaired the service.

For this reason, rolling event-rate alerts should be interpreted
differently from persistent state-based health alerts.

------------------------------------------------------------------------

## Health and Diagnostics

### Root Endpoint

``` http
GET /
```

returns service metadata / available endpoint information so the API
root provides a useful response.

### Health Endpoint

``` http
GET /health
```

evolved beyond a simple database `SELECT 1` check.

The richer diagnostic endpoint can include information such as:

-   database connectivity,
-   job counts,
-   success/failure percentages,
-   queue information,
-   process uptime,
-   timestamp,
-   runtime/platform information,
-   component status.

Health information should be derived from real checks. A component
should not be reported as `running` or `connected` solely because a
static string says so.

------------------------------------------------------------------------

## Local Development

### Prerequisites

Install:

-   Node.js
-   pnpm
-   Docker Desktop
-   Docker Compose

The repository is structured as a pnpm workspace.

### 1. Clone the repository

``` bash
git clone <your-repository-url>
cd distributed-job-platform
```

### 2. Install dependencies

``` bash
pnpm install
```

### 3. Configure environment variables

The exact environment files depend on the repository version. At
minimum, the API requires a PostgreSQL connection and JWT secret.

A representative local configuration is:

``` env
DATABASE_URL="postgresql://<user>:<password>@localhost:5433/<database>"
JWT_SECRET="replace-with-a-local-development-secret"
```

Use the actual PostgreSQL credentials defined in your
`docker-compose.yml`.

Do not commit real secrets.

### 4. Start infrastructure

``` bash
docker compose up -d
```

The Compose environment provides supporting services such as PostgreSQL,
Redis, Prometheus, and Grafana.

### 5. Generate Prisma Client

From the appropriate API workspace/package:

``` bash
pnpm prisma generate
```

### 6. Apply Database Migrations

Use the migration command configured by the repository, for example:

``` bash
pnpm prisma migrate dev
```

### 7. Start the API

Run the API using the script defined in the API package's
`package.json`.

The API listens on:

``` text
http://localhost:3000
```

### 8. Start the Worker

Run the worker using the script defined in the worker package's
`package.json`.

The worker exposes metrics on:

``` text
http://localhost:3002/metrics
```

### 9. Open Prometheus

``` text
http://localhost:9090
```

### 10. Open Grafana

``` text
http://localhost:3001
```

> The exact npm/pnpm script names are intentionally not invented here.
> Use the scripts currently defined in the repository's `package.json`
> files.

------------------------------------------------------------------------

## Service Ports

  Service            Host Port Notes
  ---------------- ----------- -------------------------------------------
  Fastify API           `3000` API process
  Grafana               `3001` Container port 3000 exposed as 3001
  Worker Metrics        `3002` Worker Prometheus metrics endpoint
  PostgreSQL            `5433` Container PostgreSQL 5432 exposed as 5433
  Redis                 `6379` BullMQ backend
  Prometheus            `9090` Prometheus UI/API

Prometheus running inside Docker may use:

``` text
host.docker.internal
```

to scrape API/worker processes running directly on the host machine.
This is intentional for Docker Desktop local development.

------------------------------------------------------------------------

## Docker Persistence

The infrastructure is designed to preserve important local state using
named volumes.

Representative volumes include:

``` yaml
volumes:
  postgres_data:
  grafana_storage:
  prometheus_data:
```

The intent is:

``` text
postgres_data      -> PostgreSQL application data
grafana_storage    -> Grafana dashboards/configuration
prometheus_data    -> Prometheus history
```

Be careful with:

``` bash
docker compose down -v
```

The `-v` option removes named volumes and should only be used when
intentionally wiping persistent local data.

For normal shutdown:

``` bash
docker compose down
```

is safer.

### Grafana Root URL

Grafana runs internally on port `3000`, but the host exposes it on
`3001`.

The local configuration therefore uses the host-facing URL:

``` yaml
environment:
  GF_SERVER_ROOT_URL: "http://localhost:3001"
  GF_SERVER_DOMAIN: "localhost"
```

This prevents generated Grafana links from incorrectly pointing to the
Fastify API on `localhost:3000`.

------------------------------------------------------------------------

## Testing

JobPulse uses Jest and Supertest for integration testing.

The suite reached:

``` text
12 passing integration tests
```

Coverage includes:

-   health endpoint,
-   normal USER registration,
-   ADMIN registration,
-   login and JWT issuance,
-   rejection of unauthenticated job requests,
-   authenticated job creation,
-   USER job isolation,
-   ADMIN visibility across jobs,
-   cancellation of a user's own job,
-   rejection of USER access to admin metrics,
-   successful ADMIN access to metrics.

### Test Lifecycle Lessons

The test suite intentionally shares some state across dependent tests.
Cleaning users in `beforeEach` broke later login tests, so cleanup was
moved to `beforeAll` for that sequence.

Open resources can also cause Jest to hang after tests complete.

Important resources to close include:

-   Fastify,
-   Prisma,
-   BullMQ queue/Redis connections.

Conceptually:

``` text
afterAll
├── app.close()
├── prisma.$disconnect()
└── jobQueue.close()
```

The exact cleanup should match the objects actually opened by the test
suite.

------------------------------------------------------------------------

## Continuous Integration

GitHub Actions runs automated integration tests against service
dependencies.

The CI pipeline provisions:

``` text
PostgreSQL
Redis
```

and performs the major stages:

``` text
Checkout repository
        |
        v
Install workspace dependencies
        |
        v
Generate Prisma Client
        |
        v
Run database migrations
        |
        v
Execute integration tests
```

Important CI issues addressed during development included:

-   duplicate pnpm version configuration,
-   incorrect working directories,
-   using the correct PostgreSQL port inside GitHub Actions,
-   Prisma client generation/migrations,
-   Node.js version compatibility.

The CI database connection differs from the local host mapping: GitHub
Actions' PostgreSQL service is reached on its CI service port rather
than the Mac's local `5433 -> 5432` mapping.

------------------------------------------------------------------------

## Important Design Decisions

### 1. Persist before enqueueing

The API creates the durable PostgreSQL job record before adding work to
BullMQ.

This gives the application a durable identity/state record for the job.

### 2. Keep API and worker separate

The API accepts requests; the worker performs asynchronous work.

This reduces coupling between HTTP request latency and background
processing.

### 3. Let BullMQ manage retry execution

Retries use BullMQ's configured attempts and exponential backoff instead
of building a separate custom retry scheduler.

### 4. Treat `DEAD_LETTER` as terminal failure

Failed attempts are operational events. `DEAD_LETTER` represents a job
that ultimately failed after exhausting retries.

### 5. Separate durable state from telemetry

PostgreSQL records application state. Prometheus records operational
telemetry.

They should not be expected to contain identical lifetime counts.

### 6. Use counters, gauges, and histograms according to semantics

A cumulative event is not a gauge. A current queue depth is not a
counter. A latency distribution is better represented by a histogram
than a single cumulative number.

### 7. Separate lifetime KPIs from rolling operational rates

Overall reliability uses terminal cumulative outcomes.

Alerting uses recent rolling windows because operators care about what
is happening now.

### 8. Avoid double-counting metrics

During development, completed/failed counters were incremented in
multiple code paths. This produced misleading telemetry.

The final design increments metrics only at the event that semantically
represents that metric.

### 9. Keep user analytics out of high-cardinality operational labels

The database already owns user-specific job relationships. Arbitrary
user IDs should not automatically become Prometheus labels because the
number of time series can grow with the user population.

------------------------------------------------------------------------

## Known Caveats

### Prometheus counters reset on process restart

Prometheus counters exported by the Node.js process start over when that
API or worker process restarts.

PostgreSQL rows persist.

Therefore:

``` text
Prometheus counter != guaranteed lifetime database total
```

across process restarts.

### API and worker have separate process metrics

When graphing metrics such as:

``` text
process_resident_memory_bytes
```

use Prometheus labels such as `job` and/or `instance` to distinguish the
API from the worker.

### Localhost links are local

Slack links pointing to:

``` text
localhost
```

only work on the developer's machine.

A public portfolio deployment requires public Grafana URLs and an
appropriate `GF_SERVER_ROOT_URL`.

### Fast jobs make active-job gauges hard to see

A job can start and finish between dashboard refreshes.

A time series or short-window average can make concurrency patterns
easier to observe.

### Rolling rates age out

A recent failure-rate graph can decrease after no new work occurs
because failures leave the rolling window. This is expected behavior.

------------------------------------------------------------------------

## Future Improvements

The current project already implements the core distributed-processing
and observability architecture. Future work should focus on operational
maturity rather than rewriting the system.

Potential improvements include:

-   real worker heartbeat/liveness checks,
-   dependency-aware readiness endpoint,
-   graceful Fastify/Prisma/BullMQ/Redis shutdown,
-   Zod or JSON Schema request validation,
-   removal of broad `any` types,
-   idempotency-key enforcement for job creation,
-   structured logging,
-   correlation IDs / job IDs in logs,
-   load testing with tools such as k6,
-   p50/p95/p99 latency views,
-   Swagger/OpenAPI documentation,
-   public deployment,
-   public Grafana demo,
-   Kubernetes/autoscaling if it adds meaningful value,
-   OpenTelemetry distributed tracing.

These items are **future improvements**, not claims about the currently
implemented system.

------------------------------------------------------------------------

## Engineering Takeaways

JobPulse demonstrates several backend and platform engineering concepts
in one system:

-   asynchronous producer/consumer architecture,
-   durable vs ephemeral state,
-   concurrent processing,
-   retries and exponential backoff,
-   terminal dead-letter handling,
-   multi-user authorization,
-   API/database/queue boundaries,
-   integration testing,
-   containerized dependencies,
-   continuous integration,
-   metrics instrumentation,
-   operational dashboards,
-   latency and throughput analysis,
-   reliability KPIs,
-   alert lifecycle semantics,
-   incident notification routing.

A major lesson from the project is that **application state and
operational telemetry are related but not interchangeable**.

For example:

``` text
PostgreSQL job status
BullMQ attempt state
Prometheus counter
Grafana rolling rate
Grafana alert state
```

can all describe the same system while answering different questions.

Understanding those distinctions is what turns a basic background-worker
demo into a more realistic distributed backend system.

------------------------------------------------------------------------

## Project Status

**Status: Working / portfolio-oriented**

Implemented and configured:

-   distributed API/worker processing,
-   JWT authentication and RBAC,
-   PostgreSQL job ownership/state,
-   BullMQ/Redis queueing,
-   concurrency,
-   exponential retries,
-   dead-letter handling,
-   cancellation,
-   manual dead-letter recovery,
-   Prometheus instrumentation,
-   Grafana dashboards,
-   Grafana alerting,
-   Slack notifications,
-   integration testing,
-   GitHub Actions CI,
-   Docker Compose infrastructure.

------------------------------------------------------------------------

## License

Add the license you choose for the repository here (for example, MIT).
Do not claim a license until a license file has actually been added to
the repository.
