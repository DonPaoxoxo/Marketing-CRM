-- The registrar export the team uses for domains, as columns on the domain record.
--
-- registrar      e.g. RealTime, Gname
-- registrar_uid  the registrar account the domain sits in (the export's "UID")
-- category       the registrar's own grouping, e.g. Ungrouped
-- nameservers    comma-separated, lower-case, e.g.
--                chad.ns.cloudflare.com,clarissa.ns.cloudflare.com
--
-- All default to '' so every existing domain stays valid without a backfill.
-- The registrar index supports filtering the register by registrar.

ALTER TABLE domains
  ADD COLUMN registrar      VARCHAR(80)   NOT NULL DEFAULT '' AFTER status,
  ADD COLUMN registrar_uid  VARCHAR(64)   NOT NULL DEFAULT '' AFTER registrar,
  ADD COLUMN category       VARCHAR(80)   NOT NULL DEFAULT '' AFTER registrar_uid,
  ADD COLUMN nameservers    VARCHAR(1000) NOT NULL DEFAULT '' AFTER category,
  ADD KEY ix_domains_registrar (registrar);
