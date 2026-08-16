/*
  Warnings:

  - You are about to alter the column `category` on the `services` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(7))`.

*/
-- AlterTable
ALTER TABLE `services` MODIFY `category` ENUM('PHOTOGRAPHY', 'CATERING', 'DECORATION', 'DANCE_AND_CHOREOGRAPHY', 'MUSIC_AND_ENTERTAINMENT', 'VENUE', 'LIGHTING', 'FURNITURE_AND_SEATING', 'TRANSPORTATION', 'SWEETS_AND_DESSERTS', 'BEAUTY_AND_MAKEUP', 'PRINTING_AND_INVITATIONS', 'OTHER') NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `password_reset_expires_at` DATETIME(3) NULL,
    ADD COLUMN `password_reset_token` VARCHAR(191) NULL;
