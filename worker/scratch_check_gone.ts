import { supabase } from "./src/supabase/client.js";

const { data: byId } = await supabase
  .from("trip_clips")
  .select("*")
  .eq("id", "34bbb602-27a1-40b8-ad0f-bc73938decb0");
console.log("By ID:", JSON.stringify(byId, null, 2));

const { data: byUrl } = await supabase
  .from("trip_clips")
  .select("id, url, status, title, created_at")
  .ilike("url", "%pictureperfectluis%")
  .order("created_at", { ascending: false });
console.log("By author in URL:", JSON.stringify(byUrl, null, 2));

const { data: recent } = await supabase
  .from("trip_clips")
  .select("id, url, status, created_at")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("Most recent 5:", JSON.stringify(recent, null, 2));
