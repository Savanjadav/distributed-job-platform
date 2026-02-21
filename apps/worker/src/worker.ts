import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const worker = new Worker(
  "jobs",
  async (job) => {
    const { jobId } = job.data;

    console.log("Processing job:", jobId);

    // Update status to PROCESSING
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "PROCESSING",
      },
    });

    // Simulate work (2 sec)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Mark completed
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
