CREATE TABLE `insurer_aliases` (
	`insurer_id` text NOT NULL,
	`alias` text NOT NULL,
	PRIMARY KEY(`insurer_id`, `alias`),
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insurers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurers_name_unique` ON `insurers` (`name`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name1` text NOT NULL,
	`last_name2` text NOT NULL,
	`sex` text NOT NULL,
	`birth_date` text NOT NULL,
	`doc_id` text NOT NULL,
	`phone` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_doc_id_unique` ON `patients` (`doc_id`);--> statement-breakpoint
CREATE INDEX `patients_name` ON `patients` (`last_name1`,`last_name2`,`first_name`);--> statement-breakpoint
CREATE TABLE `physicians` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name1` text NOT NULL,
	`last_name2` text NOT NULL,
	`sex` text NOT NULL,
	`colegiado` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `physicians_colegiado_unique` ON `physicians` (`colegiado`);