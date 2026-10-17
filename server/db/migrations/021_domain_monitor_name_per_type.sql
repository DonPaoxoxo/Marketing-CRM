-- Free Cash and Invite Domains are two different uses of a domain — the same
-- domain URL can legitimately appear once in each category. Uniqueness is
-- now scoped per domain_type instead of across the whole register.
ALTER TABLE domain_monitors
  DROP INDEX uq_domain_monitors_name,
  ADD UNIQUE KEY uq_domain_monitors_type_name (domain_type, domain_name);
