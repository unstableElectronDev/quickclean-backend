-- AlterTable
ALTER TABLE `properties` ADD UNIQUE INDEX `properties_brand_id_srNo_key`(`brand_id`, `srNo`);
