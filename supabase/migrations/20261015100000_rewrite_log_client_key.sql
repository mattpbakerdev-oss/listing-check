-- The rate limiter now stores a salted SHA-256 hash of the caller's IP, never the IP.
-- Rename the column so nothing can mistake it for an address, and wipe the raw IPs that
-- earlier rows hold. Script runs keep their 'service_role' marker.
alter table rewrite_log rename column client_ip to client_key;
update rewrite_log set client_key = null where client_key is not null and client_key <> 'service_role';
comment on column rewrite_log.client_key is 'Salted SHA-256 of the caller IP for rate limiting, or service_role for script runs. Never a raw address.';
