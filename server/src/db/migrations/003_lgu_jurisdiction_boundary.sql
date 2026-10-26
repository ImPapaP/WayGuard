-- Store a GeoJSON polygon/multipolygon for each LGU's official jurisdiction.
-- Coordinates use GeoJSON order: [longitude, latitude].
ALTER TABLE lgus ADD COLUMN jurisdiction_boundary JSONB;
ALTER TABLE lgus ADD CONSTRAINT lgus_boundary_is_object
  CHECK (jurisdiction_boundary IS NULL OR jsonb_typeof(jurisdiction_boundary) = 'object');
