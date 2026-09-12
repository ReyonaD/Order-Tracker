-- Sheet stage "DOWNLOADED" (agent pulled the file into its hot folder) for the chase list.
ALTER TABLE "Sheet" ADD COLUMN "downloadedAt" TIMESTAMP(3);
