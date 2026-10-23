import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/lis/schema.ts",
  out: "./drizzle",
});
