-- DropForeignKey
ALTER TABLE `uploads` DROP FOREIGN KEY `uploads_brand_id_fkey`;

-- AlterTable
ALTER TABLE `qc_operational_sites` ADD COLUMN `property_type` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `upload_reference_archive` MODIFY `sheet_name` ENUM('QC Average', 'Brand Average', 'Data Validation') NOT NULL;

-- AlterTable
ALTER TABLE `uploads` ADD COLUMN `parent_group` VARCHAR(100) NULL,
    MODIFY `brand_id` BIGINT NULL,
    MODIFY `type` ENUM('CURRENT_SITES', 'PROPERTIES', 'QC_AVERAGE', 'BRAND_AVERAGE', 'DATA_VALIDATION', 'LEADS_PIPELINE') NOT NULL;

-- CreateTable
CREATE TABLE `pipeline_leads` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `upload_id` BIGINT NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `category` VARCHAR(100) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `region` ENUM('North', 'South', 'East', 'West', 'Central') NULL,
    `keys_or_beds` INTEGER NULL,
    `lead_creator` VARCHAR(120) NULL,
    `lead_owner` VARCHAR(120) NULL,
    `regional_sales_lead` VARCHAR(120) NULL,
    `industry` VARCHAR(120) NULL,
    `lead_qualification` VARCHAR(100) NULL,
    `lead_type` VARCHAR(100) NULL,
    `lead_status` VARCHAR(100) NULL,
    `property_type` VARCHAR(100) NULL,
    `estimated_revenue` DECIMAL(14, 2) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pipeline_leads_upload_id_idx`(`upload_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pipeline_leads` ADD CONSTRAINT `pipeline_leads_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pipeline_leads` ADD CONSTRAINT `pipeline_leads_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

