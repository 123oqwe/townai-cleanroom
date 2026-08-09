-- Per-key lock table for database-backed rate limiter concurrency control.
-- Each row serializes check() decisions for a single rate-limit key (hashed),
-- while different keys remain fully parallel. The updated_at column supports
-- cleanup of orphaned key rows that no longer have any active bucket entries.
-- Migration 0050 (rate_limit_buckets) is left untouched for upgrade safety.

-- pgcrypto provides digest() for SHA-256 hashing used in key_hash backfill.
create extension if not exists pgcrypto;

create table if not exists rate_limit_keys (
  key_hash text primary key,
  updated_at timestamptz not null default now()
);

-- Index to support efficient cleanup of stale key rows ordered by updated_at.
create index if not exists rate_limit_keys_updated_at_idx
  on rate_limit_keys (updated_at);

-- Add a key_hash column to rate_limit_buckets so cleanup of orphan keys can
-- cascade remaining bucket rows. The buckets table from 0050 keeps its
-- original (key, timestamp) columns; key_hash is additive.
alter table rate_limit_buckets
  add column if not exists key_hash text;

-- Backfill key_hash for existing rows using SHA-256 of the existing key.
-- This mirrors the application-layer normalizeKey -> hash derivation so that
-- pre-existing bucket rows are covered by the new cleanup path.
update rate_limit_buckets
  set key_hash = encode(digest(key, 'sha256'), 'hex')
  where key_hash is null;

-- Index for cleanup queries that delete expired buckets by key_hash + timestamp.
create index if not exists rate_limit_buckets_key_hash_timestamp_idx
  on rate_limit_buckets (key_hash, timestamp);

-- Index for bulk cleanup of all expired buckets regardless of key.
create index if not exists rate_limit_buckets_timestamp_only_idx
  on rate_limit_buckets (timestamp);
