/* ============================================================================
   PEGASUS — Profile Ecosystem Layer · profile-media.js
   Avatar / banner uploads via Supabase Storage (bucket: 'profile-media').
   Files stored under {uid}/avatar-* and {uid}/banner-* (RLS enforces owner).
   Exposes: window.PegProfileMedia
   ============================================================================ */
(function () {
  'use strict';

  var BUCKET = 'profile-media';

  async function sb() { try { return await window.PegSB.ready; } catch (e) { return null; } }

  function validate(file, maxMB) {
    if (!file) throw new Error('No file selected');
    if (!/^image\//.test(file.type)) throw new Error('Please choose an image file (JPG, PNG, or WebP)');
    var mb = file.size / (1024 * 1024);
    if (mb > (maxMB || 5)) throw new Error('Image is ' + mb.toFixed(1) + 'MB — please use one under ' + (maxMB || 5) + 'MB');
    return true;
  }

  /* Upload an image and return its public URL. kind = 'avatar' | 'banner' */
  async function upload(kind, file) {
    var c = await sb();
    if (!c) throw new Error('Storage unavailable — connect Supabase');
    var usr = window.PegProfile.currentUser();
    if (!usr) throw new Error('Sign in to upload media');
    var _max = (kind === 'banner' || kind === 'showcase') ? 10 : 5;
    validate(file, _max);

    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = usr.id + '/' + kind + '-' + Date.now() + '.' + ext;

    var up = await c.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: true, contentType: file.type
    });
    if (up.error) {
      console.error('[PegMedia] upload error:', up.error);
      var em = (up.error.message || '').toLowerCase();
      if (em.indexOf('bucket') !== -1 || em.indexOf('not found') !== -1)
        throw new Error('Storage bucket "profile-media" not found. Run migration 007 in Supabase to create it.');
      if (em.indexOf('row-level') !== -1 || em.indexOf('policy') !== -1 || em.indexOf('denied') !== -1)
        throw new Error('Upload not permitted. Run migration 007 to add the profile-media storage policies.');
      throw up.error;
    }

    var pub = c.storage.from(BUCKET).getPublicUrl(path);
    var url = pub && pub.data ? pub.data.publicUrl : null;
    if (!url) throw new Error('Could not resolve public URL for the uploaded image');
    return url;
  }

  /* Upload + persist ONLY the URL column — uses targeted .update() so other
     profile fields are never touched or overwritten. */
  async function uploadAndSave(kind, file) {
    var url = await upload(kind, file);
    var c = await sb();
    var usr = window.PegProfile.currentUser();
    if (!usr) throw new Error('Not signed in');

    var col = kind === 'banner' ? 'banner_url' : 'avatar_url';
    var upd = {}; upd[col] = url; upd.updated_at = new Date().toISOString();

    var res = await c.from('profiles').update(upd).eq('id', usr.id);
    if (res.error) { console.error('[PegMedia] save URL error:', res.error); throw res.error; }

    /* Keep the in-memory store in sync */
    try {
      var st = window.PegStore.get();
      if (st && st.profile) { st.profile[col] = url; window.PegStore.set({ profile: st.profile }); }
    } catch(e) { /* non-fatal */ }

    return url;
  }

  window.PegProfileMedia = { upload: upload, uploadAndSave: uploadAndSave, validate: validate, BUCKET: BUCKET };
})();
