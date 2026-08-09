import client from "prom-client";

export const register = new client.Registry();

/* ---------------- Default Metrics ---------------- */
client.collectDefaultMetrics({
  register,
});

/* =========================================================
   🔢 COUNTERS
========================================================= */

export const jobsCompletedCounter = new client.Counter({
  name: "worker_jobs_completed_total",
  help: "Total number of jobs completed",
});

export const jobsFailedCounter = new client.Counter({
  name: "worker_jobs_failed_total",
  help: "Total number of failed attempts",
});

export const deadLetterCounter = new client.Counter({
  name: "worker_jobs_dead_letter_total",
  help: "Jobs moved to dead letter queue",
});

export const jobsRetriedCounter = new client.Counter({
  name: "worker_jobs_retried_total",
  help: "Total number of retries",
});

/* =========================================================
   📊 GAUGES
========================================================= */

export const activeJobsGauge = new client.Gauge({
  name: "worker_active_jobs",
  help: "Active jobs being processed",
});

/* =========================================================
   ⏱️ HISTOGRAMS
========================================================= */

export const jobProcessingDuration = new client.Histogram({
  name: "worker_job_processing_duration_seconds",
  help: "Time taken to process a job",
  buckets: [0.5, 1, 2, 5, 10],
});

export const jobQueueWaitTime = new client.Histogram({
  name: "worker_job_queue_wait_seconds",
  help: "Time a job waits in queue before processing",
  buckets: [0.5, 1, 2, 5, 10, 20],
});

/* =========================================================
   REGISTER
========================================================= */

register.registerMetric(jobsCompletedCounter);
register.registerMetric(jobsFailedCounter);
register.registerMetric(deadLetterCounter);
register.registerMetric(jobsRetriedCounter);
register.registerMetric(activeJobsGauge);
register.registerMetric(jobProcessingDuration);
register.registerMetric(jobQueueWaitTime);
