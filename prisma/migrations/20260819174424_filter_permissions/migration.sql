-- CreateTable
CREATE TABLE `filter_permissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `filter_key` VARCHAR(50) NOT NULL,
    `allowed_roles` JSON NOT NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `filter_permissions_filter_key_key`(`filter_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `filter_permissions` ADD CONSTRAINT `filter_permissions_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
