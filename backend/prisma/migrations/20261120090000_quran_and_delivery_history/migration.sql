-- AlterTable
ALTER TABLE `subscribers` MODIFY `verseType` ENUM('BIBLE', 'GITA', 'QURAN') NOT NULL;

-- AlterTable
ALTER TABLE `verses` MODIFY `type` ENUM('BIBLE', 'GITA', 'QURAN') NOT NULL;

-- AlterTable
ALTER TABLE `deliveries` ADD COLUMN `failurePermanent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `firstFailedAt` DATETIME(3) NULL,
    ADD COLUMN `lastFailedAt` DATETIME(3) NULL,
    ADD COLUMN `requeueCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `delivery_attempts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `deliveryId` BIGINT NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `outcome` ENUM('SUCCEEDED', 'FAILED', 'UNKNOWN') NULL,
    `error` VARCHAR(500) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `delivery_attempts_deliveryId_idx`(`deliveryId`),
    INDEX `delivery_attempts_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `delivery_attempts` ADD CONSTRAINT `delivery_attempts_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `deliveries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

