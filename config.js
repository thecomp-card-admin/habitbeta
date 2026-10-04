/* config.js — sync setup (app 1.3+).
 * Leave both values blank to keep everything on this device only.
 * To sync between your phone and computers, paste in two values from your Supabase project
 * (dashboard → Connect, or Project Settings → API Keys), then commit this file.
 * Both are safe to publish: the publishable key only reaches what Row Level Security allows.
 * NEVER put the secret key (sb_secret_…) or your database password in this file.
 */
window.HABITS_CONFIG = {
  supabaseUrl: '',            // Project URL, e.g. 'https://abcd1234.supabase.co'
  supabasePublishableKey: ''  // starts with 'sb_publishable_'
};
