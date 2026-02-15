import Fastify from "fastify";
console.log("DATABASE_URL:", process.env.DATABASE_URL);
import { PrismaClient } from "@prisma/client";

export function buildApp() {
  const app = Fastify({ logger: true });

  const prisma = new PrismaClient();

  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });

  return app;
}
