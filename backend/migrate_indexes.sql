-- Performance indexes for company databases
-- Run this on EVERY company database (e.g. gms_ads, gms_test, etc.)
-- These tables previously had only their PK indexed → full table scans on every query.

-- RateChart: queries always filter by fkCompID + fkPartyID
ALTER TABLE RateChart
  ADD INDEX idx_ratechart_comp_party (fkCompID, fkPartyID);

-- mParty: queries always filter by fkCompID; Active filter also common
ALTER TABLE mParty
  ADD INDEX idx_party_comp_active (fkCompID, Active);

-- mItem: queries always filter by fkGroupID; slim mode also filters Active
ALTER TABLE mItem
  ADD INDEX idx_item_group_active (fkGroupID, Active);

-- PartyGodownLink: queries filter by fkCompID + fkPartyID
ALTER TABLE PartyGodownLink
  ADD INDEX idx_pglink_comp_party (fkCompID, fkPartyID);
