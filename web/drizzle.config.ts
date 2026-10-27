import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/lib/lis/schema.ts", "./src/lib/mapping/schema.ts", "./src/lib/batches/schema.ts"],
  out: "./drizzle",
});
