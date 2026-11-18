/**
 * Product Types Specification & Shared Helpers.
 *
 * Defines the canonical behavior matrix for all 8 product types:
 * - standard: Tracked physical inventory
 * - inventory: Tracked physical inventory
 * - non_inventory: Consumables/expenses without stock tracking
 * - composite: Assembled/manufactured items tracked in stock
 * - serialized: High-value physical inventory tracked by serial number
 * - batch: Physical inventory tracked by batch/lot number
 * - bundle: Virtual kits whose stock is deducted from components
 * - service: Intangible services/labour without stock
 */

import { todayInCompanyTz } from './timezone';

export type ProductType =
  | 'standard'
  | 'inventory'
  | 'non_inventory'
  | 'composite'
  | 'serialized'
  | 'batch'
  | 'bundle'
  | 'service';

export interface ProductTypeBehavior {
  type: ProductType;
  displayName: string;
  description: string;
  /** Whether moving/selling this product directly creates stock_movements for this product ID */
  createsStockMovements: boolean;
  /** Whether the item can be added to a cart and sold directly at the POS */
  sellableAtPos: boolean;
  /** Whether physical on-hand quantity counts in inventory valuation */
  countsInValuation: boolean;
  /** Whether physical on-hand quantity appears in stock balance reports and physical counts */
  countsInStockReports: boolean;
  /** Whether the product expands into multiple sub-components upon delivery/sale */
  isKitOrBundle: boolean;
}

export const PRODUCT_TYPE_BEHAVIORS: Record<ProductType, ProductTypeBehavior> = {
  standard: {
    type: 'standard',
    displayName: 'Standard Product',
    description: 'Tracked physical inventory item.',
    createsStockMovements: true,
    sellableAtPos: true,
    countsInValuation: true,
    countsInStockReports: true,
    isKitOrBundle: false,
  },
  inventory: {
    type: 'inventory',
    displayName: 'Inventory',
    description: 'Tracked physical inventory item.',
    createsStockMovements: true,
    sellableAtPos: true,
    countsInValuation: true,
    countsInStockReports: true,
    isKitOrBundle: false,
  },
  non_inventory: {
    type: 'non_inventory',
    displayName: 'Non-Inventory',
    description: 'Non-tracked item (e.g. consumables, expenses).',
    createsStockMovements: false,
    sellableAtPos: true,
    countsInValuation: false,
    countsInStockReports: false,
    isKitOrBundle: false,
  },
  composite: {
    type: 'composite',
    displayName: 'Composite',
    description: 'Manufactured or assembled physical item tracked in stock.',
    createsStockMovements: true,
    sellableAtPos: true,
    countsInValuation: true,
    countsInStockReports: true,
    isKitOrBundle: false,
  },
  serialized: {
    type: 'serialized',
    displayName: 'Serialized',
    description: 'Tracked physical item with individual serial numbers.',
    createsStockMovements: true,
    sellableAtPos: true,
    countsInValuation: true,
    countsInStockReports: true,
    isKitOrBundle: false,
  },
  batch: {
    type: 'batch',
    displayName: 'Batch Tracked',
    description: 'Tracked physical item tracked by lot/batch number.',
    createsStockMovements: true,
    sellableAtPos: true,
    countsInValuation: true,
    countsInStockReports: true,
    isKitOrBundle: false,
  },
  bundle: {
    type: 'bundle',
    displayName: 'Bundle / Kit',
    description: 'Virtual grouping of components; stock is decremented from underlying components.',
    createsStockMovements: false,
    sellableAtPos: true,
    countsInValuation: false,
    countsInStockReports: false,
    isKitOrBundle: true,
  },
  service: {
    type: 'service',
    displayName: 'Service',
    description: 'Labour, consulting, or fees with no physical stock.',
    createsStockMovements: false,
    sellableAtPos: true,
    countsInValuation: false,
    countsInStockReports: false,
    isKitOrBundle: false,
  },
};

/**
 * Normalizes input string to canonical ProductType (e.g. 'non-inventory' -> 'non_inventory').
 */
export function normalizeProductType(type: string | null | undefined): ProductType {
  if (!type) return 'standard';
  const clean = type.trim().toLowerCase().replace(/-/g, '_');
  if (clean in PRODUCT_TYPE_BEHAVIORS) {
    return clean as ProductType;
  }
  return 'standard';
}

export function getProductTypeBehavior(type: string | null | undefined): ProductTypeBehavior {
  const norm = normalizeProductType(type);
  return PRODUCT_TYPE_BEHAVIORS[norm];
}

export function isStockTrackedProduct(type: string | null | undefined): boolean {
  return getProductTypeBehavior(type).createsStockMovements;
}

export function isSellableAtPos(type: string | null | undefined): boolean {
  return getProductTypeBehavior(type).sellableAtPos;
}

export function countsInValuation(type: string | null | undefined): boolean {
  return getProductTypeBehavior(type).countsInValuation;
}

export function countsInStockReports(type: string | null | undefined): boolean {
  return getProductTypeBehavior(type).countsInStockReports;
}

export function isBundleProduct(type: string | null | undefined): boolean {
  return getProductTypeBehavior(type).isKitOrBundle;
}

/**
 * Default product date using company timezone (Africa/Blantyre).
 */
export function getDefaultProductDate(): string {
  return todayInCompanyTz();
}

/**
 * Validates that image_url uses https and is allowed by CSP.
 * Disallows javascript:, data:, blob:, http:, or malformed URLs.
 */
export function validateProductImageUrl(url: string | null | undefined): { isValid: boolean; error?: string } {
  if (!url || url.trim() === '') return { isValid: true };
  const trimmed = url.trim();

  // Must strictly start with https://
  if (!trimmed.startsWith('https://')) {
    return { isValid: false, error: 'Product image URL must use HTTPS (https://).' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return { isValid: false, error: 'Product image URL must use HTTPS protocol.' };
    }
    // Prevent malicious control characters or quotes
    if (/[\s<>"']/.test(trimmed)) {
      return { isValid: false, error: 'Product image URL contains invalid characters.' };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Product image URL is not a valid URL.' };
  }
}

