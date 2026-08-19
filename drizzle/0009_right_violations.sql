DROP INDEX `report_links_token_idx`;--> statement-breakpoint
CREATE INDEX `patients_lab_active_created_idx` ON `patients` (`lab_id`,`is_active`,`created_at`);--> statement-breakpoint
CREATE INDEX `visits_lab_status_updated_idx` ON `visits` (`lab_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `visits_lab_visit_date_idx` ON `visits` (`lab_id`,`visit_date`);--> statement-breakpoint
CREATE INDEX `result_entries_visit_status_idx` ON `result_entries` (`visit_id`,`status`);--> statement-breakpoint
CREATE INDEX `result_entries_lab_status_idx` ON `result_entries` (`lab_id`,`status`);