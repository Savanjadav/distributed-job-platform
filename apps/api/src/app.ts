import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { jobQueue } from "./queue";
import { randomUUID } from "crypto";

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();

  // HEALTH ROUTE
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });

  // JOB CREATE ROUTE
  app.post("/jobs", async (request, reply) => {
    const jobId = randomUUID();
    const payload = request.body as any;

    await prisma.job.create({
      data: {
        id: jobId,
        type: payload.task || "generic",
        payload,
        status: "QUEUED",
        priority: "NORMAL",
        maxAttempts: 3,
        attemptsMade: 0,
      },
    });

    await jobQueue.add("process-job", { jobId });

    return { jobId };
  });

  return app;
}
