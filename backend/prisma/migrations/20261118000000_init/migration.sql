-- CreateTable
CREATE TABLE `subscribers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phoneE164` VARCHAR(20) NOT NULL,
    `verseType` ENUM('BIBLE', 'GITA') NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'UNSUBSCRIBED') NOT NULL DEFAULT 'PENDING',
    `channelAddress` VARCHAR(100) NULL,
    `confirmCode` VARCHAR(12) NULL,
    `confirmCodeExpiresAt` DATETIME(3) NULL,
    `manageToken` CHAR(32) NOT NULL,
    `rotationOffset` INTEGER NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `optedInAt` DATETIME(3) NULL,
    `optedOutAt` DATETIME(3) NULL,
    `lastDeliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscribers_phoneE164_key`(`phoneE164`),
    UNIQUE INDEX `subscribers_confirmCode_key`(`confirmCode`),
    UNIQUE INDEX `subscribers_manageToken_key`(`manageToken`),
    INDEX `subscribers_status_id_idx`(`status`, `id`),
    INDEX `subscribers_channelAddress_idx`(`channelAddress`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('BIBLE', 'GITA') NOT NULL,
    `reference` VARCHAR(64) NOT NULL,
    `book` VARCHAR(40) NOT NULL,
    `chapter` SMALLINT NOT NULL,
    `verse` SMALLINT NOT NULL,
    `text` TEXT NOT NULL,
    `originalText` TEXT NULL,
    `transliteration` TEXT NULL,
    `translation` VARCHAR(64) NOT NULL,
    `rotationIndex` INTEGER NULL,

    UNIQUE INDEX `verses_type_book_chapter_verse_key`(`type`, `book`, `chapter`, `verse`),
    UNIQUE INDEX `verses_type_rotationIndex_key`(`type`, `rotationIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deliveries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subscriberId` INTEGER NOT NULL,
    `deliveryDate` DATE NOT NULL,
    `kind` ENUM('WELCOME', 'DAILY') NOT NULL DEFAULT 'DAILY',
    `status` ENUM('PENDING', 'PROCESSING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'SKIPPED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `verseId` INTEGER NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedBy` VARCHAR(64) NULL,
    `lockedUntil` DATETIME(3) NULL,
    `providerMessageId` VARCHAR(128) NULL,
    `lastError` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `deliveries_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `deliveries_status_lockedUntil_idx`(`status`, `lockedUntil`),
    INDEX `deliveries_deliveryDate_status_idx`(`deliveryDate`, `status`),
    INDEX `deliveries_verseId_idx`(`verseId`),
    UNIQUE INDEX `deliveries_subscriberId_deliveryDate_key`(`subscriberId`, `deliveryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_auth` (
    `sessionId` VARCHAR(64) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`sessionId`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sender_state` (
    `id` VARCHAR(64) NOT NULL,
    `connection` VARCHAR(32) NOT NULL,
    `qr` TEXT NULL,
    `meJid` VARCHAR(100) NULL,
    `lastError` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leases` (
    `name` VARCHAR(64) NOT NULL,
    `holder` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_runs` (
    `job` VARCHAR(64) NOT NULL,
    `runDate` DATE NOT NULL,
    `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `enqueued` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`job`, `runDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `send_counters` (
    `day` DATE NOT NULL,
    `sent` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_subscriberId_fkey` FOREIGN KEY (`subscriberId`) REFERENCES `subscribers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_verseId_fkey` FOREIGN KEY (`verseId`) REFERENCES `verses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

