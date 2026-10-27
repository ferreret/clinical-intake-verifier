CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`patient_id` text,
	`physician_id` text,
	`insurer_id` text,
	`fields` text NOT NULL,
	`tests` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `batch_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`origin` text NOT NULL,
	`location` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`locked_by` text,
	`locked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `batch_documents_batch` ON `batch_documents` (`batch_id`,`position`);--> statement-breakpoint
CREATE INDEX `batch_documents_state` ON `batch_documents` (`state`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`decision` text NOT NULL,
	`technician` text NOT NULL,
	`at` text NOT NULL,
	`approved` text,
	`reason` text,
	FOREIGN KEY (`document_id`) REFERENCES `batch_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`document_id` text PRIMARY KEY NOT NULL,
	`prediction` text NOT NULL,
	`fused` text NOT NULL,
	`tests` text NOT NULL,
	`recorded` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `batch_documents`(`id`) ON UPDATE no action ON DELETE no action
);
