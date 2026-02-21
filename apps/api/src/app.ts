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

  return app;
}
