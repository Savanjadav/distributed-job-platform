import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { jobQueue } from "./queue";

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();

  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });

  app.get("/jobs", async () => {
    return prisma.job.findMany({
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/jobs/:id", async (request) => {
    const { id } = request.params as { id: string };

    return prisma.job.findUnique({
      where: { id },
    });
  });

  app.post("/jobs/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) return reply.code(404).send();

    if (job.status !== "DEAD_LETTER")
      return reply.code(400).send({ error: "Only dead jobs can be retried" });

    await prisma.job.update({
      where: { id },
      data: {
        status: "QUEUED",
        attemptsMade: 0,
      },
    });

    await jobQueue.add("job", { jobId: id });

    return { retried: true };
  });

  app.post("/jobs/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };

    await prisma.job.update({
      where: { id },
      data: { cancelRequested: true },
    });

    return { cancelled: true };
  });

  app.post("/jobs", async (request, reply) => {
    const jobId = randomUUID();
    const payload = request.body as any;

    await prisma.job.create({
      data: {
        id: jobId,
        type: payload.task || "default",
        payload,
        status: "QUEUED",
        priority: "NORMAL",
        maxAttempts: 3,
        attemptsMade: 0,
      },
    });

    await jobQueue.add(
      "job",
      { jobId },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      }
    );

    return { jobId };
  });

  app.get("/metrics", async () => {
    const total = await prisma.job.count();
    const queued = await prisma.job.count({ where: { status: "QUEUED" } });
    const processing = await prisma.job.count({ where: { status: "PROCESSING" } });
    const completed = await prisma.job.count({ where: { status: "COMPLETED" } });
    const dead = await prisma.job.count({ where: { status: "DEAD_LETTER" } });

    return {
      total,
      queued,
      processing,
      completed,
      dead,
    };
  });

  return app;
}
