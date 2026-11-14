-- Embroidery tab access per user (admins always have it)
ALTER TABLE "User" ADD COLUMN "canViewEmbroidery" BOOLEAN NOT NULL DEFAULT false;
