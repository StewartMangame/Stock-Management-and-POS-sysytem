/**
 * Central schema export — import from here in drizzle.config and db/index.
 * Each phase adds its own file and re-exports here.
 */
export * from './setup';
export * from './stock';
export * from './sales';
export * from './payments';
