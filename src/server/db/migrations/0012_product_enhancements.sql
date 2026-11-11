-- Migration 0012: Product enhancements
-- 1. Update check constraint on product_type to include 'inventory' and 'non-inventory'
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check 
  CHECK (product_type IN ('standard', 'bundle', 'service', 'inventory', 'non-inventory'));

-- 2. Add product_date column
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- 3. Add image_url column
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

