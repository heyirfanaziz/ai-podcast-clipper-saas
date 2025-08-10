import { createClient } from '@supabase/supabase-js'
import { env } from '~/env'

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// For server-side operations
export const createServerSupabaseClient = () => {
  return createClient(supabaseUrl, supabaseKey)
} 