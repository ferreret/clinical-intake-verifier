CREATE TABLE `catalog_profile_codes` (
	`profile_id` text NOT NULL,
	`code` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `code`),
	FOREIGN KEY (`profile_id`) REFERENCES `catalog_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`code`) REFERENCES `catalog_tests`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `catalog_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_synonyms` (
	`code` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`code`, `name`),
	FOREIGN KEY (`code`) REFERENCES `catalog_tests`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `catalog_tests` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`analyte` text NOT NULL,
	`specimen` text,
	`default_specimen` integer NOT NULL,
	`variant` text
);
--> statement-breakpoint
CREATE TABLE `mapping_memory` (
	`scope` text NOT NULL,
	`text_key` text NOT NULL,
	`codes` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`passive` integer DEFAULT 0 NOT NULL,
	`corrections` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `text_key`, `codes`)
);
