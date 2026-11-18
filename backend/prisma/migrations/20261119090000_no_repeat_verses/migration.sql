-- AlterTable
ALTER TABLE `verses` ADD COLUMN `rotationTier` TINYINT NULL;

-- CreateTable
CREATE TABLE `subscriber_verses` (
    `subscriberId` INTEGER NOT NULL,
    `verseId` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscriber_verses_verseId_idx`(`verseId`),
    PRIMARY KEY (`subscriberId`, `verseId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subscriber_verses` ADD CONSTRAINT `subscriber_verses_subscriberId_fkey` FOREIGN KEY (`subscriberId`) REFERENCES `subscribers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriber_verses` ADD CONSTRAINT `subscriber_verses_verseId_fkey` FOREIGN KEY (`verseId`) REFERENCES `verses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every verse already given to a subscriber counts as used, so it is never sent again.
INSERT IGNORE INTO `subscriber_verses` (`subscriberId`, `verseId`, `assignedAt`)
SELECT `subscriberId`, `verseId`, MIN(`createdAt`)
FROM `deliveries`
WHERE `verseId` IS NOT NULL AND `status` <> 'FAILED'
GROUP BY `subscriberId`, `verseId`;
