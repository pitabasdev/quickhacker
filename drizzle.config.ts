import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: "postgresql://db_owner:7NMYA8eDsQvp@ep-jolly-sun-a5imscxm.us-east-2.aws.neon.tech/db?sslmode=require",
  },
});
