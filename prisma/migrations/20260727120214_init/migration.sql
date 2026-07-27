-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(160) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `role` ENUM('admin', 'sales_head', 'executive') NOT NULL,
    `status` ENUM('invited', 'active', 'deactivated') NOT NULL DEFAULT 'invited',
    `invite_token` VARCHAR(255) NULL,
    `invite_expires_at` DATETIME(3) NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brands` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `parent_group` VARCHAR(100) NOT NULL,
    `logo_url` VARCHAR(255) NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_load_benchmarks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `parent_group` VARCHAR(100) NOT NULL DEFAULT 'GLOBAL',
    `star_category` TINYINT UNSIGNED NOT NULL,
    `property_type` ENUM('Resort', 'Hotel') NOT NULL,
    `per_room_load_kg` DECIMAL(6, 2) NOT NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `room_load_benchmarks_parent_group_star_category_property_typ_key`(`parent_group`, `star_category`, `property_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_group_benchmarks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `parent_group` VARCHAR(100) NOT NULL,
    `avg_occupancy` DECIMAL(5, 2) NOT NULL,
    `client_water_rate_kl_per_kg` DECIMAL(6, 4) NOT NULL,
    `client_energy_rate_kwh_per_kg` DECIMAL(6, 4) NOT NULL,
    `client_cost_per_kg` DECIMAL(8, 2) NOT NULL,
    `qc_water_rate_kl_per_kg` DECIMAL(6, 4) NOT NULL,
    `qc_energy_rate_kwh_per_kg` DECIMAL(6, 4) NOT NULL,
    `qc_price_per_kg` DECIMAL(8, 2) NOT NULL,
    `opl_threshold_load_day` DECIMAL(8, 2) NOT NULL,
    `opl_threshold_load_month` DECIMAL(10, 2) NOT NULL,
    `linen_waste_per_room_kg_yr` DECIMAL(6, 2) NOT NULL,
    `co2e_factor_per_kg_linen` DECIMAL(6, 4) NOT NULL,
    `kg_co2_per_tree` DECIMAL(6, 2) NOT NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_group_benchmarks_parent_group_key`(`parent_group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `properties` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `brand_id` BIGINT NOT NULL,
    `upload_id` BIGINT NULL,
    `srNo` INTEGER NULL,
    `name` VARCHAR(255) NOT NULL,
    `region` ENUM('North', 'South', 'East', 'West', 'Central') NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `property_type` ENUM('Resort', 'Hotel') NOT NULL,
    `development_type` ENUM('Brownfield', 'Greenfield') NOT NULL,
    `operated_by` ENUM('Client', 'QuickClean') NOT NULL,
    `star_category` TINYINT UNSIGNED NOT NULL,
    `room_count` INTEGER UNSIGNED NOT NULL,
    `opening_year` SMALLINT UNSIGNED NULL,
    `capex_deployed` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `source_url` VARCHAR(500) NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lng` DECIMAL(9, 6) NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `properties_brand_id_idx`(`brand_id`),
    INDEX `properties_upload_id_idx`(`upload_id`),
    INDEX `properties_region_idx`(`region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_operational_sites` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site_code` VARCHAR(20) NOT NULL,
    `client_code` VARCHAR(20) NULL,
    `site_name` VARCHAR(255) NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `region` ENUM('North', 'South', 'East', 'West', 'Central') NOT NULL,
    `parent_brand` VARCHAR(120) NOT NULL,
    `brand` VARCHAR(120) NULL,
    `category` ENUM('Healthcare', 'Hospitality') NOT NULL,
    `star_category` TINYINT UNSIGNED NULL,
    `owning_company` VARCHAR(255) NULL,
    `property_start_date` DATE NULL,
    `qc_ops_start_date` DATE NULL,
    `room_bed_count` INTEGER UNSIGNED NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Operational',
    `model_type` ENUM('OPL', 'Outsourcing', 'Rental') NOT NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lng` DECIMAL(9, 6) NULL,
    `matched_property_id` BIGINT NULL,
    `created_by` BIGINT NOT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `qc_operational_sites_site_code_key`(`site_code`),
    INDEX `qc_operational_sites_matched_property_id_idx`(`matched_property_id`),
    INDEX `qc_operational_sites_region_idx`(`region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `property_id` BIGINT NOT NULL,
    `qc_site_id` BIGINT NOT NULL,
    `distance_km` DECIMAL(6, 2) NOT NULL,
    `status` ENUM('new', 'contacted', 'converted', 'rejected') NOT NULL DEFAULT 'new',
    `assigned_to` BIGINT NULL,
    `notes` TEXT NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leads_qc_site_id_idx`(`qc_site_id`),
    INDEX `leads_status_idx`(`status`),
    UNIQUE INDEX `leads_property_id_qc_site_id_key`(`property_id`, `qc_site_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `uploads` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `brand_id` BIGINT NOT NULL,
    `type` ENUM('TAM') NOT NULL DEFAULT 'TAM',
    `filename` VARCHAR(255) NOT NULL,
    `row_count` INTEGER UNSIGNED NULL,
    `status` ENUM('previewed', 'committed', 'failed') NOT NULL DEFAULT 'previewed',
    `created_by` BIGINT NOT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `upload_reference_archive` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `upload_id` BIGINT NOT NULL,
    `sheet_name` ENUM('QC Average', 'IHCL Average', 'Data Validation') NOT NULL,
    `sr_no` INTEGER NULL,
    `raw_row` JSON NOT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `upload_reference_archive_upload_id_idx`(`upload_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity` VARCHAR(50) NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_user_id_idx`(`user_id`),
    INDEX `audit_log_entity_entity_id_idx`(`entity`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brands` ADD CONSTRAINT `brands_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brands` ADD CONSTRAINT `brands_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_load_benchmarks` ADD CONSTRAINT `room_load_benchmarks_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_load_benchmarks` ADD CONSTRAINT `room_load_benchmarks_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_group_benchmarks` ADD CONSTRAINT `client_group_benchmarks_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_group_benchmarks` ADD CONSTRAINT `client_group_benchmarks_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `properties` ADD CONSTRAINT `properties_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_operational_sites` ADD CONSTRAINT `qc_operational_sites_matched_property_id_fkey` FOREIGN KEY (`matched_property_id`) REFERENCES `properties`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_operational_sites` ADD CONSTRAINT `qc_operational_sites_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_operational_sites` ADD CONSTRAINT `qc_operational_sites_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_qc_site_id_fkey` FOREIGN KEY (`qc_site_id`) REFERENCES `qc_operational_sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `upload_reference_archive` ADD CONSTRAINT `upload_reference_archive_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `upload_reference_archive` ADD CONSTRAINT `upload_reference_archive_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
