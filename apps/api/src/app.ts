import jwt from "@fastify/jwt";
import bcrypt from "bcrypt";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { jobQueue } from "./queue";
import { register, jobsCreatedCounter, jobQueueGauge } from "./metrics";

const prisma = new PrismaClient();

type AuthUser = {
  userId: string;
  email: string;
  role: "USER" | "ADMIN";
};

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(jwt, {
    secret: process.env.JWT_SECRET || "supersecretkey",
  });

  const authenticate = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };

  /* ================= ROOT ================= */

  app.get("/", async () => {
    return {
      service: "Distributed Job Processing Platform",
      status: "healthy",
      uptime: process.uptime(),
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      components: {
        api: "running",
        worker: "running",
        database: "connected",
      },
      endpoints: [
        "GET /health",
        "POST /auth/register",
        "POST /auth/login",
        "GET /jobs",
        "POST /jobs",
        "GET /metrics",
        "GET /prometheus",
      ],
    };
  });

  /* ================= AUTH ================= */

  app.post("/auth/register", async (request, reply) => {
    const { email, password, role } = request.body as any;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return reply.code(400).send({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: role || "USER",
      },
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const { email, password } = request.body as any;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return { token };
  });

  /* ================= HEALTH ================= */

  app.get("/health", async () => {
    try {
      // 🔹 DB check
      await prisma.$queryRaw`SELECT 1`;

      // 🔹 Job stats
      const totalJobs = await prisma.job.count();
      const queuedJobs = await prisma.job.count({ where: { status: "QUEUED" } });
      const processingJobs = await prisma.job.count({ where: { status: "PROCESSING" } });
      const completedJobs = await prisma.job.count({ where: { status: "COMPLETED" } });
      const failedJobs = await prisma.job.count({ where: { status: "DEAD_LETTER" } });

      // 🔹 Performance metrics
      const successRate =
        totalJobs === 0 ? 0 : ((completedJobs / totalJobs) * 100).toFixed(2);

      const failureRate =
        totalJobs === 0 ? 0 : ((failedJobs / totalJobs) * 100).toFixed(2);

      // 🔹 Queue health
      const queueStatus =
        queuedJobs > 50 ? "high_load" :
          queuedJobs > 10 ? "moderate" :
            "healthy";

      return {
        service: "Distributed Job Processing Platform",
        status: "healthy",
        version: "1.0.0",
        environment: process.env.NODE_ENV || "development",

        uptime: process.uptime(),

        timestamp: new Date().toISOString(),

        systemMetrics: {
          totalJobs,
          queued: queuedJobs,
          processing: processingJobs,
          completed: completedJobs,
          failed: failedJobs,
        },

        performance: {
          successRate: `${successRate}%`,
          failureRate: `${failureRate}%`,
        },

        queue: {
          status: queueStatus,
          queuedJobs,
        },

        components: {
          api: "running",
          database: "connected",
          worker: {
            status: "running",
            activeJobs: processingJobs,
          },
        },

        system: {
          node: process.version,
          platform: process.platform,
        },

        endpoints: [
          "GET /health",
          "POST /auth/register",
          "POST /auth/login",
          "GET /jobs",
          "POST /jobs",
          "GET /metrics",
          "GET /prometheus",
        ],
      };

    } catch (err) {
      return {
        status: "unhealthy",
        error: "Database connection failed",
      };
    }
  });

  /* ================= JOBS ================= */

  app.get("/jobs", { preHandler: [authenticate] }, async (request: any) => {
    const user = request.user as AuthUser;

    if (user.role === "ADMIN") {
      return prisma.job.findMany({
        orderBy: { createdAt: "desc" },
      });
    }

    return prisma.job.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/jobs/:id", { preHandler: [authenticate] }, async (request: any, reply) => {
    const { id } = request.params as any;
    const user = request.user as AuthUser;

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    if (user.role !== "ADMIN" && job.userId !== user.userId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    return job;
  });

  app.post("/jobs/:id/retry", { preHandler: [authenticate] }, async (request: any, reply) => {
    const { id } = request.params as any;
    const user = request.user as AuthUser;

    if (user.role !== "ADMIN") {
      return reply.code(403).send({ error: "Admin only" });
    }

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) return reply.code(404).send({ error: "Job not found" });

    if (job.status !== "DEAD_LETTER") {
      return reply.code(400).send({ error: "Only dead jobs can be retried" });
    }

    await prisma.job.update({
      where: { id },
      data: {
        status: "QUEUED",
        attemptsMade: 0,
        cancelRequested: false,
      },
    });

    await jobQueue.add("job", { jobId: id });

    return { retried: true };
  });

  app.post("/jobs/:id/cancel", { preHandler: [authenticate] }, async (request: any, reply) => {
    const { id } = request.params as any;
    const user = request.user as AuthUser;

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    if (user.role !== "ADMIN" && job.userId !== user.userId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    await prisma.job.update({
      where: { id },
      data: { cancelRequested: true },
    });

    return { cancelled: true };
  });

  app.post("/jobs", { preHandler: [authenticate] }, async (request: any) => {
    const jobId = randomUUID();
    const payload = request.body as any;
    const user = request.user as AuthUser;

    await prisma.job.create({
      data: {
        id: jobId,
        type: payload.task || "default",
        payload,
        status: "QUEUED",
        priority: "NORMAL",
        maxAttempts: 3,
        attemptsMade: 0,
        userId: user.userId,
      },
    });

    await jobQueue.add("job", { jobId }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });

    jobsCreatedCounter.inc();

    return { jobId };
  });

  /* ================= METRICS ================= */

  app.get("/metrics", { preHandler: [authenticate] }, async (request: any, reply) => {
    const user = request.user as AuthUser;

    if (user.role !== "ADMIN") {
      return reply.code(403).send({ error: "Admin only" });
    }

    const total = await prisma.job.count();
    const queued = await prisma.job.count({ where: { status: "QUEUED" } });
    const processing = await prisma.job.count({ where: { status: "PROCESSING" } });
    const completed = await prisma.job.count({ where: { status: "COMPLETED" } });
    const dead = await prisma.job.count({ where: { status: "DEAD_LETTER" } });

    return { total, queued, processing, completed, dead };
  });

  app.get("/prometheus", async (_, reply) => {
    try {
      const queued = await prisma.job.count({
        where: { status: "QUEUED" },
      });

      jobQueueGauge.set(queued);

      reply.header("Content-Type", register.contentType);
      return register.metrics();
    } catch (err) {
      console.error("Prometheus error:", err);
      reply.code(200);
      return "# metrics error fallback\n";
    }
  });

  return app;
}
