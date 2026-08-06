import { createClient } from "@supabase/supabase-js";

// For plain HTML/JS projects, hardcode the values here or
// use a bundler (Vite/Webpack) that reads from .env.local
const supabaseUrl = "https://uwyvdwswiytjhpfvvztn.supabase.co";
const supabaseKey = "sb_publishable_9u3Ywuu9a_1ntmL0Xj0tYw_lXelpmge";

export const supabase = createClient(supabaseUrl, supabaseKey);
