-- Extend the free-tier quota table to cover Pro quotas too.
-- scope='free': ip_hash holds SHA-256 of the caller IP, limit 20/day.
-- scope='pro':  ip_hash holds SHA-256 of the license key (stable across
-- networks for paying users), limit 300/day.

alter table if exists free_usage rename to usage_quota;

alter table usage_quota add column if not exists scope text not null default 'free';

alter table usage_quota drop constraint if exists free_usage_pkey;
alter table usage_quota drop constraint if exists usage_quota_pkey;

alter table usage_quota add primary key (scope, ip_hash, day);
