-- Rate limiting for the rewrite function: 20 rewrites per IP per hour, 300 in any rolling 24 hours.
-- The function counts rows in rewrite_log, so it needs the caller's IP on each row.
alter table rewrite_log add column if not exists client_ip text;
create index if not exists rewrite_log_created_idx on rewrite_log(created_at);
create index if not exists rewrite_log_ip_created_idx on rewrite_log(client_ip, created_at);
