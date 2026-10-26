-- Official PSGC codes link geographic nodes to an updatable authoritative directory.
-- A directory node can also be a tenant/workspace so scoped administrators can
-- inherit access through its parent chain. Existing tenant rows are preserved.
ALTER TABLE lgus
  ADD COLUMN IF NOT EXISTS psgc_code TEXT,
  ADD COLUMN IF NOT EXISTS psgc_release TEXT,
  ADD COLUMN IF NOT EXISTS is_directory_node BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS lgus_psgc_code_uq
  ON lgus (psgc_code) WHERE psgc_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS lgus_directory_parent_level_idx
  ON lgus (parent_lgu_id, jurisdiction_level) WHERE is_directory_node;

-- Names can repeat in different regions (for example, multiple cities named
-- San Fernando), while duplicates under one parent remain disallowed.
DROP INDEX IF EXISTS lgus_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS lgus_name_parent_uq
  ON lgus ((COALESCE(parent_lgu_id, 0)), lower(name));

ALTER TABLE lgus DROP CONSTRAINT IF EXISTS lgus_jurisdiction_level_check;
ALTER TABLE lgus ADD CONSTRAINT lgus_jurisdiction_level_check
  CHECK (jurisdiction_level IN (
    'national', 'island_group', 'region', 'province', 'independent_city',
    'special_area', 'city', 'municipality', 'barangay'
  ));
