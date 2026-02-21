import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const worker = new Worker(
  "jobs",
  async (job) => {
    const { jobId } = job.data;

    console.log("Processing job:", jobId);

    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!dbJob) {
      throw new Error("Job not found in DB");
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

    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
      },
    });

    console.log("Completed job:", jobId);
  },
  
  {
    connection: {
      host: "localhost",
      port: 6379,
    },
  }
);

console.log("Worker started...");

worker.on("failed", async (job, err) => {
  if (!job) return;

  const { jobId } = job.data;

  console.log("Job failed:", jobId);

  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!dbJob) return;

  if (dbJob.attemptsMade >= dbJob.maxAttempts) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "DEAD_LETTER",
      },
    });

    console.log("Moved to dead letter:", jobId);
  } else {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
      },
    });
  }
});

