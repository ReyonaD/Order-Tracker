-- Convert User.role from the Role enum to free-form TEXT so admins can define custom roles.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
DROP TYPE "Role";
