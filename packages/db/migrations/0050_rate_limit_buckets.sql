-- Database-backed rate limit buckets for multi-instance deployments.
-- Each row is a single request timestamp within the sliding window.
-- The in-process Map limiter remains the default for single-instance dev;
-- this table is used when RATE_LIMIT_BACKEND=db is configured.
create table if not exists rate_limit_buckets (
  id bigint generated always as identity primary key,
  key text not null,
  timestamp bigint not null
);

create index if not exists rate_limit_buckets_key_timestamp_idx
  on rate_limit_buckets (key, timestamp);

create index if not exists rate_limit_buckets_timestamp_idx
  on rate_limit_buckets (timestamp);
