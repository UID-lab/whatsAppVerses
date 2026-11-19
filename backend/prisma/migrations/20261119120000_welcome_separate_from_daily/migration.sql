-- The welcome message no longer uses up the day's slot: a subscriber can get one WELCOME and
-- one DAILY verse on the same day (still at most one of each, however often the cron runs).
-- The new index is created first because the subscriberId foreign key needs an index that starts
-- with subscriberId at all times.
CREATE UNIQUE INDEX `deliveries_subscriberId_deliveryDate_kind_key` ON `deliveries`(`subscriberId`, `deliveryDate`, `kind`);

DROP INDEX `deliveries_subscriberId_deliveryDate_key` ON `deliveries`;
