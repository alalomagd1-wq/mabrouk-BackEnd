ALTER TABLE `verification_requests`
  ADD COLUMN `identity_front_path` VARCHAR(191) NULL,
  ADD COLUMN `identity_back_path` VARCHAR(191) NULL,
  ADD COLUMN `business_front_path` VARCHAR(191) NULL;
