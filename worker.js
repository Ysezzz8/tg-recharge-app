export default {
  async fetch(r) {
    if (r.method === "OPTIONS") {
      return new Response("", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    }
    const host = "api.telegram.org";
    const token = "9267340308:AAF-HyhX0Fa_UnvLFmpPbzO22jRmcJGTMH4";
    const url = `https://${host}/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await r.text()
    });
    return new Response(await res.text(), { headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
