import "dotenv/config";
import { buildApp } from "./app";

const app = buildApp();

app.listen({ port: 3000, host: "0.0.0.0" })
  .then(() => {
    console.log("API running on http://localhost:3000");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
