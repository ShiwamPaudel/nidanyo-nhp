ALTER TABLE `report_signatories` ADD `user_id` text;--> statement-breakpoint
CREATE INDEX `report_signatories_lab_user_idx` ON `report_signatories` (`lab_id`,`user_id`);