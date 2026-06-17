# TODO - Batch 1: State/District Masters + StationMaster Conversion

- [ ] Add backend APIs for State master CRUD (list/search/add/edit/delete) with unique state name validation.
- [ ] Add backend APIs for District master CRUD (list/search/add/edit/delete) with validations:
  - district must belong to selected state
  - unique district name within same state
- [ ] Add frontend admin pages for State master CRUD.
- [ ] Add frontend admin pages for District master CRUD.
- [ ] Update API client to support new master endpoints.
- [ ] Convert StationMaster page form:
  - State: searchable dropdown (state_master)
  - District: searchable dropdown (district_master), filtered by selected state
  - No free typing for state/district.
- [ ] Implement reusable searchable dropdown component for masters with typeahead suggestions.
- [ ] Implement server-side validation/normalization for StationMaster save:
  - Reject if state/district not found in masters
  - Reject if district belongs to different state
  - Canonicalize saved state/district using master codes/names (prevent spelling variations).
- [ ] Wire new StationMaster API save payload to use selected master values.
- [ ] Ensure existing Dashboard/Notifications/Favorite Stations/Monitors remain untouched.
- [ ] Run build/test commands and fix any issues.

