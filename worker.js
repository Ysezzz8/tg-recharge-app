export default {
  async fetch(r) {
    if (r.method == "OPTIONS") return new Response("", {headers: {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}});
    let res = await fetch("https://telegram.org", {method: "POST", headers: {"Content-Type": "application/json"}, body: await r.text()});
    return new Response(await res.text(), {headers: {"Access-Control-Allow-Origin": "*"}});
  }
}
