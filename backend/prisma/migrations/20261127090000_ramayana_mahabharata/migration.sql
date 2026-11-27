-- AlterTable
ALTER TABLE `subscribers` MODIFY `verseType` ENUM('BIBLE', 'GITA', 'QURAN', 'RAMAYANA', 'MAHABHARATA') NOT NULL;

-- AlterTable
ALTER TABLE `verses` MODIFY `type` ENUM('BIBLE', 'GITA', 'QURAN', 'RAMAYANA', 'MAHABHARATA') NOT NULL;

-- The Bhagavad Gita option is replaced by Ramayana / Mahabharata. The Gita is part of the
-- Mahabharata, so existing Gita subscribers move there and start at a fresh random position.
-- Their history (subscriber_verses, deliveries) is kept; Gita verses stay in the table but are no
-- longer in any rotation.
UPDATE `subscribers` SET `verseType` = 'MAHABHARATA', `progress` = 0 WHERE `verseType` = 'GITA';
UPDATE `verses` SET `rotationIndex` = NULL, `rotationTier` = NULL WHERE `type` = 'GITA';
