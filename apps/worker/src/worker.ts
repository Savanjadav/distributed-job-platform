import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import {
  register,
  jobsCompletedCounter,
  jobsFailedCounter,
  deadLetterCounter,
  jobsRetriedCounter,
  activeJobsGauge,
  jobProcessingDuration,
  jobQueueWaitTime,
} from "./metrics";

const prisma = new PrismaClient();
const WORKER_NAME = `worker-${process.pid}`;

/* ---------------- Metrics Server ---------------- */

const metricsApp = Fastify();

metricsApp.get("/metrics", async (_, reply) => {
  reply.header("Content-Type", register.contentType);
  return register.metrics();
});

metricsApp.listen({ port: 3002, host: "0.0.0.0" }).then(() => {
  console.log(`[${WORKER_NAME}] Metrics server running`);
});

/* ---------------- Worker ---------------- */

const worker = new Worker(
  "jobs",
  async (job) => {
    const { jobId } = job.data;

    activeJobsGauge.inc();
    const endTimer = jobProcessingDuration.startTimer();

    try {
      const dbJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!dbJob) throw new Error("Job not found");

      /* Queue wait time */
      const waitTime =
        Date.now() - new Date(dbJob.createdAt).getTime();

      jobQueueWaitTime.observe(waitTime / 1000);

      /* Cancel */
      if (dbJob.cancelRequested) {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: "CANCELLED" },
        });
        return;
      }

      /* Move to PROCESSING */
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "PROCESSING",
          attemptsMade: dbJob.attemptsMade + 1,
        },
      });

      /* Simulate failure */
      if (Math.random() < 0.5) {
        jobsFailedCounter.inc();
        throw new Error("Simulated failure");
      }

      /* Simulate work */
      const delayMs = (dbJob.payload as any)?.delayMs ?? 2000;
      await new Promise((r) => setTimeout(r, delayMs));

      /* Success */
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "COMPLETED" },
      });

      jobsCompletedCounter.inc();

    } finally {
      endTimer();
      activeJobsGauge.dec();
    }
  },
  {
    connection: {
      host: "localhost",
      port: 6379,
    },
    concurrency: 5,
  }
);

/* ---------------- Events ---------------- */

worker.on("failed", async (job) => {
  if (!job) return;

  const { jobId } = job.data;

  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!dbJob) return;

  const maxAttempts = job.opts.attempts ?? 1;
  const attemptsMade = job.attemptsMade;

  if (attemptsMade >= maxAttempts) {
    /* FINAL FAILURE */
    deadLetterCounter.inc();

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "DEAD_LETTER",
        attemptsMade,
      },
    });

  } else {
    /* RETRY */
    jobsRetriedCounter.inc();

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        attemptsMade,
      },
    });
  }
});

worker.on("completed", (job) => {
  console.log(`[${WORKER_NAME}] Completed job ${job.id}`);
});

console.log(`[${WORKER_NAME}] Worker started`);
