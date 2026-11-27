-- AlterTable
ALTER TABLE `verses` ADD COLUMN `chapterTitle` VARCHAR(120) NULL;

-- The Ramayana is now sent as a story, in reading order, starting from the first part.
-- Ramayana subscribers restart from the beginning: their earlier (hand-picked) passages are
-- forgotten so the story has no gaps. Delivery rows (what was sent, when) are kept.
UPDATE `subscribers` SET `rotationOffset` = 0, `progress` = 0 WHERE `verseType` = 'RAMAYANA';
DELETE sv FROM `subscriber_verses` sv JOIN `verses` v ON v.`id` = sv.`verseId` WHERE v.`type` = 'RAMAYANA';
UPDATE `verses` SET `rotationIndex` = NULL, `rotationTier` = NULL WHERE `type` = 'RAMAYANA';
