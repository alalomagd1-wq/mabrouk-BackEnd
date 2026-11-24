ALTER TABLE `users`
  ADD COLUMN `email_verified_at` DATETIME(3) NULL;

-- Grandfather accounts created before mandatory email verification to preserve sign-in.
UPDATE `users`
SET `email_verified_at` = `created_at`
WHERE `email_verified_at` IS NULL;

CREATE TABLE `pending_registrations` (
  `pending_registration_id` INTEGER NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(191) NOT NULL,
  `last_name` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(191) NOT NULL,
  `role` ENUM('CUSTOMER', 'EVENT_MANAGER', 'SERVICE_OWNER', 'ADMINISTRATOR') NOT NULL,
  `identity_front_path` VARCHAR(191) NULL,
  `identity_back_path` VARCHAR(191) NULL,
  `business_front_path` VARCHAR(191) NULL,
  `verification_token_hash` VARCHAR(191) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `resend_available_at` DATETIME(3) NOT NULL,
  `resend_window_started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resend_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `pending_registrations_email_key`(`email`),
  UNIQUE INDEX `pending_registrations_verification_token_hash_key`(`verification_token_hash`),
  INDEX `pending_registrations_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`pending_registration_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
