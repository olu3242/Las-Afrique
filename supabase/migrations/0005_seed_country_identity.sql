-- ---------------------------------------------------------------------------
-- Country identity for the launch set.
--
-- `trips.destination_country_key` is a foreign key onto this table, so trip
-- intake cannot store a destination until the destinations exist. This seeds
-- the eleven launch countries the product already names.
--
-- Identity ONLY: name, ISO currency, principal cities, ordering. Every
-- requirement column — visa_entry_info, passport_considerations, emergency_info,
-- customs_notes, advisories — is deliberately left null, and every row is
-- `unverified` with no source and no last_verified_at.
--
-- That is the point. Take Me Home may say a country guide exists; it may not
-- state what the guide says until a real source backs it. Iteration 3 (Country
-- Intelligence) fills those columns with provenance attached. Inventing an
-- entry rule here to make a card look finished would be exactly the failure
-- the PRD prohibits.
--
-- Idempotent on key so re-running cannot duplicate a country, and it updates
-- only the identity fields — never the requirement columns, which by then may
-- hold verified data this migration knows nothing about.
-- ---------------------------------------------------------------------------

insert into public.country_profiles
  (key, name, currency, sort_order, major_cities)
values
  ('nigeria',      'Nigeria',      'NGN',  1, array['Lagos', 'Abuja', 'Port Harcourt']),
  ('ghana',        'Ghana',        'GHS',  2, array['Accra', 'Kumasi', 'Takoradi']),
  ('kenya',        'Kenya',        'KES',  3, array['Nairobi', 'Mombasa', 'Kisumu']),
  ('uganda',       'Uganda',       'UGX',  4, array['Kampala', 'Entebbe', 'Gulu']),
  ('south-africa', 'South Africa', 'ZAR',  5, array['Johannesburg', 'Cape Town', 'Durban']),
  ('liberia',      'Liberia',      'LRD',  6, array['Monrovia', 'Gbarnga', 'Buchanan']),
  ('cameroon',     'Cameroon',     'XAF',  7, array['Douala', 'Yaoundé', 'Bafoussam']),
  ('sierra-leone', 'Sierra Leone', 'SLE',  8, array['Freetown', 'Bo', 'Kenema']),
  ('senegal',      'Senegal',      'XOF',  9, array['Dakar', 'Thiès', 'Saint-Louis']),
  ('ivory-coast',  'Ivory Coast',  'XOF', 10, array['Abidjan', 'Yamoussoukro', 'Bouaké']),
  ('ethiopia',     'Ethiopia',     'ETB', 11, array['Addis Ababa', 'Dire Dawa', 'Bahir Dar'])
on conflict (key) do update set
  name         = excluded.name,
  currency     = excluded.currency,
  sort_order   = excluded.sort_order,
  major_cities = excluded.major_cities;
