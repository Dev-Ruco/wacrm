-- The offering-type FK is composite so the account boundary is enforced by
-- PostgreSQL itself. SET NULL would also attempt to null account_id, which is
-- never valid. Keep the relationship explicit and require reassignment/removal
-- of dependent offerings before deleting a type.

alter table wacrm.catalog_products
  drop constraint if exists catalog_products_offering_type_fk;

alter table wacrm.catalog_products
  add constraint catalog_products_offering_type_fk
  foreign key (offering_type_id, account_id)
  references wacrm.offering_types(id, account_id)
  on delete restrict;
