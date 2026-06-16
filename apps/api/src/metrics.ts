import client from "prom-client";

export const register = new client.Registry();

client.collectDefaultMetrics({
  register,
});

export const jobsCreatedCounter = new client.Counter({
  name: "jobs_created_total",
  help: "Total number of jobs created",
});

export const jobsCompletedCounter = new client.Counter({
  name: "jobs_completed_total",
  help: "Total number of jobs completed",
});

export const jobsFailedCounter = new client.Counter({
  name: "jobs_failed_total",
  help: "Total number of jobs failed",
});

export const jobQueueGauge = new client.Gauge({
  name: "jobs_queue_total",
  help: "Current number of queued jobs",
});

register.registerMetric(jobsCreatedCounter);
register.registerMetric(jobsCompletedCounter);
register.registerMetric(jobsFailedCounter);
register.registerMetric(jobQueueGauge);
