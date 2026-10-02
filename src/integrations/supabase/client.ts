import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  purgeForeignSupabaseSessions,
} from '@/config/supabaseConfig';
import { capturePasswordRecoveryIntentFromUrl } from '@/lib/passwordRecovery';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Capture recovery intent before supabase-js consumes the implicit-flow URL fragment.
capturePasswordRecoveryIntentFromUrl();

// Remove sessões de projetos antigos antes de inicializar (evita "Invalid API key").
purgeForeignSupabaseSessions();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  },
});
