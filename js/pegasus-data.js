/* PEGASUS — Platform data layer.
   In production, all data is live from Supabase.
   In preview (not signed in), the platform renders empty institutional states.
   No fake people, companies, or ecosystem activity is seeded. */
window.PEG_DATA = {
  dealRooms: [],   // populated from Supabase when signed in
  members:   [],   // populated from Supabase featured_participants table
  activity:  [],   // populated from Supabase deal_room_activity + notifications
};
