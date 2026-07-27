-- DropIndex
DROP INDEX `qc_operational_sites_site_code_key` ON `qc_operational_sites`;

-- AlterTable
ALTER TABLE `qc_operational_sites` MODIFY `client_code` VARCHAR(20) NOT NULL,
    MODIFY `parent_brand` VARCHAR(120) NULL,
    MODIFY `category` ENUM('Healthcare', 'Hospitality') NULL,
    MODIFY `model_type` ENUM('OPL', 'Outsourcing', 'Rental') NULL;

-- CreateIndex
CREATE UNIQUE INDEX `qc_operational_sites_site_code_client_code_key` ON `qc_operational_sites`(`site_code`, `client_code`);

