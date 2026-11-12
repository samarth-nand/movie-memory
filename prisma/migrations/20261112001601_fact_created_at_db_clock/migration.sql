-- AlterTable
ALTER TABLE "Fact" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp(),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);
