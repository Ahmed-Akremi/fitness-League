-- Written proof of ownership for gym verification requests.
ALTER TABLE "gym_verification_requests" ADD COLUMN "proof_text" TEXT;
