-- Composite source FKs include account_id to enforce tenant isolation. A plain
-- ON DELETE SET NULL would also attempt to null account_id. Require explicit
-- detachment/removal of canonical products and variants before deleting a
-- source, matching the Business Offering FK safety pattern.

alter table wacrm.catalog_products
  drop constraint if exists catalog_products_source_account_fk;
alter table wacrm.catalog_products
  add constraint catalog_products_source_account_fk
  foreign key (source_id, account_id)
  references wacrm.catalog_sources(id, account_id)
  on delete restrict;

alter table wacrm.catalog_product_variants
  drop constraint if exists catalog_product_variants_source_fk;
alter table wacrm.catalog_product_variants
  add constraint catalog_product_variants_source_fk
  foreign key (source_id, account_id)
  references wacrm.catalog_sources(id, account_id)
  on delete restrict;
