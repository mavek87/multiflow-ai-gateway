CREATE TABLE `ai_provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`ai_provider_id` text NOT NULL,
	`model_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ai_provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_models_provider_model_unique` ON `ai_provider_models` (`ai_provider_id`,`model_name`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`base_url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_name_unique` ON `ai_providers` (`name`);--> statement-breakpoint
CREATE TABLE `gateway_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gateway_api_keys_hash_unique` ON `gateway_api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `tenant_ai_model_priorities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ai_provider_model_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_provider_model_id`) REFERENCES `ai_provider_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_ai_model_priorities_tenant_model_unique` ON `tenant_ai_model_priorities` (`tenant_id`,`ai_provider_model_id`);--> statement-breakpoint
CREATE TABLE `tenant_ai_provider_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ai_provider_id` text NOT NULL,
	`ai_provider_api_key_encrypted` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_ai_provider_keys_tenant_provider_unique` ON `tenant_ai_provider_keys` (`tenant_id`,`ai_provider_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`force_ai_provider_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`force_ai_provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_name_unique` ON `tenants` (`name`);
