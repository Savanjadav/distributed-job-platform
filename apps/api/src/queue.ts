import { Queue } from "bullmq";

export const jobQueue = new Queue("jobs", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});
