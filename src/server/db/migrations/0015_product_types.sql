-- Migration 0015: Product Types & Blantyre Product Date Default
-- Supports all 8 product types: standard, inventory, non_inventory, composite, serialized, batch, bundle, service
-- (plus non-inventory alias for backwards compatibility)
-- Sets default for product_date to use Africa/Blantyre timezone.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check 
  CHECK (product_type IN (
    'standard',
    'inventory',
    'non_inventory',
    'non-inventory',
    'composite',
    'serialized',
    'batch',
    'bundle',
    'service'
  ));

-- Set product_date default to Africa/Blantyre date
ALTER TABLE products ALTER COLUMN product_date SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Blantyre')::DATE;

