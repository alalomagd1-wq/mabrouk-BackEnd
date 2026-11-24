ALTER TABLE `pending_registrations`
  ADD COLUMN `verification_attempts` INTEGER NOT NULL DEFAULT 0;
