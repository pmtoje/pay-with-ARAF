-- Live SeedFi: gender as on the BVN record (required by SeedFi), and reuse of a still-valid Seed Score.
ALTER TABLE "identity_verifications" ADD COLUMN "gender" TEXT;
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('male', 'female'));
ALTER TABLE "credit_assessments" ADD COLUMN "reusedFromId" TEXT;
