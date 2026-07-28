import { supabase } from "./src/supabase/client.js";

const { data, error } = await supabase
  .from("trip_clips")
  .select("id, url, status, title, error_message, created_at")
  .order("created_at", { ascending: false })
  .limit(3);

if (error) throw error;
console.log(JSON.stringify(data, null, 2));
