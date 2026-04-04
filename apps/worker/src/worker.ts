import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKER_NAME = `worker-${process.pid}`;

const worker = new Worker(
  "jobs",
  async (job) => {
    const { jobId } = job.data;

    console.log(`[${WORKER_NAME}] Processing job: ${jobId}`);

    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!dbJob) {
      throw new Error("Job not found in DB");
    }

    if (dbJob.cancelRequested) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "CANCELLED" },
      });
      return;
    }

    // Update status
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "PROCESSING",
        attemptsMade: dbJob.attemptsMade + 1,
      },
    });

    // Simulate failure randomly (50%)
    if (Math.random() < 0.5) {
      throw new Error("Simulated failure");
    }

    const delayMs = (dbJob.payload as any)?.delayMs ?? 2000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
      },
    });

    console.log(`[${WORKER_NAME}] Completed job: ${jobId}`);
  },

  {
    connection: {
      host: "localhost",
      port: 6379,
    },
    concurrency: 5
  }
);


worker.on("failed", async (job, err) => {
  if (!job) return;

  const { jobId } = job.data;

  console.log(`[${WORKER_NAME}] Job failed: ${jobId}`);

  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!dbJob) return;

  const maxAttempts = job.opts.attempts ?? 1;
  const attemptsMade = job.attemptsMade;

  if (attemptsMade >= maxAttempts) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "DEAD_LETTER",
        attemptsMade: attemptsMade,
      },
    });

    console.log(`[${WORKER_NAME}] Job ${jobId} moved to DEAD_LETTER`);
  } else {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        attemptsMade: attemptsMade,
      },
    });

    console.log(`[${WORKER_NAME}] Job ${jobId} marked FAILED and will retry`);
  }
});

worker.on("completed", (job) => {
  console.log(`Worker completed BullMQ job ${job.id}`);
});

console.log(`[${WORKER_NAME}] Worker started with concurrency = 5`);


