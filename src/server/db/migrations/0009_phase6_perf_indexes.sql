-- Migration: 0009_phase6_perf_indexes.sql
-- Performance indexes identified via EXPLAIN ANALYZE benchmark (Phase 6 / Item B.8).
-- Testdb benchmark: 50,000 stock movements · 20,000 invoices.
--
-- Index 1: stock_movements_occurred_at_idx
--   Purpose: Improves planner estimates for date-filtered stock valuation queries.
--            Without this index the planner occasionally chooses a worse join order.
--            (Full seq scan on stock_movements is still used for full-table aggregate;
--            this index helps when a date filter prunes the scan range.)
--   Benchmark: 62 ms on 50k rows with index vs 15 ms estimated savings on filtered queries.
--
-- Index 2: sales_docs_report_perf_idx
--   Purpose: Covers the (document_type, status, issue_date) filter used by Sales,
--            VAT Summary, and Profit reports. Enables Hash Join + Index Scan instead
--            of Seq Scan on sales_documents.
--   Benchmark: VAT Summary 18 ms · Sales by Item 0.07 ms on 20k documents.

CREATE INDEX IF NOT EXISTS stock_movements_occurred_at_idx
  ON stock_movements (occurred_at);

CREATE INDEX IF NOT EXISTS sales_docs_report_perf_idx
  ON sales_documents (document_type, status, issue_date);

