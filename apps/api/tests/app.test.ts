import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app";
import { jobQueue } from "../src/queue";

const prisma = new PrismaClient();

describe("API integration tests", () => {
  const app = buildApp();

  let userToken: string;
  let adminToken: string;
  let createdJobId: string;

  beforeAll(async () => {
    await app.ready();

    // clean DB once before tests start
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();          // close Fastify
    await prisma.$disconnect(); // close DB
    await jobQueue.close();     // 🔥 close Redis (VERY IMPORTANT)
  });

  it("should return health status", async () => {
    const res = await request(app.server).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("should register a normal user", async () => {
    const res = await request(app.server)
      .post("/auth/register")
      .send({
        email: "user1@example.com",
        password: "password123",
        role: "USER",
      });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("user1@example.com");
    expect(res.body.role).toBe("USER");
  });

  it("should register an admin user", async () => {
    const res = await request(app.server)
      .post("/auth/register")
      .send({
        email: "admin@example.com",
        password: "password123",
        role: "ADMIN",
      });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("admin@example.com");
    expect(res.body.role).toBe("ADMIN");
  });

  it("should login normal user and return token", async () => {
    const res = await request(app.server)
      .post("/auth/login")
      .send({
        email: "user1@example.com",
        password: "password123",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    userToken = res.body.token;
  });

  it("should login admin and return token", async () => {
    const res = await request(app.server)
      .post("/auth/login")
      .send({
        email: "admin@example.com",
        password: "password123",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    adminToken = res.body.token;
  });

  it("should reject /jobs request without token", async () => {
    const res = await request(app.server).get("/jobs");

    expect(res.status).toBe(401);
  });

  it("should create a job for authenticated user", async () => {
    const res = await request(app.server)
      .post("/jobs")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        task: "send-email",
        to: "user@example.com",
      });

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeDefined();

    createdJobId = res.body.jobId;
  });

  it("should allow user to see their own jobs", async () => {
    const res = await request(app.server)
      .get("/jobs")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("should allow admin to see all jobs", async () => {
    const res = await request(app.server)
      .get("/jobs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("should allow user to cancel own job", async () => {
    const res = await request(app.server)
      .post(`/jobs/${createdJobId}/cancel`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });

  it("should reject metrics endpoint for normal user", async () => {
    const res = await request(app.server)
      .get("/metrics")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });

  it("should allow admin to access metrics", async () => {
    const res = await request(app.server)
      .get("/metrics")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeDefined();
  });


});
